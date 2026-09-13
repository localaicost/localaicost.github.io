# AGENTS.md

Single-page calculator: buy a GPU to serve local LLMs, or rent hosted tokens? Read `README.md`
first: files, formulas, accuracy caveats, data sources and presets live there. This file holds
the rules and the decisions behind them.

## Rules

- `node test/calc.test.mjs` must pass before claiming anything works. New math → new assertion.
- `calc.js` stays DOM-free (UMD, runs in node and the browser). Formulas and assumption
  constants (`GATES`, decode/prefill efficiency) live there; card and model data live
  in `cards.json` / `models.json`.
- Every market number (price, spec, TFLOPS, hosted $/M) gets a row in the README data table:
  source + date if verified, flagged if estimated.
- UI text stays source-free and date-free: flag an estimate in plain terms in the preset `note`;
  cite source and date only in the README.
- Gate order is fit → decode t/s → TTFT → economics. A card that doesn't fit is "NO FIT", not
  "expensive".
- Keep the measured-t/s override prominent (README → Accuracy, MoE caveat).
- No build, no dependencies, no frameworks.
- Live market price feeds are planned but unbuilt — don't scaffold for them.

## Decisions

Made on purpose — don't reverse them silently.

- **The card comparison table replaced the single-card view** (v1, git `de17f47`) at user
  request: cards are rows, model + usage are the variables, price is the only per-card input.
  No bandwidth/$ or memory/$ columns — the verdict, t/s, TTFT and break-even columns answer them.
- **Prefill is a disqualifier, not a cost.** Slow decode or TTFT ⇒ `TOO_SLOW`, never a $ penalty.
- **Presets are current-gen (2026) only — check `createdAt` before adding a model.** Removed for
  age: Qwen3 30B-A3B / 235B-A22B, GLM-4.5-Air (2025-07), Kimi-Linear-48B (2025-10),
  DeepSeek-Coder-V2-Lite (2024-06); a first pass had added them by name instead of date.
  GPT-OSS-120B is deliberately absent (user: tail of the 2026 leaderboard).
- **Kimi has no 2026 local-tier LLM** — K3 / K2.7-Code (Jun 2026) are 1T-class. Don't add 2025
  Kimi small models "for coverage".
- **Server cards are single cards.** Dropped Sep 2026: H100 SXM (the H100 PCIe variant covers
  it) and the 4×H200 2U composite (a full-box verdict doesn't parse against per-card usage).
  B200 / B300 have no PCIe variant; they stay as SXM for comparison.
- **Resale = uniform depreciation, card held for the BUY horizon** (user, 2026-09-13). Businesses
  don't resell hardware at 18 months (often never), so don't model a 1 y hold. Replaced a
  uniform 40% framed as 1 y resale.
- **Break-even nets electricity out of hosted savings** (user, 2026-09-13).
- **Power circuits are not modeled** — assume anyone running a multi-GPU box has 230 V.
- **Hosted $/M is prefilled per model preset** and stays user-editable; the earlier single
  $0.47 default misled for models like Qwen3.8-27B at $3/M.
