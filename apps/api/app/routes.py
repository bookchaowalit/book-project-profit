"""v1 routes. (No ``from __future__ import annotations``: FastAPI needs real annotations.)"""

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import Principal, get_principal
from app.db import get_session
from app.errors import AppError, not_found
from app.models import (
    Expense,
    Payment,
    Project,
    TimeEntry,
    Workspace,
    WorkspaceMember,
)
from app.money import Totals, summary_dict
from app.schemas import (
    ExpenseCreate,
    PaymentCreate,
    ProjectCreate,
    ProjectPatch,
    TimeEntryCreate,
    WorkspaceCreate,
)
from app.service import (
    get_project,
    identity_scope,
    project_totals,
    record_audit,
    request_hash,
    require_role,
    run_idempotent,
    validate_idempotency_key,
    workspace_totals_by_currency,
)

router = APIRouter(prefix="/v1")


def _iso(v: dt.date | dt.datetime) -> str:
    return v.isoformat()


def _rid(request: Request) -> str:
    return str(request.state.request_id)


def _created(status: int, body: dict[str, Any], replayed: bool) -> JSONResponse:
    headers = {"Idempotent-Replayed": "true"} if replayed else None
    return JSONResponse(body, status_code=status, headers=headers)


# ------------------------------------------------------------------ workspaces


@router.get("/workspaces")
def list_workspaces(
    principal: Principal = Depends(get_principal), session: Session = Depends(get_session)
) -> dict[str, Any]:
    rows = session.execute(
        select(Workspace.id, Workspace.name, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.issuer == principal.issuer,
            WorkspaceMember.subject == principal.subject,
        )
        .order_by(Workspace.name, Workspace.created_at, Workspace.id)
    ).all()
    items = [{"id": str(r.id), "name": r.name, "role": r.role} for r in rows]
    return {"items": items, "total": len(items)}


@router.post("/workspaces", status_code=201)
def create_workspace(
    body: WorkspaceCreate,
    request: Request,
    idempotency_key: str | None = Header(default=None),
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> JSONResponse:
    key = validate_idempotency_key(idempotency_key)

    def create() -> dict[str, Any]:
        ws = Workspace(name=body.name)
        session.add(ws)
        session.flush()
        session.add(
            WorkspaceMember(
                workspace_id=ws.id,
                issuer=principal.issuer,
                subject=principal.subject,
                role="owner",
            )
        )
        record_audit(
            session,
            workspace_id=ws.id,
            principal=principal,
            action="workspace.create",
            resource_type="workspace",
            resource_id=ws.id,
            request_id=_rid(request),
        )
        session.flush()
        session.refresh(ws)
        return {
            "id": str(ws.id),
            "name": ws.name,
            "role": "owner",
            "created_at": _iso(ws.created_at),
        }

    status, out, replayed = run_idempotent(
        session,
        scope=identity_scope(principal),
        key=key,
        req_hash=request_hash("POST", request.url.path, body),
        create=create,
    )
    return _created(status, out, replayed)


@router.get("/workspaces/{workspace_id}/summary")
def workspace_summary(
    workspace_id: uuid.UUID,
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    require_role(session, workspace_id, principal, write=False)
    groups = workspace_totals_by_currency(session, workspace_id)
    items: list[dict[str, Any]] = []
    for currency, count, t in groups:
        s = summary_dict(t)
        items.append(
            {
                "currency": currency,
                "received_minor": s["received_minor"],
                "expense_minor": s["expense_minor"],
                "labor_cost_minor": s["labor_cost_minor"],
                "cash_surplus_minor": s["cash_surplus_minor"],
                "actual_profit_minor": s["actual_profit_minor"],
                "projected_profit_minor": s["projected_profit_minor"],
                "total_minutes": s["total_minutes"],
                "project_count": count,
            }
        )
    return {"totals_by_currency": items, "project_count": sum(g[1] for g in groups)}


# -------------------------------------------------------------------- projects


def _project_out(p: Project, totals: Totals | None = None) -> dict[str, Any]:
    t = totals or Totals(0, 0, 0, 0, p.contract_value_minor)
    return {
        "id": str(p.id),
        "workspace_id": str(p.workspace_id),
        "name": p.name,
        "client_name": p.client_name,
        "currency": p.currency,
        "contract_value_minor": str(p.contract_value_minor),
        "hourly_cost_minor": str(p.hourly_cost_minor),
        "status": p.status,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
        "summary": summary_dict(t),
    }


def _single_project_out(session: Session, p: Project) -> dict[str, Any]:
    totals = project_totals(session, p.workspace_id, [p.id])
    return _project_out(p, totals.get(p.id))


@router.get("/workspaces/{workspace_id}/projects")
def list_projects(
    workspace_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000_000),
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    require_role(session, workspace_id, principal, write=False)
    total = session.scalar(
        select(func.count()).select_from(Project).where(Project.workspace_id == workspace_id)
    )
    projects = list(
        session.scalars(
            select(Project)
            .where(Project.workspace_id == workspace_id)
            .order_by(Project.created_at.desc(), Project.id)
            .limit(limit)
            .offset(offset)
        )
    )
    totals = project_totals(session, workspace_id, [p.id for p in projects])
    return {
        "items": [_project_out(p, totals.get(p.id)) for p in projects],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
    }


@router.post("/workspaces/{workspace_id}/projects", status_code=201)
def create_project(
    workspace_id: uuid.UUID,
    body: ProjectCreate,
    request: Request,
    idempotency_key: str | None = Header(default=None),
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> JSONResponse:
    require_role(session, workspace_id, principal, write=True)
    key = validate_idempotency_key(idempotency_key)

    def create() -> dict[str, Any]:
        p = Project(
            workspace_id=workspace_id,
            name=body.name,
            client_name=body.client_name,
            currency=body.currency,
            contract_value_minor=int(body.contract_value_minor),
            hourly_cost_minor=int(body.hourly_cost_minor),
            status="active",
        )
        session.add(p)
        session.flush()
        session.refresh(p)
        record_audit(
            session,
            workspace_id=workspace_id,
            principal=principal,
            action="project.create",
            resource_type="project",
            resource_id=p.id,
            request_id=_rid(request),
            metadata={"currency": p.currency},
        )
        session.flush()
        return _project_out(p)

    status, out, replayed = run_idempotent(
        session,
        scope=f"workspace:{workspace_id}",
        key=key,
        req_hash=request_hash("POST", request.url.path, body),
        create=create,
    )
    return _created(status, out, replayed)


@router.get("/workspaces/{workspace_id}/projects/{project_id}")
def read_project(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    require_role(session, workspace_id, principal, write=False)
    return _single_project_out(session, get_project(session, workspace_id, project_id))


@router.patch("/workspaces/{workspace_id}/projects/{project_id}")
def patch_project(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    body: ProjectPatch,
    request: Request,
    principal: Principal = Depends(get_principal),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    require_role(session, workspace_id, principal, write=True)
    changes = body.model_dump(exclude_unset=True)
    if not changes or any(v is None for v in changes.values()):
        raise AppError(
            422, "validation_error", "Invalid request: provide at least one non-null field"
        )
    project = get_project(session, workspace_id, project_id)
    for field, value in changes.items():
        if field in ("contract_value_minor", "hourly_cost_minor"):
            value = int(value)
        setattr(project, field, value)
    project.updated_at = func.now()
    record_audit(
        session,
        workspace_id=workspace_id,
        principal=principal,
        action="project.update",
        resource_type="project",
        resource_id=project.id,
        request_id=_rid(request),
        metadata={"fields": sorted(changes)},
    )
    session.flush()
    session.refresh(project)
    out = _single_project_out(session, project)
    session.commit()
    return out


# ------------------------------------------------- time entries/expenses/payments


def _time_out(r: TimeEntry) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "workspace_id": str(r.workspace_id),
        "project_id": str(r.project_id),
        "worked_on": _iso(r.worked_on),
        "minutes": r.minutes,
        "hourly_cost_minor": str(r.hourly_cost_minor),
        "note": r.note,
        "created_at": _iso(r.created_at),
    }


def _expense_out(r: Expense) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "workspace_id": str(r.workspace_id),
        "project_id": str(r.project_id),
        "spent_on": _iso(r.spent_on),
        "amount_minor": str(r.amount_minor),
        "description": r.description,
        "created_at": _iso(r.created_at),
    }


def _payment_out(r: Payment) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "workspace_id": str(r.workspace_id),
        "project_id": str(r.project_id),
        "received_on": _iso(r.received_on),
        "amount_minor": str(r.amount_minor),
        "note": r.note,
        "created_at": _iso(r.created_at),
    }


def _register(
    path: str,
    resource_type: str,
    model: Any,
    date_col: Any,
    schema: type[BaseModel],
    build: Any,
    out: Any,
) -> None:
    base = "/workspaces/{workspace_id}/projects/{project_id}/" + path

    @router.get(base, name=f"list_{resource_type}")
    def list_records(
        workspace_id: uuid.UUID,
        project_id: uuid.UUID,
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=10_000_000),
        principal: Principal = Depends(get_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        require_role(session, workspace_id, principal, write=False)
        get_project(session, workspace_id, project_id)
        scope = (model.workspace_id == workspace_id, model.project_id == project_id)
        total = session.scalar(select(func.count()).select_from(model).where(*scope))
        rows = session.scalars(
            select(model)
            .where(*scope)
            .order_by(date_col.desc(), model.created_at.desc(), model.id)
            .limit(limit)
            .offset(offset)
        )
        return {
            "items": [out(r) for r in rows],
            "total": int(total or 0),
            "limit": limit,
            "offset": offset,
        }

    @router.post(base, status_code=201, name=f"create_{resource_type}")
    def create_record(
        workspace_id: uuid.UUID,
        project_id: uuid.UUID,
        body: schema,  # type: ignore[valid-type]
        request: Request,
        idempotency_key: str | None = Header(default=None),
        principal: Principal = Depends(get_principal),
        session: Session = Depends(get_session),
    ) -> JSONResponse:
        require_role(session, workspace_id, principal, write=True)
        project = get_project(session, workspace_id, project_id)
        key = validate_idempotency_key(idempotency_key)

        def create() -> dict[str, Any]:
            row = build(body, project)
            session.add(row)
            session.flush()
            session.refresh(row)
            record_audit(
                session,
                workspace_id=workspace_id,
                principal=principal,
                action=f"{resource_type}.create",
                resource_type=resource_type,
                resource_id=row.id,
                request_id=_rid(request),
                metadata={"project_id": str(project_id)},
            )
            session.flush()
            result: dict[str, Any] = out(row)
            return result

        status, payload, replayed = run_idempotent(
            session,
            scope=f"workspace:{workspace_id}",
            key=key,
            req_hash=request_hash("POST", request.url.path, body),
            create=create,
        )
        return _created(status, payload, replayed)

    @router.delete(base + "/{entry_id}", status_code=204, name=f"delete_{resource_type}")
    def delete_record(
        workspace_id: uuid.UUID,
        project_id: uuid.UUID,
        entry_id: uuid.UUID,
        request: Request,
        principal: Principal = Depends(get_principal),
        session: Session = Depends(get_session),
    ) -> Response:
        require_role(session, workspace_id, principal, write=True)
        deleted = session.execute(
            delete(model)
            .where(
                model.id == entry_id,
                model.workspace_id == workspace_id,
                model.project_id == project_id,
            )
            .returning(model.id)
        ).scalar_one_or_none()
        if deleted is None:
            raise not_found("Entry not found")
        record_audit(
            session,
            workspace_id=workspace_id,
            principal=principal,
            action=f"{resource_type}.delete",
            resource_type=resource_type,
            resource_id=entry_id,
            request_id=_rid(request),
            metadata={"project_id": str(project_id)},
        )
        session.commit()
        return Response(status_code=204)


def _build_time(b: TimeEntryCreate, p: Project) -> TimeEntry:
    # Snapshot: copy the rate now; later project-rate edits never touch this row.
    rate = p.hourly_cost_minor if b.hourly_cost_minor is None else int(b.hourly_cost_minor)
    return TimeEntry(
        workspace_id=p.workspace_id,
        project_id=p.id,
        worked_on=b.worked_on,
        minutes=b.minutes,
        hourly_cost_minor=rate,
        note=b.note or None,
    )


def _build_expense(b: ExpenseCreate, p: Project) -> Expense:
    return Expense(
        workspace_id=p.workspace_id,
        project_id=p.id,
        spent_on=b.spent_on,
        amount_minor=int(b.amount_minor),
        description=b.description,
    )


def _build_payment(b: PaymentCreate, p: Project) -> Payment:
    return Payment(
        workspace_id=p.workspace_id,
        project_id=p.id,
        received_on=b.received_on,
        amount_minor=int(b.amount_minor),
        note=b.note or None,
    )


_register(
    "time-entries",
    "time_entry",
    TimeEntry,
    TimeEntry.worked_on,
    TimeEntryCreate,
    _build_time,
    _time_out,
)
_register(
    "expenses", "expense", Expense, Expense.spent_on, ExpenseCreate, _build_expense, _expense_out
)
_register(
    "payments", "payment", Payment, Payment.received_on, PaymentCreate, _build_payment, _payment_out
)
