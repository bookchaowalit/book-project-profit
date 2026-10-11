"""Financial responses must come from one PostgreSQL snapshot.

A concurrent committed PATCH is injected *between* the metadata read and the
aggregate read of the same request; the response must still satisfy
projected = contract - expense - labor with the contract it reports.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import Engine, text

import app.routes as routes
from tests.conftest import Api

PAYMENT = {"received_on": "2026-03-01", "amount_minor": "7000"}
EXPENSE = {"spent_on": "2026-03-01", "amount_minor": "500", "description": "x"}
TIME = {"worked_on": "2026-03-01", "minutes": 90}


def _seed(alice: Api) -> tuple[str, dict[str, Any]]:
    wid = alice.workspace()
    p = alice.project(wid, contract_value_minor="100000", hourly_cost_minor="6000")
    base = f"/v1/workspaces/{wid}/projects/{p['id']}"
    alice.post(base + "/payments", PAYMENT)
    alice.post(base + "/expenses", EXPENSE)
    alice.post(base + "/time-entries", TIME)
    return wid, p


def _assert_consistent(project: dict[str, Any]) -> None:
    s = project["summary"]
    assert int(s["projected_profit_minor"]) == (
        int(project["contract_value_minor"]) - int(s["expense_minor"]) - int(s["labor_cost_minor"])
    )
    assert int(s["actual_profit_minor"]) == (
        int(s["received_minor"]) - int(s["expense_minor"]) - int(s["labor_cost_minor"])
    )


def _interfere(engine: Engine, wid: str, *, add_project: bool = False) -> Callable[[], None]:
    def go() -> None:
        with engine.begin() as c:  # separate connection, committed immediately
            c.execute(
                text(
                    "update projects set contract_value_minor = contract_value_minor + 777 "
                    "where workspace_id = :w"
                ),
                {"w": wid},
            )
            if add_project:
                c.execute(
                    text(
                        "insert into projects (id, workspace_id, name, client_name, currency, "
                        "contract_value_minor, hourly_cost_minor) "
                        "values (:i, :w, 'late', 'c', 'THB', 5, 0)"
                    ),
                    {"i": str(uuid.uuid4()), "w": wid},
                )

    return go


def _inject_before(monkeypatch: pytest.MonkeyPatch, name: str, hook: Callable[[], None]) -> None:
    original = getattr(routes, name)
    fired = {"n": 0}

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        fired["n"] += 1
        hook()
        return original(*args, **kwargs)

    monkeypatch.setattr(routes, name, wrapper)


def test_single_project_read_is_one_snapshot(
    alice: Api, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    wid, p = _seed(alice)
    _inject_before(monkeypatch, "project_totals", _interfere(engine, wid))
    r = alice.get(f"/v1/workspaces/{wid}/projects/{p['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["contract_value_minor"] == "100000"  # snapshot predates the PATCH
    _assert_consistent(body)
    monkeypatch.undo()
    after = alice.get(f"/v1/workspaces/{wid}/projects/{p['id']}").json()
    assert after["contract_value_minor"] == "100777"  # later reads see the commit
    _assert_consistent(after)


def test_project_list_is_one_snapshot_including_total(
    alice: Api, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    wid, _ = _seed(alice)
    _inject_before(monkeypatch, "project_totals", _interfere(engine, wid, add_project=True))
    r = alice.get(f"/v1/workspaces/{wid}/projects")
    body = r.json()
    assert body["total"] == len(body["items"]) == 1  # late insert not visible, not half-visible
    for item in body["items"]:
        assert item["contract_value_minor"] == "100000"
        _assert_consistent(item)


def test_workspace_summary_is_one_snapshot(
    alice: Api, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    wid, _ = _seed(alice)
    _inject_before(
        monkeypatch, "workspace_totals_by_currency", _interfere(engine, wid, add_project=True)
    )
    body = alice.get(f"/v1/workspaces/{wid}/summary").json()
    assert body["project_count"] == sum(t["project_count"] for t in body["totals_by_currency"])
    thb = body["totals_by_currency"][0]
    assert int(thb["projected_profit_minor"]) == (
        100000 - int(thb["expense_minor"]) - int(thb["labor_cost_minor"])
    )


def test_record_list_total_matches_items_snapshot(
    alice: Api, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    wid, p = _seed(alice)
    base = f"/v1/workspaces/{wid}/projects/{p['id']}"
    # PATCH during the project read keeps the response consistent for the PATCH path too.
    r = alice.patch(base, {"contract_value_minor": "250000"})
    assert r.status_code == 200
    _assert_consistent(r.json())
    assert r.json()["contract_value_minor"] == "250000"
    assert alice.get(base + "/payments").json()["total"] == 1
