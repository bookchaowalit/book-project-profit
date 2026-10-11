from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.main import API_ROOT, create_app, head_revision
from app.models import Base
from tests.conftest import DbFactory, env_for, migrate


def _engine(url: str) -> Any:
    return create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))


def test_upgrade_creates_schema_and_matches_models(db_factory: DbFactory) -> None:
    url = db_factory.create()
    migrate(url)
    eng = _engine(url)
    try:
        names = set(inspect(eng).get_table_names())
        assert {
            "workspaces",
            "workspace_members",
            "projects",
            "time_entries",
            "expenses",
            "payments",
            "idempotency_keys",
            "audit_events",
            "alembic_version",
        } <= names
        with eng.connect() as c:
            assert c.scalar(text("select version_num from alembic_version")) == head_revision()
            diff = compare_metadata(MigrationContext.configure(c), Base.metadata)
        assert diff == []
    finally:
        eng.dispose()


def test_downgrade_and_reupgrade(db_factory: DbFactory) -> None:
    url = db_factory.create()
    migrate(url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "migrations"))
    cfg.attributes["database_url"] = url
    command.downgrade(cfg, "base")
    eng = _engine(url)
    try:
        assert "projects" not in inspect(eng).get_table_names()
    finally:
        eng.dispose()
    migrate(url)


def test_migrate_requires_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.migrate import main

    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main() == 2
    assert os.environ.get("DATABASE_URL") is None


def test_db_rejects_child_referencing_project_of_other_workspace(db_factory: DbFactory) -> None:
    url = db_factory.create()
    migrate(url)
    eng = _engine(url)
    w1, w2, p1 = (str(uuid.uuid4()) for _ in range(3))
    try:
        with eng.begin() as c:
            for w in (w1, w2):
                c.execute(text("insert into workspaces (id, name) values (:i, 'w')"), {"i": w})
            c.execute(
                text(
                    "insert into projects (id, workspace_id, name, client_name, currency, "
                    "contract_value_minor, hourly_cost_minor) "
                    "values (:p, :w, 'p', 'c', 'THB', 0, 0)"
                ),
                {"p": p1, "w": w1},
            )
        for table, cols, vals in (
            ("time_entries", "worked_on, minutes, hourly_cost_minor", "'2026-01-01', 10, 0"),
            ("expenses", "spent_on, amount_minor, description", "'2026-01-01', 5, 'x'"),
            ("payments", "received_on, amount_minor", "'2026-01-01', 5"),
        ):
            with pytest.raises(IntegrityError), eng.begin() as c:
                c.execute(
                    text(
                        f"insert into {table} (workspace_id, project_id, {cols}) "  # noqa: S608
                        f"values (:w, :p, {vals})"
                    ),
                    {"w": w2, "p": p1},
                )
        with pytest.raises(IntegrityError), eng.begin() as c:
            c.execute(
                text(
                    "insert into time_entries (workspace_id, project_id, worked_on, minutes, "
                    "hourly_cost_minor) values (:w, :p, '2026-01-01', 0, 0)"
                ),
                {"w": w1, "p": p1},
            )
    finally:
        eng.dispose()


def test_health_ready_and_unmigrated_database(
    client: TestClient, db_factory: DbFactory, jwks_url: str
) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").status_code == 200

    empty = db_factory.create()  # no migration applied
    with TestClient(create_app(Settings.from_env(env_for(empty, jwks_url)))) as c:
        r = c.get("/ready")
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "service_unavailable"
        assert "postgres" not in r.text.lower() and empty not in r.text
        assert c.get("/health").status_code == 200

    with TestClient(create_app(Settings.from_env(env_for(None, jwks_url)))) as c:
        assert c.get("/ready").status_code == 503


def test_ready_error_uses_request_id_header_and_requires_auth_config(
    db_url: str, jwks_url: str
) -> None:
    # Healthy, migrated database but no auth configuration: private API unusable.
    with TestClient(create_app(Settings.from_env(env_for(db_url, None)))) as c:
        r = c.get("/ready", headers={"X-Request-ID": "req-abcdef123456"})
        assert r.status_code == 503
        err = r.json()["error"]
        assert err["code"] == "service_unavailable"
        assert err["request_id"] == r.headers["x-request-id"] == "req-abcdef123456"
        assert db_url not in r.text
        assert c.get("/health").status_code == 200
    # Invalid auth configuration (non-https JWKS) is also not ready.
    bad = env_for(db_url, "http://example.com/jwks")
    with TestClient(create_app(Settings.from_env(bad))) as c:
        r = c.get("/ready")
        assert r.status_code == 503
        assert r.json()["error"]["request_id"] == r.headers["x-request-id"]
    # Auth configured and schema healthy: ready, without probing the provider.
    unreachable = env_for(db_url, "http://127.0.0.1:9/jwks")
    with TestClient(create_app(Settings.from_env(unreachable))) as c:
        assert c.get("/ready").status_code == 200
