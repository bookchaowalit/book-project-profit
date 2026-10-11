"""Authorization, aggregation, audit and idempotency helpers (all PostgreSQL-backed)."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Numeric, Select, cast, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import Principal
from app.errors import AppError, not_found
from app.models import (
    AuditEvent,
    Expense,
    IdempotencyKey,
    Payment,
    Project,
    TimeEntry,
    WorkspaceMember,
)
from app.money import Totals

WRITE_ROLES = frozenset({"owner", "editor"})
_KEY_RE = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")


def require_role(
    session: Session, workspace_id: uuid.UUID, principal: Principal, *, write: bool
) -> str:
    """Role comes from stored membership of the verified identity, never from the caller."""
    role = session.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.issuer == principal.issuer,
            WorkspaceMember.subject == principal.subject,
        )
    )
    if role is None:
        raise not_found("Workspace not found")
    if write and role not in WRITE_ROLES:
        raise AppError(403, "forbidden", "Your role does not allow this change")
    return str(role)


def get_project(session: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = session.scalar(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    )
    if project is None:
        raise not_found("Project not found")
    return project


def record_audit(
    session: Session,
    *,
    workspace_id: uuid.UUID,
    principal: Principal,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    request_id: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditEvent(
            workspace_id=workspace_id,
            actor_issuer=principal.issuer,
            actor_subject=principal.subject,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            request_id=request_id[:64],
            event_metadata=metadata or {},
        )
    )


# ---------------------------------------------------------------- aggregation


@dataclass(frozen=True)
class ProjectAgg:
    totals: Totals


def _labor_expr() -> Any:
    # round-half-up(minutes * rate / 60) per entry, summed exactly in numeric.
    return func.div(
        cast(TimeEntry.minutes, Numeric) * cast(TimeEntry.hourly_cost_minor, Numeric) + 30, 60
    )


def _aggregate_query(workspace_id: uuid.UUID, ids: list[uuid.UUID] | None) -> Select[Any]:
    def scope(model: Any, stmt: Any) -> Any:
        stmt = stmt.where(model.workspace_id == workspace_id)
        if ids is not None:
            stmt = stmt.where(model.project_id.in_(ids))
        return stmt.group_by(model.project_id)

    pay = scope(
        Payment,
        select(Payment.project_id.label("pid"), func.sum(Payment.amount_minor).label("v")),
    ).subquery()
    exp = scope(
        Expense,
        select(Expense.project_id.label("pid"), func.sum(Expense.amount_minor).label("v")),
    ).subquery()
    tim = scope(
        TimeEntry,
        select(
            TimeEntry.project_id.label("pid"),
            func.sum(_labor_expr()).label("labor"),
            func.sum(TimeEntry.minutes).label("mins"),
        ),
    ).subquery()
    stmt: Select[Any] = (
        select(
            Project.id.label("id"),
            Project.currency.label("currency"),
            Project.contract_value_minor.label("contract"),
            func.coalesce(pay.c.v, 0).label("received"),
            func.coalesce(exp.c.v, 0).label("expense"),
            func.coalesce(tim.c.labor, 0).label("labor"),
            func.coalesce(tim.c.mins, 0).label("minutes"),
        )
        .select_from(Project)
        .outerjoin(pay, pay.c.pid == Project.id)
        .outerjoin(exp, exp.c.pid == Project.id)
        .outerjoin(tim, tim.c.pid == Project.id)
        .where(Project.workspace_id == workspace_id)
    )
    if ids is not None:
        stmt = stmt.where(Project.id.in_(ids))
    return stmt


def project_totals(
    session: Session, workspace_id: uuid.UUID, ids: list[uuid.UUID]
) -> dict[uuid.UUID, Totals]:
    """One aggregate query for a set of projects (no N+1)."""
    if not ids:
        return {}
    rows = session.execute(_aggregate_query(workspace_id, ids)).all()
    return {
        r.id: Totals(
            received=int(r.received),
            expense=int(r.expense),
            labor=int(r.labor),
            minutes=int(r.minutes),
            contract=int(r.contract),
        )
        for r in rows
    }


def workspace_totals_by_currency(
    session: Session, workspace_id: uuid.UUID
) -> list[tuple[str, int, Totals]]:
    """(currency, project_count, totals) computed in SQL over every project, unpaginated."""
    sub = _aggregate_query(workspace_id, None).subquery()
    rows = session.execute(
        select(
            sub.c.currency,
            func.count().label("n"),
            func.sum(sub.c.contract, type_=Numeric).label("contract"),
            func.sum(sub.c.received, type_=Numeric).label("received"),
            func.sum(sub.c.expense, type_=Numeric).label("expense"),
            func.sum(sub.c.labor, type_=Numeric).label("labor"),
            func.sum(sub.c.minutes, type_=Numeric).label("minutes"),
        )
        .group_by(sub.c.currency)
        .order_by(sub.c.currency)
    ).all()
    return [
        (
            r.currency,
            int(r.n),
            Totals(
                received=int(r.received),
                expense=int(r.expense),
                labor=int(r.labor),
                minutes=int(r.minutes),
                contract=int(r.contract),
            ),
        )
        for r in rows
    ]


# ---------------------------------------------------------------- idempotency


def validate_idempotency_key(value: str | None) -> str:
    if value is None or not _KEY_RE.match(value):
        raise AppError(
            400,
            "validation_error",
            "Idempotency-Key header is required (1-128 chars: letters, digits, . _ : -)",
        )
    return value


def identity_scope(principal: Principal) -> str:
    digest = hashlib.sha256(f"{principal.issuer}\x00{principal.subject}".encode()).hexdigest()
    return f"identity:{digest}"


def request_hash(method: str, path: str, body: Any) -> str:
    canonical = json.dumps(
        body.model_dump(mode="json", exclude_unset=True), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(f"{method}\n{path}\n{canonical}".encode()).hexdigest()


def run_idempotent(
    session: Session,
    *,
    scope: str,
    key: str,
    req_hash: str,
    create: Callable[[], dict[str, Any]],
) -> tuple[int, dict[str, Any], bool]:
    """Claim the key, run ``create`` and store the response in ONE transaction.

    Concurrent identical requests block on the unique index until the winner
    commits, then replay its stored response. A rolled-back winner leaves no key.
    Returns (status, body, replayed).
    """
    claimed = session.execute(
        pg_insert(IdempotencyKey)
        .values(
            id=uuid.uuid4(),
            scope=scope,
            key=key,
            request_hash=req_hash,
            response_status=201,
            response_body={},
        )
        .on_conflict_do_nothing(index_elements=["scope", "key"])
        .returning(IdempotencyKey.id)
    ).scalar_one_or_none()
    if claimed is None:
        row = session.execute(
            select(
                IdempotencyKey.request_hash,
                IdempotencyKey.response_status,
                IdempotencyKey.response_body,
            ).where(IdempotencyKey.scope == scope, IdempotencyKey.key == key)
        ).one()
        session.rollback()
        if row.request_hash != req_hash:
            raise AppError(
                409,
                "idempotency_conflict",
                "Idempotency-Key was already used for a different request",
            )
        return int(row.response_status), dict(row.response_body), True
    body = create()
    session.execute(
        IdempotencyKey.__table__.update()  # type: ignore[attr-defined]
        .where(IdempotencyKey.id == claimed)
        .values(response_status=201, response_body=body)
    )
    session.commit()
    return 201, body, False
