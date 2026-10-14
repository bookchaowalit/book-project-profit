"""Workspace isolation beyond the single-route checks in test_api.py.

Covers pilot acceptance cases AC-ISO-05, -07b, -12, -13, -14 and -16.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Engine, text

from tests.conftest import ISSUER, Api, add_member
from tests.test_api import RES, pp

PROJECT = {
    "name": "Intruder",
    "client_name": "C",
    "currency": "THB",
    "contract_value_minor": "1",
    "hourly_cost_minor": "1",
}


def every_scoped_call(
    user: Api, wid: str, pid: str, entries: dict[str, str], *, workspace_routes: bool = True
) -> dict[str, Any]:
    """One request per E03-E16 route (E06-E16 only without workspace_routes)."""
    out: dict[str, Any] = {}
    if workspace_routes:
        out["GET summary"] = user.get(f"/v1/workspaces/{wid}/summary")
        out["GET projects"] = user.get(f"/v1/workspaces/{wid}/projects")
        out["POST projects"] = user.post(f"/v1/workspaces/{wid}/projects", PROJECT)
    out["GET project"] = user.get(pp(wid, pid))
    out["PATCH project"] = user.patch(pp(wid, pid), {"name": "Hijacked"})
    for res, entry in entries.items():
        out[f"GET {res}"] = user.get(pp(wid, pid, res))
        out[f"POST {res}"] = user.post(pp(wid, pid, res), RES[res])
        out[f"DELETE {res}"] = user.delete(pp(wid, pid, res) + f"/{entry}")
    return out


def signature(r: Any) -> tuple[int, str, str]:
    err = r.json()["error"]
    return r.status_code, err["code"], err["message"]


def snapshot(owner: Api, wid: str, pid: str) -> dict[str, Any]:
    """Everything the owner can read about one workspace/project."""
    return {
        "summary": owner.get(f"/v1/workspaces/{wid}/summary").json(),
        "projects": owner.get(f"/v1/workspaces/{wid}/projects").json(),
        "project": owner.get(pp(wid, pid)).json(),
        **{res: owner.get(pp(wid, pid, res)).json() for res in RES},
    }


def seeded(owner: Api, name: str) -> tuple[str, str, dict[str, str]]:
    wid = owner.workspace(name)
    pid = owner.project(wid, name=f"{name} project")["id"]
    entries = {res: owner.post(pp(wid, pid, res), RES[res]).json()["id"] for res in RES}
    return wid, pid, entries


# ------------------------------------------------------------ non-member writes


def test_non_member_cannot_create_project_in_other_workspace(alice: Api, bob: Api) -> None:
    wa = alice.workspace("A")
    alice.project(wa)
    bob.workspace("B")
    before = alice.get(f"/v1/workspaces/{wa}/projects").json()

    r = bob.post(f"/v1/workspaces/{wa}/projects", PROJECT)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert alice.get(f"/v1/workspaces/{wa}/projects").json() == before
    assert before["total"] == 1


def test_patch_through_own_workspace_cannot_reach_foreign_project(alice: Api, bob: Api) -> None:
    wa, wb = alice.workspace("A"), bob.workspace("B")
    pa = alice.project(wa)
    bob.project(wb)

    r = bob.patch(pp(wb, pa["id"]), {"name": "Hijacked", "contract_value_minor": "1"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert alice.get(pp(wa, pa["id"])).json() == pa


# ------------------------------------------------- member of both workspaces


def test_member_of_both_workspaces_cannot_mix_ids(
    alice: Api, bob: Api, new_user: Any, engine: Engine
) -> None:
    carol = new_user()
    wa, pa, ea = seeded(alice, "A")
    wb, pb, eb = seeded(bob, "B")
    add_member(engine, wa, carol, "editor")
    add_member(engine, wb, carol, "editor")
    before_a, before_b = snapshot(alice, wa, pa), snapshot(bob, wb, pb)
    # membership itself works, so every 404 below comes from project/entry scoping
    assert carol.get(pp(wa, pa)).status_code == 200
    assert carol.get(pp(wb, pb)).status_code == 200

    for wid, own_pid, foreign_pid, foreign_entries in (
        (wa, pa, pb, eb),
        (wb, pb, pa, ea),
    ):
        mixed = every_scoped_call(carol, wid, foreign_pid, foreign_entries, workspace_routes=False)
        for res, entry in foreign_entries.items():
            # foreign entry under this workspace's own project
            mixed[f"DELETE {res} via own project"] = carol.delete(
                pp(wid, own_pid, res) + f"/{entry}"
            )
        for label, r in mixed.items():
            assert r.status_code == 404, label
            assert r.json()["error"]["code"] == "not_found", label

    assert snapshot(alice, wa, pa) == before_a
    assert snapshot(bob, wb, pb) == before_b
    listed_a = carol.get(f"/v1/workspaces/{wa}/projects").json()
    listed_b = carol.get(f"/v1/workspaces/{wb}/projects").json()
    assert [p["id"] for p in listed_a["items"]] == [pa]
    assert [p["id"] for p in listed_b["items"]] == [pb]
    assert carol.get(f"/v1/workspaces/{wa}/summary").json() == before_a["summary"]
    assert carol.get(f"/v1/workspaces/{wb}/summary").json() == before_b["summary"]


# ------------------------------------------------------- existence not leaked


def test_non_member_response_matches_nonexistent_ids(alice: Api, bob: Api) -> None:
    wa, pa, ea = seeded(alice, "A")
    wb, pb, _ = seeded(bob, "B")
    before = snapshot(alice, wa, pa)

    def fresh() -> str:
        return str(uuid.uuid4())

    # workspace layer: alice's real workspace vs a workspace that does not exist
    real = every_scoped_call(bob, wa, pa, ea)
    ghost = every_scoped_call(bob, fresh(), fresh(), {res: fresh() for res in RES})
    assert real.keys() == ghost.keys()
    for label in real:
        assert real[label].status_code == 404, label
        assert signature(real[label]) == signature(ghost[label]), label

    # project layer: alice's real project vs a missing project, inside bob's own workspace
    real = every_scoped_call(bob, wb, pa, ea, workspace_routes=False)
    ghost = every_scoped_call(
        bob, wb, fresh(), {res: fresh() for res in RES}, workspace_routes=False
    )
    for label in real:
        assert real[label].status_code == 404, label
        assert signature(real[label]) == signature(ghost[label]), label

    # entry layer: alice's real entry vs a missing entry, under bob's own project
    for res in RES:
        r_real = bob.delete(pp(wb, pb, res) + f"/{ea[res]}")
        r_ghost = bob.delete(pp(wb, pb, res) + f"/{fresh()}")
        assert r_real.status_code == 404, res
        assert signature(r_real) == signature(r_ghost), res

    assert snapshot(alice, wa, pa) == before


# ------------------------------------------------------ membership revocation


def test_removed_member_is_refused_on_the_next_request(
    alice: Api, new_user: Any, engine: Engine
) -> None:
    editor = new_user()
    wa, pa, ea = seeded(alice, "A")
    add_member(engine, wa, editor, "editor")
    assert editor.get(f"/v1/workspaces/{wa}/summary").status_code == 200
    assert [w["id"] for w in editor.get("/v1/workspaces").json()["items"]] == [wa]
    before = snapshot(alice, wa, pa)

    with engine.begin() as c:
        removed = c.execute(
            text(
                "DELETE FROM workspace_members "
                "WHERE workspace_id = :w AND issuer = :i AND subject = :s"
            ),
            {"w": wa, "i": ISSUER, "s": editor.sub},
        ).rowcount
    assert removed == 1

    assert editor.get("/v1/workspaces").json() == {"items": [], "total": 0}
    for label, r in every_scoped_call(editor, wa, pa, ea).items():
        assert r.status_code == 404, label
        assert r.json()["error"]["code"] == "not_found", label
    assert snapshot(alice, wa, pa) == before


# ------------------------------------------------------ cross-tenant totals


def test_summary_unchanged_by_heavy_writes_in_other_workspace(alice: Api, bob: Api) -> None:
    wa = alice.workspace("A")
    pa = alice.project(wa, currency="THB", contract_value_minor="500000")
    alice.post(pp(wa, pa["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 45})
    alice.post(pp(wa, pa["id"], "payments"), {"received_on": "2026-03-02", "amount_minor": "9000"})
    alice.post(
        pp(wa, pa["id"], "expenses"),
        {"spent_on": "2026-03-03", "amount_minor": "1200", "description": "Stock"},
    )
    summary_a = alice.get(f"/v1/workspaces/{wa}/summary").json()
    project_a = alice.get(pp(wa, pa["id"])).json()

    wb = bob.workspace("B")
    for i in range(3):
        pb = bob.project(wb, name=f"B{i}", currency="THB", contract_value_minor="999999")
        for j in range(5):
            bob.post(
                pp(wb, pb["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 60 + j}
            )
            bob.post(
                pp(wb, pb["id"], "payments"),
                {"received_on": "2026-03-02", "amount_minor": str(10_000 + j)},
            )
            bob.post(
                pp(wb, pb["id"], "expenses"),
                {"spent_on": "2026-03-03", "amount_minor": str(700 + j), "description": "Bulk"},
            )
    summary_b = bob.get(f"/v1/workspaces/{wb}/summary").json()
    assert summary_b["project_count"] == 3
    assert summary_b["totals_by_currency"][0]["currency"] == "THB"

    assert alice.get(f"/v1/workspaces/{wa}/summary").json() == summary_a
    assert alice.get(pp(wa, pa["id"])).json() == project_a
    assert summary_a["project_count"] == 1
