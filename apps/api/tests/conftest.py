"""Test harness: bundled ephemeral PostgreSQL (pgserver) + local JWKS server + signed JWTs.

Nothing here reads a configured DATABASE_URL; the database is disposable and
all identities are synthetic.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import jwt
import pgserver
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import Engine, create_engine, text

from app.config import Settings
from app.main import create_app
from app.migrate import main as migrate_main

ISSUER = "https://issuer.example.test"
AUDIENCE = "profit-api-test"
KID = "test-key-1"


def _new_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@dataclass
class Keys:
    private: rsa.RSAPrivateKey
    other: rsa.RSAPrivateKey


@pytest.fixture(scope="session")
def keys() -> Keys:
    return Keys(private=_new_key(), other=_new_key())


@pytest.fixture(scope="session")
def jwks_url(keys: Keys) -> Iterator[str]:
    jwk = json.loads(RSAAlgorithm.to_jwk(keys.private.public_key()))
    jwk.update({"kid": KID, "use": "sig", "alg": "RS256"})
    payload = json.dumps({"keys": [jwk]}).encode()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/jwks"
    server.shutdown()


@pytest.fixture(scope="session")
def pg_server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Any]:
    server = pgserver.get_server(  # type: ignore[attr-defined]
        Path(tmp_path_factory.mktemp("pgdata")), cleanup_mode="delete"
    )
    yield server
    server.cleanup()


class DbFactory:
    def __init__(self, server: Any) -> None:
        self.base = server.get_uri()

    def create(self) -> str:
        name = "t_" + uuid.uuid4().hex[:12]
        with psycopg.connect(self.base, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE "{name}"')
        return str(self.base).replace("/postgres?", f"/{name}?")


@pytest.fixture(scope="session")
def db_factory(pg_server: Any) -> DbFactory:
    return DbFactory(pg_server)


def migrate(url: str, monkeypatch: pytest.MonkeyPatch | None = None) -> None:
    import os

    old = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    try:
        assert migrate_main() == 0
    finally:
        if old is None:
            os.environ.pop("DATABASE_URL")
        else:
            os.environ["DATABASE_URL"] = old


@pytest.fixture(scope="session")
def db_url(db_factory: DbFactory) -> str:
    url = db_factory.create()
    migrate(url)
    return url


def env_for(db: str | None, jwks: str | None, **extra: str) -> dict[str, str]:
    env = {"DB_POOL_SIZE": "10", "DB_MAX_OVERFLOW": "5", "AUTH_JWKS_MIN_REFRESH_SECONDS": "1"}
    if db:
        env["DATABASE_URL"] = db
    if jwks:
        env.update(AUTH_JWKS_URL=jwks, AUTH_ISSUER=ISSUER, AUTH_AUDIENCE=AUDIENCE)
    env.update(extra)
    return env


@pytest.fixture(scope="session")
def app(db_url: str, jwks_url: str) -> Any:
    return create_app(Settings.from_env(env_for(db_url, jwks_url)))


@pytest.fixture(scope="session")
def engine(db_url: str) -> Iterator[Engine]:
    eng = create_engine(db_url.replace("postgresql://", "postgresql+psycopg://", 1))
    yield eng
    eng.dispose()


def make_token(private: Any, sub: str | None = None, **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": sub or f"user-{uuid.uuid4().hex}",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now - 5,
        "exp": now + 600,
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, private, algorithm="RS256", headers={"kid": KID})


class Api:
    """Authenticated synthetic user bound to a TestClient."""

    def __init__(self, client: TestClient, token: str, sub: str) -> None:
        self.client = client
        self.sub = sub
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, path: str, **kw: Any) -> Any:
        return self.client.get(path, headers=self.headers, **kw)

    def patch(self, path: str, json: Any) -> Any:
        return self.client.patch(path, headers=self.headers, json=json)

    def delete(self, path: str) -> Any:
        return self.client.delete(path, headers=self.headers)

    def post(self, path: str, json: Any, key: str | None = "auto") -> Any:
        h = dict(self.headers)
        if key == "auto":
            key = uuid.uuid4().hex
        if key is not None:
            h["Idempotency-Key"] = key
        return self.client.post(path, headers=h, json=json)

    # convenience
    def workspace(self, name: str = "Synthetic WS") -> str:
        r = self.post("/v1/workspaces", {"name": name})
        assert r.status_code == 201, r.text
        return str(r.json()["id"])

    def project(self, wid: str, **over: Any) -> dict[str, Any]:
        body = {
            "name": "Proj",
            "client_name": "Client",
            "currency": "THB",
            "contract_value_minor": "100000",
            "hourly_cost_minor": "6000",
        }
        body.update(over)
        r = self.post(f"/v1/workspaces/{wid}/projects", body)
        assert r.status_code == 201, r.text
        out: dict[str, Any] = r.json()
        return out


@pytest.fixture(scope="session")
def client(app: Any) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def new_user(client: TestClient, keys: Keys) -> Any:
    def factory() -> Api:
        sub = f"user-{uuid.uuid4().hex}"
        return Api(client, make_token(keys.private, sub), sub)

    return factory


@pytest.fixture
def alice(new_user: Any) -> Api:
    return new_user()  # type: ignore[no-any-return]


@pytest.fixture
def bob(new_user: Any) -> Api:
    return new_user()  # type: ignore[no-any-return]


def add_member(engine: Engine, wid: str, user: Api, role: str) -> None:
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO workspace_members (workspace_id, issuer, subject, role) "
                "VALUES (:w, :i, :s, :r)"
            ),
            {"w": wid, "i": ISSUER, "s": user.sub, "r": role},
        )
