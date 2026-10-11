---
version: 1
slug: "apps-web-components-profit-app-tsx"
primary_target: "apps/web/components/profit-app.tsx"
related_targets: ["apps/web/app/page.tsx","apps/web/app/globals.css"]
---

# Profit workspace

Mode: Operate. Audience: freelancers and small agencies comparing project income with labor and expenses.
Primary task: select a workspace and project, inspect the calculation, then record a real transaction.
Platform and stack are confirmed in PRODUCT.md. Visual direction remains an assumption: the decision-page probe returned exit 2 in this headless environment and no structured question tool is available.
Execution: code-led; no image-generation tool or approved comp is available.

## Direction contract

THESIS: Profit Diff makes the gap between the contract and money actually received inspectable; it refuses a generic dashboard of disconnected metric cards.

OWN-WORLD: Cool off-white, near-black green ink, restrained green gains and brick-red losses; flat ruled comparison sheets, consistent tabular numerals, compact outlined controls, no decorative gradients or fake charts.

STORY: A user sees which project is selected, distinguishes promised revenue from receipts, follows expenses and labor to the profit result, and adds the missing evidence through a labeled inline form.

FIRST VIEWPORT: A compact top bar names the workspace. A 280px project rail sits beside a broad two-column contract-versus-actual comparison. The profit equation and time denominator sit directly below it; the visible transaction section holds tabs and one primary add action. Phones stack the rail into a select, keep both comparison labels legible, and place complete forms in the normal document flow. Signature interaction: after a successful persisted entry, the recalculated comparison briefly highlights changed rows with a 180ms background transition, disabled under reduced motion.

FORM: Candidate 7 of seven grounded systems, Profit Diff, seed ebd4384d. Other candidates were a studio job-cost sheet, an estimate comparison, a calendar daybook, a daily ledger, a balance statement, and a kanban production board. Declined challengers raised non-color state clarity, numeric alignment, primary-action visibility and persistent currency context; their visual costumes are not borrowed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

- Thai-first factual copy; no customer, revenue or deployment claims.
- No demonstration records are presented as live data.
- Backend failures, missing authentication configuration and unavailable results are explicit.
- Money formatting uses BigInt and one project currency; currency groups never merge.
- Keyboard labels, focus, announcements, readable contrast and mobile forms are part of completion.
