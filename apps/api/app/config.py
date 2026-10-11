"""Environment-driven settings. Values are read once; secrets are never logged."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


class ConfigError(Exception):
    """Raised with a sanitized message (never contains a value)."""


def _int_env(env: dict[str, str], name: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc
    if not lo <= value <= hi:
        raise ConfigError(f"{name} must be between {lo} and {hi}")
    return value


def normalize_database_url(url: str) -> str:
    """Select the psycopg 3 driver for common PostgreSQL URL spellings."""
    for prefix in ("postgresql+psycopg://",):
        if url.startswith(prefix):
            return url
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    raise ConfigError("DATABASE_URL must be a PostgreSQL URL")


@dataclass(frozen=True)
class AuthSettings:
    jwks_url: str
    issuer: str
    audience: str
    leeway_seconds: int
    jwks_timeout_seconds: float
    jwks_cache_seconds: int
    jwks_min_refresh_seconds: int


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    auth: AuthSettings | None
    auth_error: str | None
    db_pool_size: int
    db_max_overflow: int
    db_pool_timeout_seconds: int
    db_statement_timeout_ms: int

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = dict(os.environ if env is None else env)
        raw_db = e.get("DATABASE_URL", "").strip()
        database_url = normalize_database_url(raw_db) if raw_db else None

        auth: AuthSettings | None = None
        auth_error: str | None = None
        jwks_url = e.get("AUTH_JWKS_URL", "").strip()
        issuer = e.get("AUTH_ISSUER", "").strip()
        audience = e.get("AUTH_AUDIENCE", "").strip()
        missing = [
            n
            for n, v in (
                ("AUTH_JWKS_URL", jwks_url),
                ("AUTH_ISSUER", issuer),
                ("AUTH_AUDIENCE", audience),
            )
            if not v
        ]
        if missing:
            auth_error = "missing " + ", ".join(missing)
        else:
            parts = urlsplit(jwks_url)
            loopback = parts.hostname in {"localhost", "127.0.0.1", "::1"}
            if parts.scheme != "https" and not (parts.scheme == "http" and loopback):
                auth_error = "AUTH_JWKS_URL must use https"
            else:
                try:
                    auth = AuthSettings(
                        jwks_url=jwks_url,
                        issuer=issuer,
                        audience=audience,
                        leeway_seconds=_int_env(e, "AUTH_LEEWAY_SECONDS", 30, 0, 120),
                        jwks_timeout_seconds=float(
                            _int_env(e, "AUTH_JWKS_TIMEOUT_SECONDS", 3, 1, 10)
                        ),
                        jwks_cache_seconds=_int_env(e, "AUTH_JWKS_CACHE_SECONDS", 600, 30, 86400),
                        jwks_min_refresh_seconds=_int_env(
                            e, "AUTH_JWKS_MIN_REFRESH_SECONDS", 30, 1, 3600
                        ),
                    )
                except ConfigError as exc:
                    auth_error = str(exc)
        return cls(
            database_url=database_url,
            auth=auth,
            auth_error=auth_error,
            db_pool_size=_int_env(e, "DB_POOL_SIZE", 5, 1, 50),
            db_max_overflow=_int_env(e, "DB_MAX_OVERFLOW", 5, 0, 50),
            db_pool_timeout_seconds=_int_env(e, "DB_POOL_TIMEOUT_SECONDS", 5, 1, 60),
            db_statement_timeout_ms=_int_env(e, "DB_STATEMENT_TIMEOUT_MS", 15000, 100, 120000),
        )
