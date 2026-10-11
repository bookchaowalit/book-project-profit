"""OIDC access-token verification (RS256 via a cached, bounded JWKS fetch)."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Request
from jwt.algorithms import RSAAlgorithm

from app.config import AuthSettings
from app.errors import AppError, unauthorized

log = logging.getLogger("profit_api.auth")
MAX_TOKEN_LENGTH = 8192
MAX_JWKS_BYTES = 256 * 1024
MAX_STALE_SECONDS = 3600


@dataclass(frozen=True)
class Principal:
    issuer: str
    subject: str


class JWKSUnavailable(Exception):
    pass


class JWKSCache:
    """Thread-safe JWKS cache.

    * Fresh: keys younger than ``jwks_cache_seconds`` are always usable (the TTL
      may legitimately exceed MAX_STALE_SECONDS).
    * Outage-stale: after a *failed* refresh, expired keys stay usable only until
      ``jwks_cache_seconds + MAX_STALE_SECONDS`` old.
    * Beyond that every call (including during the refresh cooldown) raises
      ``JWKSUnavailable``. Age is re-checked on every return path.
    Refresh on unknown ``kid`` is rate-limited by ``jwks_min_refresh_seconds``.
    """

    def __init__(self, settings: AuthSettings, clock: Callable[[], float] = time.monotonic) -> None:
        self._s = settings
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0
        self._attempted_at = -math.inf
        self._refresh_failed = False

    def _fetch(self) -> dict[str, Any]:
        body = b""
        try:
            with (
                httpx.Client(timeout=self._s.jwks_timeout_seconds, follow_redirects=False) as c,
                c.stream("GET", self._s.jwks_url) as r,
            ):
                if r.status_code != 200:
                    raise JWKSUnavailable
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > MAX_JWKS_BYTES:
                        raise JWKSUnavailable
            doc = json.loads(body)
        except (httpx.HTTPError, ValueError) as exc:
            raise JWKSUnavailable from exc
        keys: dict[str, Any] = {}
        for jwk in doc.get("keys", []) if isinstance(doc, dict) else []:
            if not isinstance(jwk, dict) or jwk.get("kty") != "RSA" or not jwk.get("kid"):
                continue
            if jwk.get("use", "sig") != "sig" or jwk.get("alg", "RS256") != "RS256":
                continue
            try:
                keys[str(jwk["kid"])] = RSAAlgorithm.from_jwk(json.dumps(jwk))
            except (jwt.InvalidKeyError, ValueError, KeyError):
                continue
        return keys

    def get(self, kid: str) -> Any:
        with self._lock:
            now = self._clock()
            ttl = self._s.jwks_cache_seconds
            if self._keys and now - self._fetched_at < ttl and kid in self._keys:
                return self._keys[kid]
            since_attempt = now - self._attempted_at
            if since_attempt >= self._s.jwks_min_refresh_seconds or (
                not self._keys and since_attempt >= 1
            ):
                self._attempted_at = now
                try:
                    self._keys = self._fetch()
                    self._fetched_at = self._clock()
                    self._refresh_failed = False
                except JWKSUnavailable:
                    log.warning("jwks_fetch_failed")
                    self._refresh_failed = True
            if not self._keys:
                raise JWKSUnavailable
            age = self._clock() - self._fetched_at
            usable = age < ttl or (self._refresh_failed and age < ttl + MAX_STALE_SECONDS)
            if not usable:
                raise JWKSUnavailable
            if age >= ttl and kid not in self._keys:
                raise JWKSUnavailable  # outage: cannot tell unknown kid from rotation
            key = self._keys.get(kid)
            if key is None:
                raise KeyError(kid)
            return key


class TokenVerifier:
    def __init__(self, settings: AuthSettings | None, config_error: str | None) -> None:
        self._s = settings
        self._config_error = config_error
        self._jwks = JWKSCache(settings) if settings else None

    def verify(self, token: str) -> Principal:
        if self._s is None or self._jwks is None:
            log.error("auth_not_configured reason=%s", self._config_error or "unknown")
            raise AppError(503, "service_unavailable", "Authentication is not configured")
        if len(token) > MAX_TOKEN_LENGTH:
            raise unauthorized("Invalid token")
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256":
                raise unauthorized("Invalid token")
            kid = header.get("kid")
            if not isinstance(kid, str) or not kid:
                raise unauthorized("Invalid token")
            key = self._jwks.get(kid)
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                audience=self._s.audience,
                issuer=self._s.issuer,
                leeway=self._s.leeway_seconds,
                options={"require": ["sub", "iss", "aud", "exp", "iat"]},
            )
        except JWKSUnavailable as exc:
            raise AppError(
                503, "service_unavailable", "Authentication service unavailable"
            ) from exc
        except KeyError as exc:
            raise unauthorized("Invalid token") from exc
        except jwt.PyJWTError as exc:
            raise unauthorized("Invalid token") from exc
        sub = claims.get("sub")
        iss = claims.get("iss")
        if not isinstance(sub, str) or not sub or len(sub) > 255:
            raise unauthorized("Invalid token")
        if not isinstance(iss, str) or not iss or len(iss) > 512:
            raise unauthorized("Invalid token")
        return Principal(issuer=iss, subject=sub)


def get_principal(request: Request) -> Principal:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise unauthorized()
    verifier: TokenVerifier = request.app.state.verifier
    return verifier.verify(token.strip())
