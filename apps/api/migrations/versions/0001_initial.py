"""initial schema

Revision ID: 0001_initial
Revises:
"""

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

UUID = pg.UUID(as_uuid=True)
GEN = sa.text("gen_random_uuid()")
NOW = sa.text("now()")


def _pk() -> sa.Column[Any]:
    return sa.Column("id", UUID, primary_key=True, server_default=GEN)


def _ts(name: str = "created_at") -> sa.Column[Any]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=NOW)


def _child(table: str, *cols: sa.Column[Any], checks: tuple[sa.CheckConstraint, ...]) -> None:
    op.create_table(
        table,
        _pk(),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        *cols,
        _ts(),
        sa.ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="CASCADE",
            name=f"fk_{table}_project_workspace",
        ),
        *checks,
    )
    op.create_index(f"ix_{table}_project", table, ["workspace_id", "project_id"])


def upgrade() -> None:
    op.create_table(
        "workspaces",
        _pk(),
        sa.Column("name", sa.String(120), nullable=False),
        _ts(),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_workspaces_name"),
    )
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("issuer", sa.String(512), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        _ts(),
        sa.PrimaryKeyConstraint("workspace_id", "issuer", "subject"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.CheckConstraint("role IN ('owner','editor','viewer')", name="ck_members_role"),
    )
    op.create_index("ix_members_identity", "workspace_members", ["issuer", "subject"])
    op.create_table(
        "projects",
        _pk(),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("client_name", sa.String(120), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("contract_value_minor", sa.BigInteger, nullable=False),
        sa.Column("hourly_cost_minor", sa.BigInteger, nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="active"),
        _ts(),
        _ts("updated_at"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_projects_id_workspace"),
        sa.CheckConstraint(
            "currency IN ('THB','USD','EUR','GBP','JPY')", name="ck_projects_currency"
        ),
        sa.CheckConstraint(
            "status IN ('active','completed','archived')", name="ck_projects_status"
        ),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="ck_projects_name"),
        sa.CheckConstraint("contract_value_minor >= 0", name="ck_projects_contract"),
        sa.CheckConstraint("hourly_cost_minor >= 0", name="ck_projects_hourly"),
    )
    op.create_index(
        "ix_projects_workspace_created", "projects", ["workspace_id", "created_at", "id"]
    )
    _child(
        "time_entries",
        sa.Column("worked_on", sa.Date, nullable=False),
        sa.Column("minutes", sa.Integer, nullable=False),
        sa.Column("hourly_cost_minor", sa.BigInteger, nullable=False),
        sa.Column("note", sa.String(500)),
        checks=(
            sa.CheckConstraint("minutes BETWEEN 1 AND 1440", name="ck_time_minutes"),
            sa.CheckConstraint("hourly_cost_minor >= 0", name="ck_time_hourly"),
        ),
    )
    _child(
        "expenses",
        sa.Column("spent_on", sa.Date, nullable=False),
        sa.Column("amount_minor", sa.BigInteger, nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        checks=(
            sa.CheckConstraint("amount_minor > 0", name="ck_expenses_amount"),
            sa.CheckConstraint("char_length(btrim(description)) > 0", name="ck_expenses_desc"),
        ),
    )
    _child(
        "payments",
        sa.Column("received_on", sa.Date, nullable=False),
        sa.Column("amount_minor", sa.BigInteger, nullable=False),
        sa.Column("note", sa.String(500)),
        checks=(sa.CheckConstraint("amount_minor > 0", name="ck_payments_amount"),),
    )
    op.create_table(
        "idempotency_keys",
        _pk(),
        sa.Column("scope", sa.String(100), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_status", sa.Integer, nullable=False),
        sa.Column("response_body", pg.JSONB, nullable=False),
        _ts(),
        sa.UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),
    )
    op.create_index("ix_idempotency_created", "idempotency_keys", ["created_at"])
    op.create_table(
        "audit_events",
        _pk(),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("actor_issuer", sa.String(512), nullable=False),
        sa.Column("actor_subject", sa.String(255), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("resource_type", sa.String(30), nullable=False),
        sa.Column("resource_id", UUID, nullable=False),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("metadata", pg.JSONB, nullable=False),
        _ts(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.CheckConstraint("pg_column_size(metadata) <= 2048", name="ck_audit_metadata_bounded"),
    )
    op.create_index("ix_audit_workspace_created", "audit_events", ["workspace_id", "created_at"])


def downgrade() -> None:
    for table in (
        "audit_events",
        "idempotency_keys",
        "payments",
        "expenses",
        "time_entries",
        "projects",
        "workspace_members",
        "workspaces",
    ):
        op.drop_table(table)
