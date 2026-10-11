from __future__ import annotations

import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import AUDIENCE, ISSUER, KID, Api, Keys, env_for, make_token

URL = "/v1/workspaces"


def _status(client: TestClient, token: str | None) -> Any:
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return client.get(URL, headers=h)


def test_valid_token_accepted(client: TestClient, keys: Keys) -> None:
    r = _status(client, make_token(keys.private))
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}
    assert r.headers["x-request-id"]


def test_missing_or_malformed_authorization_rejected(client: TestClient) -> None:
    for headers in ({}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}):
        r = client.get(URL, headers=headers)
        assert r.status_code == 401
        body = r.json()["error"]
        assert body["code"] == "unauthorized" and body["request_id"]


def test_bad_tokens_rejected(client: TestClient, keys: Keys) -> None:
    now = int(time.time())
    bad = {
        "wrong_audience": make_token(keys.private, aud="someone-else"),
        "wrong_issuer": make_token(keys.private, iss="https://evil.example.test"),
        "expired": make_token(keys.private, exp=now - 3600, iat=now - 7200),
        "future_iat": make_token(keys.private, iat=now + 3600, exp=now + 7200),
        "no_exp": make_token(keys.private, exp=None),
        "no_iat": make_token(keys.private, iat=None),
        "no_sub": jwt.encode(
            {"iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 60},
            keys.private,
            algorithm="RS256",
            headers={"kid": KID},
        ),
        "wrong_key": make_token(keys.other),
        "garbage": "not.a.jwt",
        "hs256": jwt.encode(
            {"sub": "x", "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 60},
            "s" * 40,
            algorithm="HS256",
            headers={"kid": KID},
        ),
        "alg_none": jwt.encode(
            {"sub": "x", "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 60},
            "",
            algorithm="none",
            headers={"kid": KID},
        ),
        "unknown_kid": jwt.encode(
            {"sub": "x", "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 60},
            keys.private,
            algorithm="RS256",
            headers={"kid": "nope"},
        ),
    }
    for name, token in bad.items():
        r = _status(client, token)
        assert r.status_code == 401, name
        assert r.json()["error"]["code"] == "unauthorized", name
        assert token not in r.text


def test_identity_ignores_caller_supplied_claims_and_headers(
    client: TestClient, keys: Keys, alice: Api, bob: Api
) -> None:
    wid = alice.workspace()
    forged = make_token(keys.private, bob.sub, workspace_id=wid, role="owner")
    h = {"Authorization": f"Bearer {forged}", "X-User": alice.sub, "X-Workspace-Id": wid}
    assert client.get(f"{URL}/{wid}/projects", headers=h).status_code == 404
    assert client.get(URL, headers=h).json()["total"] == 0


def test_missing_auth_config_fails_closed(db_url: str, keys: Keys) -> None:
    with TestClient(create_app(Settings.from_env(env_for(db_url, None)))) as c:
        r = _status(c, make_token(keys.private))
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "service_unavailable"
        assert _status(c, None).status_code == 401


def test_jwks_unreachable_fails_closed_without_leaking(db_url: str, keys: Keys) -> None:
    env = env_for(db_url, "http://127.0.0.1:9/jwks", AUTH_JWKS_TIMEOUT_SECONDS="1")
    with TestClient(create_app(Settings.from_env(env))) as c:
        r = _status(c, make_token(keys.private))
        assert r.status_code == 503
        assert "127.0.0.1" not in r.text


def test_jwks_url_must_be_https_unless_loopback() -> None:
    s = Settings.from_env(env_for("postgresql://u@h/db", "http://example.com/jwks"))
    assert s.auth is None and s.auth_error is not None


def test_errors_do_not_echo_input(alice: Api) -> None:
    secret = "SECRET-VALUE-123"
    r = alice.post(URL, {"name": "", "extra": secret})
    assert r.status_code == 422
    assert secret not in r.text
    assert set(r.json()["error"]) == {"code", "message", "request_id"}


@pytest.mark.parametrize("path", ["/v1/nope"])
def test_unknown_route_uses_envelope(client: TestClient, path: str) -> None:
    r = client.get(path)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
