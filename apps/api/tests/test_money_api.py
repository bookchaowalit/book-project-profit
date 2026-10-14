"""Financial rules observed end to end through the API (stored, aggregated in SQL, serialized).

Covers pilot acceptance cases AC-MON-02, -04, -05 and -12; the pure rules are in test_money.py.
"""

from __future__ import annotations

from tests.conftest import Api
from tests.test_api import pp


def test_labor_half_up_boundary_per_entry(alice: Api) -> None:
    wid = alice.workspace()
    # 1 minute at 30 / 29 / 90 minor per hour is 0.5 / 0.483 / 1.5 minor
    for rate, labor in (("30", "1"), ("29", "0"), ("90", "2")):
        p = alice.project(wid, hourly_cost_minor=rate)
        e = alice.post(pp(wid, p["id"], "time-entries"), {"worked_on": "2026-03-01", "minutes": 1})
        assert e.status_code == 201 and e.json()["hourly_cost_minor"] == rate
        s = alice.get(pp(wid, p["id"])).json()["summary"]
        assert (s["labor_cost_minor"], s["total_minutes"]) == (labor, 1), rate
    (thb,) = alice.get(f"/v1/workspaces/{wid}/summary").json()["totals_by_currency"]
    assert thb["labor_cost_minor"] == "3" and thb["total_minutes"] == 3


def test_money_without_time_has_null_rate_but_a_margin(alice: Api) -> None:
    wid = alice.workspace()
    paid = alice.project(wid)
    alice.post(
        pp(wid, paid["id"], "payments"), {"received_on": "2026-03-01", "amount_minor": "10000"}
    )
    alice.post(
        pp(wid, paid["id"], "expenses"),
        {"spent_on": "2026-03-02", "amount_minor": "2500", "description": "Stock"},
    )
    s = alice.get(pp(wid, paid["id"])).json()["summary"]
    assert s["total_minutes"] == 0 and s["labor_cost_minor"] == "0"
    assert s["actual_profit_minor"] == "7500"
    assert s["profit_per_hour_minor"] is None
    assert s["margin_percent"] == "75.00"

    unpaid = alice.project(wid)
    alice.post(
        pp(wid, unpaid["id"], "expenses"),
        {"spent_on": "2026-03-02", "amount_minor": "2500", "description": "Stock"},
    )
    s = alice.get(pp(wid, unpaid["id"])).json()["summary"]
    assert s["received_minor"] == "0" and s["actual_profit_minor"] == "-2500"
    assert s["profit_per_hour_minor"] is None and s["margin_percent"] is None


def test_negative_profit_rounds_half_away_from_zero(alice: Api) -> None:
    wid = alice.workspace()
    # (minutes, received, expense) at 100 minor/hour -> actual profit, profit/hour, margin
    cases = (
        # -5 over 2h = -2.5/h -> -3; -5 / 20000 = -0.025% -> -0.03
        (120, "20000", "19805", "-5", "-3", "-0.03"),
        # -9 over 4h = -2.25/h -> -2; -9 / 40000 = -0.0225% -> -0.02 (floor would give -3, -0.03)
        (240, "40000", "39609", "-9", "-2", "-0.02"),
    )
    for minutes, received, expense, actual, per_hour, margin in cases:
        p = alice.project(wid, hourly_cost_minor="100")
        path = pp(wid, p["id"])
        alice.post(path + "/time-entries", {"worked_on": "2026-03-01", "minutes": minutes})
        alice.post(path + "/payments", {"received_on": "2026-03-01", "amount_minor": received})
        alice.post(
            path + "/expenses",
            {"spent_on": "2026-03-01", "amount_minor": expense, "description": "Over budget"},
        )
        s = alice.get(path).json()["summary"]
        assert s["actual_profit_minor"] == actual, minutes
        assert s["profit_per_hour_minor"] == per_hour, minutes
        assert s["margin_percent"] == margin, minutes


def test_reference_example_from_pilot_brief(alice: Api) -> None:
    wid = alice.workspace()
    p = alice.project(
        wid, currency="THB", contract_value_minor="10000000", hourly_cost_minor="60000"
    )
    path = pp(wid, p["id"])
    alice.post(path + "/time-entries", {"worked_on": "2026-03-01", "minutes": 90})
    alice.post(
        path + "/expenses",
        {"spent_on": "2026-03-01", "amount_minor": "50000", "description": "Materials"},
    )
    alice.post(path + "/payments", {"received_on": "2026-03-01", "amount_minor": "300000"})

    expected = {
        "received_minor": "300000",
        "expense_minor": "50000",
        "labor_cost_minor": "90000",
        "cash_surplus_minor": "250000",
        "actual_profit_minor": "160000",
        "projected_profit_minor": "9860000",
        "total_minutes": 90,
        "profit_per_hour_minor": "106667",
        "margin_percent": "53.33",
    }
    first, second = alice.get(path).json(), alice.get(path).json()
    assert first["summary"] == expected
    assert second == first
    (thb,) = alice.get(f"/v1/workspaces/{wid}/summary").json()["totals_by_currency"]
    assert {k: thb[k] for k in thb if k in expected} == {
        k: v for k, v in expected.items() if k not in ("profit_per_hour_minor", "margin_percent")
    }
