from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.conftest import Api, add_member

RES: dict[str, dict[str, Any]] = {
    "time-entries": {"worked_on": "2026-03-01", "minutes": 60},
    "expenses": {"spent_on": "2026-03-01", "amount_minor": "500", "description": "Stock"},
    "payments": {"received_on": "2026-03-01", "amount_minor": "7000"},
}


def pp(wid: str, pid: str, res: str = "") -> str:
    return f"/v1/workspaces/{wid}/projects/{pid}" + (f"/{res}" if res else "")


# ------------------------------------------------------------------ basics


def test_workspace_creator_is_owner_and_listing_is_scoped(alice: Api, bob: Api) -> None:
    wid = alice.workspace("Mine")
    items = alice.get("/v1/workspaces").json()
    assert items == {"items": [{"id": wid, "name": "Mine", "role": "owner"}], "total": 1}
    assert bob.get("/v1/workspaces").json() == {"items": [], "total": 0}


def test_project_crud_persists_and_currency_is_immutable(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid, name="  Site  ")
    assert p["name"] == "Site" and p["status"] == "active"
    assert p["summary"]["profit_per_hour_minor"] is None and p["summary"]["margin_percent"] is None
    assert p["summary"]["projected_profit_minor"] == "100000"
    got = alice.get(pp(wid, p["id"])).json()
    assert got == p
    r = alice.patch(pp(wid, p["id"]), {"status": "completed", "contract_value_minor": "123"})
    assert r.status_code == 200
    assert r.json()["status"] == "completed" and r.json()["contract_value_minor"] == "123"
    assert alice.patch(pp(wid, p["id"]), {"currency": "USD"}).status_code == 422
    assert alice.patch(pp(wid, p["id"]), {}).status_code == 422
    assert alice.patch(pp(wid, p["id"]), {"status": "bogus"}).status_code == 422
    assert alice.patch(pp(wid, p["id"]), {"name": None}).status_code == 422
    lst = alice.get(f"/v1/workspaces/{wid}/projects").json()
    assert lst["total"] == 1 and lst["limit"] == 50 and lst["items"][0]["id"] == p["id"]


@pytest.mark.parametrize(
    "res,bad",
    [
        ("time-entries", {"minutes": 0}),
        ("time-entries", {"minutes": 1441}),
        ("time-entries", {"minutes": True}),
        ("time-entries", {"minutes": "60"}),
        ("time-entries", {"minutes": 1.5}),
        ("time-entries", {"worked_on": "2026-02-30"}),
        ("time-entries", {"worked_on": "20260301"}),
        ("time-entries", {"hourly_cost_minor": 100}),
        ("time-entries", {"hourly_cost_minor": "-1"}),
        ("time-entries", {"hourly_cost_minor": "01"}),
        ("time-entries", {"hourly_cost_minor": "1" * 16}),
        ("expenses", {"amount_minor": "0"}),
        ("expenses", {"amount_minor": 5}),
        ("expenses", {"description": "   "}),
        ("expenses", {"description": "x" * 301}),
        ("payments", {"amount_minor": "0"}),
        ("payments", {"note": "n" * 501}),
        ("payments", {"unknown": 1}),
    ],
)
def test_record_validation(alice: Api, res: str, bad: dict[str, Any]) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    r = alice.post(pp(wid, p["id"], res), {**dict(RES[res]), **bad})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"


def test_project_validation(alice: Api) -> None:
    wid = alice.workspace()
    base = {
        "name": "P",
        "client_name": "C",
        "currency": "THB",
        "contract_value_minor": "0",
        "hourly_cost_minor": "0",
    }
    assert alice.post(f"/v1/workspaces/{wid}/projects", base).status_code == 201
    for bad in (
        {"currency": "CAD"},
        {"name": "  "},
        {"contract_value_minor": 5},
        {"contract_value_minor": "-5"},
        {"hourly_cost_minor": "1.5"},
    ):
        assert alice.post(f"/v1/workspaces/{wid}/projects", {**base, **bad}).status_code == 422


def test_records_roundtrip_and_pagination(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    for res, body in RES.items():
        for i in range(3):
            r = alice.post(
                pp(wid, p["id"], res),
                {**dict(body), "note": f"n{i}"} if res != "expenses" else dict(body),
            )
            assert r.status_code == 201
            rec = r.json()
            assert rec["workspace_id"] == wid and rec["project_id"] == p["id"] and rec["created_at"]
        page = alice.get(pp(wid, p["id"], res) + "?limit=2&offset=1").json()
        assert page["total"] == 3 and len(page["items"]) == 2 and page["limit"] == 2
        assert alice.get(pp(wid, p["id"], res) + "?limit=101").status_code == 422
        assert alice.get(pp(wid, p["id"], res) + "?limit=0").status_code == 422
        assert alice.get(pp(wid, p["id"], res) + "?offset=-1").status_code == 422
        assert alice.get(pp(wid, p["id"], res)).json()["limit"] == 50


def test_summary_independent_of_paging_and_per_currency(alice: Api) -> None:
    wid = alice.workspace()
    thb = alice.project(
        wid, currency="THB", contract_value_minor="100000", hourly_cost_minor="6000"
    )
    jpy = alice.project(wid, currency="JPY", contract_value_minor="50000", hourly_cost_minor="1500")
    for _ in range(3):
        alice.post(pp(wid, thb["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 30})
        alice.post(
            pp(wid, thb["id"], "payments"), {"received_on": "2026-03-02", "amount_minor": "20000"}
        )
    alice.post(
        pp(wid, thb["id"], "expenses"),
        {"spent_on": "2026-03-02", "amount_minor": "5000", "description": "x"},
    )
    alice.post(pp(wid, jpy["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 45})
    # THB: labor 3 * 3000 = 9000, received 60000, expense 5000
    one = alice.get(pp(wid, thb["id"], "time-entries") + "?limit=1").json()
    assert len(one["items"]) == 1 and one["total"] == 3
    s = alice.get(pp(wid, thb["id"])).json()["summary"]
    assert s["received_minor"] == "60000" and s["expense_minor"] == "5000"
    assert s["labor_cost_minor"] == "9000" and s["total_minutes"] == 90
    assert s["cash_surplus_minor"] == "55000" and s["actual_profit_minor"] == "46000"
    assert s["projected_profit_minor"] == "86000"
    assert s["profit_per_hour_minor"] == "30667" and s["margin_percent"] == "76.67"
    lst = alice.get(f"/v1/workspaces/{wid}/projects?limit=1&offset=1").json()
    assert lst["total"] == 2 and len(lst["items"]) == 1
    ws = alice.get(f"/v1/workspaces/{wid}/summary").json()
    assert ws["project_count"] == 2
    by = {t["currency"]: t for t in ws["totals_by_currency"]}
    assert set(by) == {"THB", "JPY"}
    assert by["THB"]["actual_profit_minor"] == "46000" and by["THB"]["project_count"] == 1
    assert by["JPY"]["labor_cost_minor"] == "1125" and by["JPY"]["received_minor"] == "0"
    assert by["JPY"]["projected_profit_minor"] == str(50000 - 1125)
    assert by["JPY"]["actual_profit_minor"] == "-1125"
    # empty workspace
    assert alice.get(f"/v1/workspaces/{alice.workspace()}/summary").json() == {
        "totals_by_currency": [],
        "project_count": 0,
    }


def test_max_values_do_not_overflow(alice: Api) -> None:
    wid = alice.workspace()
    big = "999999999999999"
    p = alice.project(wid, contract_value_minor=big, hourly_cost_minor=big)
    alice.post(pp(wid, p["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 1440})
    alice.post(pp(wid, p["id"], "payments"), {"received_on": "2026-03-01", "amount_minor": big})
    s = alice.get(pp(wid, p["id"])).json()["summary"]
    labor = (1440 * int(big) + 30) // 60
    assert s["labor_cost_minor"] == str(labor)
    assert s["actual_profit_minor"] == str(int(big) - labor)
    assert int(s["actual_profit_minor"]) < 0


def test_sql_labor_matches_python_rounding(alice: Api) -> None:
    from app.money import labor_minor

    wid = alice.workspace()
    p = alice.project(wid, hourly_cost_minor="89")
    expected = 0
    for m in (1, 7, 30, 31, 59, 90):
        alice.post(pp(wid, p["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": m})
        expected += labor_minor(m, 89)
    assert alice.get(pp(wid, p["id"])).json()["summary"]["labor_cost_minor"] == str(expected)


def test_rate_snapshot_not_mutated_by_default_change(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid, hourly_cost_minor="6000")
    e1 = alice.post(
        pp(wid, p["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 60}
    ).json()
    assert e1["hourly_cost_minor"] == "6000"
    alice.patch(pp(wid, p["id"]), {"hourly_cost_minor": "9000"})
    e2 = alice.post(
        pp(wid, p["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 60}
    ).json()
    e3 = alice.post(
        pp(wid, p["id"], "time-entries"),
        {"worked_on": "2026-03-01", "minutes": 60, "hourly_cost_minor": "100"},
    ).json()
    assert (e2["hourly_cost_minor"], e3["hourly_cost_minor"]) == ("9000", "100")
    items = {i["id"]: i for i in alice.get(pp(wid, p["id"], "time-entries")).json()["items"]}
    assert items[e1["id"]]["hourly_cost_minor"] == "6000"
    assert alice.get(pp(wid, p["id"])).json()["summary"]["labor_cost_minor"] == str(
        6000 + 9000 + 100
    )


# ------------------------------------------------------------ roles / isolation


def test_roles(alice: Api, new_user: Any, engine: Engine) -> None:
    editor, viewer = new_user(), new_user()
    wid = alice.workspace()
    add_member(engine, wid, editor, "editor")
    add_member(engine, wid, viewer, "viewer")
    p = alice.project(wid)
    path = pp(wid, p["id"])
    rec = alice.post(path + "/payments", RES["payments"]).json()

    assert editor.post(path + "/payments", RES["payments"]).status_code == 201
    assert editor.patch(path, {"name": "Edited"}).status_code == 200
    assert editor.project(wid)["name"] == "Proj"

    assert viewer.get(path).status_code == 200
    assert viewer.get(path + "/payments").status_code == 200
    assert viewer.get(f"/v1/workspaces/{wid}/summary").status_code == 200
    forbidden = [
        viewer.post(
            f"/v1/workspaces/{wid}/projects",
            {
                "name": "x",
                "client_name": "",
                "currency": "USD",
                "contract_value_minor": "1",
                "hourly_cost_minor": "1",
            },
        ),
        viewer.patch(path, {"name": "no"}),
        viewer.post(path + "/payments", RES["payments"]),
        viewer.post(path + "/expenses", RES["expenses"]),
        viewer.post(path + "/time-entries", RES["time-entries"]),
        viewer.delete(path + f"/payments/{rec['id']}"),
    ]
    for r in forbidden:
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert alice.get(path).json()["name"] == "Edited"
    roles = {i["id"]: i["role"] for i in viewer.get("/v1/workspaces").json()["items"]}
    assert roles[wid] == "viewer"
    assert editor.delete(path + f"/payments/{rec['id']}").status_code == 204


@pytest.mark.parametrize("res", list(RES))
def test_cross_workspace_isolation_all_record_routes(alice: Api, bob: Api, res: str) -> None:
    wa, wb = alice.workspace("A"), bob.workspace("B")
    pa, pb = alice.project(wa), bob.project(wb)
    rec = alice.post(pp(wa, pa["id"], res), RES[res]).json()

    # bob in alice's workspace: not found everywhere (existence not leaked)
    assert bob.get(pp(wa, pa["id"])).status_code == 404
    assert bob.get(f"/v1/workspaces/{wa}/projects").status_code == 404
    assert bob.get(f"/v1/workspaces/{wa}/summary").status_code == 404
    assert bob.patch(pp(wa, pa["id"]), {"name": "x"}).status_code == 404
    assert bob.get(pp(wa, pa["id"], res)).status_code == 404
    assert bob.post(pp(wa, pa["id"], res), RES[res]).status_code == 404
    assert bob.delete(pp(wa, pa["id"], res) + f"/{rec['id']}").status_code == 404
    # bob's own workspace with alice's project id
    assert bob.get(pp(wb, pa["id"])).status_code == 404
    assert bob.get(pp(wb, pa["id"], res)).status_code == 404
    assert bob.post(pp(wb, pa["id"], res), RES[res]).status_code == 404
    assert bob.delete(pp(wb, pa["id"], res) + f"/{rec['id']}").status_code == 404
    # alice's entry id under bob's own project
    assert bob.delete(pp(wb, pb["id"], res) + f"/{rec['id']}").status_code == 404
    # nothing leaked or removed
    assert alice.get(pp(wa, pa["id"], res)).json()["total"] == 1
    assert bob.get(pp(wb, pb["id"], res)).json()["total"] == 0


# ------------------------------------------------------------------ delete


def test_delete_updates_totals_and_is_audited(alice: Api, engine: Engine) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    e = alice.post(pp(wid, p["id"], "expenses"), RES["expenses"]).json()
    assert alice.get(pp(wid, p["id"])).json()["summary"]["expense_minor"] == "500"
    assert alice.delete(pp(wid, p["id"], "expenses") + f"/{e['id']}").status_code == 204
    assert alice.get(pp(wid, p["id"])).json()["summary"]["expense_minor"] == "0"
    assert alice.delete(pp(wid, p["id"], "expenses") + f"/{e['id']}").status_code == 404
    with engine.connect() as c:
        rows = c.execute(
            text(
                "select action, metadata::text from audit_events "
                "where workspace_id=:w order by created_at"
            ),
            {"w": wid},
        ).all()
    actions = [r[0] for r in rows]
    assert actions == ["workspace.create", "project.create", "expense.create", "expense.delete"]
    assert all("Bearer" not in r[1] and "eyJ" not in r[1] for r in rows)


# -------------------------------------------------------------- idempotency


def test_idempotency_key_required_on_all_creates(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    assert alice.post("/v1/workspaces", {"name": "x"}, key=None).status_code == 400
    assert alice.post(f"/v1/workspaces/{wid}/projects", {}, key=None).status_code in (400, 422)
    for res in RES:
        r = alice.post(pp(wid, p["id"], res), RES[res], key=None)
        assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
        assert alice.post(pp(wid, p["id"], res), RES[res], key="bad key!").status_code == 400
        assert alice.get(pp(wid, p["id"], res)).json()["total"] == 0


def test_replay_returns_same_record_and_conflict_on_different_body(alice: Api) -> None:
    key = "k-" + uuid.uuid4().hex
    r1 = alice.post("/v1/workspaces", {"name": "Once"}, key=key)
    r2 = alice.post("/v1/workspaces", {"name": "Once"}, key=key)
    assert r1.status_code == r2.status_code == 201 and r1.json() == r2.json()
    assert r2.headers["idempotent-replayed"] == "true"
    r3 = alice.post("/v1/workspaces", {"name": "Different"}, key=key)
    assert r3.status_code == 409 and r3.json()["error"]["code"] == "idempotency_conflict"
    assert alice.get("/v1/workspaces").json()["total"] == 1

    wid = r1.json()["id"]
    k2 = "k-" + uuid.uuid4().hex
    body = {
        "name": "P",
        "client_name": "C",
        "currency": "USD",
        "contract_value_minor": "1",
        "hourly_cost_minor": "1",
    }
    a = alice.post(f"/v1/workspaces/{wid}/projects", body, key=k2)
    b = alice.post(f"/v1/workspaces/{wid}/projects", body, key=k2)
    assert a.json() == b.json()
    assert (
        alice.post(f"/v1/workspaces/{wid}/projects", {**body, "name": "Q"}, key=k2).status_code
        == 409
    )
    assert alice.get(f"/v1/workspaces/{wid}/projects").json()["total"] == 1


def test_same_key_other_path_conflicts_and_keys_are_scoped(alice: Api, bob: Api) -> None:
    key = "shared-" + uuid.uuid4().hex
    wa = alice.workspace()
    pa = alice.project(wa)
    assert alice.post(pp(wa, pa["id"], "payments"), RES["payments"], key=key).status_code == 201
    assert alice.post(pp(wa, pa["id"], "expenses"), RES["expenses"], key=key).status_code == 409
    # another identity may reuse the same key string for workspace creation
    assert alice.post("/v1/workspaces", {"name": "x"}, key=key).status_code == 201
    assert bob.post("/v1/workspaces", {"name": "x"}, key=key).status_code == 201
    # and another workspace for records
    wb = bob.workspace()
    pb = bob.project(wb)
    assert bob.post(pp(wb, pb["id"], "payments"), RES["payments"], key=key).status_code == 201


def test_replay_does_not_resurrect_deleted_entry(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    key = uuid.uuid4().hex
    first = alice.post(pp(wid, p["id"], "payments"), RES["payments"], key=key)
    pid = first.json()["id"]
    assert alice.delete(pp(wid, p["id"], "payments") + f"/{pid}").status_code == 204
    again = alice.post(pp(wid, p["id"], "payments"), RES["payments"], key=key)
    assert again.status_code == 201 and again.json()["id"] == pid
    assert alice.get(pp(wid, p["id"], "payments")).json()["total"] == 0
    assert alice.get(pp(wid, p["id"])).json()["summary"]["received_minor"] == "0"


def test_viewer_replay_is_still_forbidden(alice: Api, new_user: Any, engine: Engine) -> None:
    viewer = new_user()
    wid = alice.workspace()
    add_member(engine, wid, viewer, "viewer")
    p = alice.project(wid)
    key = uuid.uuid4().hex
    alice.post(pp(wid, p["id"], "payments"), RES["payments"], key=key)
    assert viewer.post(pp(wid, p["id"], "payments"), RES["payments"], key=key).status_code == 403


def test_concurrent_identical_retries_create_one_record(app: Any, alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    key = uuid.uuid4().hex
    path = pp(wid, p["id"], "payments")

    def call(_: int) -> Any:
        with TestClient(app, raise_server_exceptions=False) as c:
            return c.post(
                path, headers={**alice.headers, "Idempotency-Key": key}, json=RES["payments"]
            )

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(call, range(8)))
    assert {r.status_code for r in results} == {201}
    assert len({r.json()["id"] for r in results}) == 1
    assert alice.get(path).json()["total"] == 1

    # concurrent workspace creation with the same key
    wkey = uuid.uuid4().hex

    def make(_: int) -> Any:
        with TestClient(app, raise_server_exceptions=False) as c:
            return c.post(
                "/v1/workspaces",
                headers={**alice.headers, "Idempotency-Key": wkey},
                json={"name": "Race"},
            )

    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(make, range(8)))
    assert {r.status_code for r in res} == {201} and len({r.json()["id"] for r in res}) == 1
    assert sum(1 for i in alice.get("/v1/workspaces").json()["items"] if i["name"] == "Race") == 1


def test_concurrent_conflicting_bodies(app: Any, alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(wid)
    key = uuid.uuid4().hex
    path = pp(wid, p["id"], "payments")

    def call(i: int) -> Any:
        with TestClient(app, raise_server_exceptions=False) as c:
            body = {"received_on": "2026-03-01", "amount_minor": str(100 + i)}
            return c.post(path, headers={**alice.headers, "Idempotency-Key": key}, json=body)

    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(call, range(6)))
    codes = sorted(r.status_code for r in results)
    assert codes == [201] + [409] * 5
    assert alice.get(path).json()["total"] == 1


# ------------------------------------------------------------------ rollback


def test_failed_write_rolls_back_everything_and_key_is_reusable(
    alice: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.routes as routes

    def boom(*a: Any, **k: Any) -> None:
        raise RuntimeError("postgresql://user:pw@secret-host/db token=abc")

    key = uuid.uuid4().hex
    with monkeypatch.context() as m:
        m.setattr(routes, "record_audit", boom)
        r = alice.post("/v1/workspaces", {"name": "Ghost"}, key=key)
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert "secret-host" not in r.text and "token=abc" not in r.text
    assert alice.get("/v1/workspaces").json()["total"] == 0
    ok = alice.post("/v1/workspaces", {"name": "Ghost"}, key=key)
    assert ok.status_code == 201
    assert "idempotent-replayed" not in ok.headers

    wid = ok.json()["id"]
    p = alice.project(wid)
    with monkeypatch.context() as m:
        m.setattr(routes, "record_audit", boom)
        r = alice.post(pp(wid, p["id"], "payments"), RES["payments"], key=key + "x")
        assert r.status_code == 500
        r = alice.patch(pp(wid, p["id"]), {"name": "Changed"})
        assert r.status_code == 500
    assert alice.get(pp(wid, p["id"], "payments")).json()["total"] == 0
    assert alice.get(pp(wid, p["id"])).json()["name"] == "Proj"
