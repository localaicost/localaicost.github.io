# AGENTS.md

Single-page calculator: should you buy this GPU to serve local LLMs, or rent tokens?
Current UI = all-cards comparison table (one verdict per card for the chosen model/usage,
click a row for a detail strip — only one strip at a time). The earlier single-card view
is at git commit `de17f47` if you want it back. No build, no dependencies, no frameworks.
v3 (not built) = live market price feeds.

## Run / verify

```sh
node test/calc.test.mjs     # the math — must pass before claiming anything works
# UI: open index.html directly, or python3 -m http.server
```

## Layout

- `calc.js` — pure math (fit, decode/prefill estimates, electricity, break-even, gates).
  **Must stay DOM-free**; it's UMD so the same file runs in node and in the browser.
  All estimates, all constants (`GATES`, 50% decode / 35% prefill efficiency) live here.
- `index.html` — UI (card table + model/usage controls + row detail strip), presets, wiring.
  Card specs are fixed in the `CARDS` data; only the per-row price input is user-editable.
  Preset `note` strings are shown in the row detail strip — plain caveats only, no
  dates/sources; the verification record lives in the README data table.
- `test/calc.test.mjs` — pins formulas and gate order. New math → new assertion.
- `README.md` — formulas, accuracy caveats, data status table (verified/unverified).

## Rules

- Every market number (prices, resale %, TFLOPS) is **user-editable input with a sourced
  (in the README data table) or flagged-estimated default**. Never hardcode a "fact" in the
  math; it belongs in the README data table. UI notes stay source-free — flag an estimate
  in plain terms, cite the source and date only in the docs.
- Verified claims in repo docs: state source + date. Unverified/volatile claims: flag them, don't cite.
- Gate order is load-bearing: fit → decode t/s → TTFT → economics. Keep it that way;
  a card that doesn't fit is "DOESN'T FIT", not "expensive".
- Live market price feeds are planned but unbuilt — don't scaffold for it. (The card
  comparison table itself shipped as the v2 UI, see below.)

## Origin & decisions (context a fresh agent won't have)

Bootstrapped from a local-vs-hosted economics discussion + a YouTube transcript
(Jan–Jun 2026 used-market claims). These decisions were made on purpose — don't
reverse them silently:

- **v1 = single-card decision tool (git `de17f47`); the card comparison table shipped
  as the v2 UI at user request** (cards are rows, model+usage are the variables, price is
  the only per-card editable). Deliberately *not* added: bandwidth/$ and memory/$ columns
  — the verdict + t/s/TTFT/break-even columns already answer them; add only when comparing
  on a different axis.
- **Prefill is a disqualifier, not a cost.** Decode < 5 t/s or TTFT > 30 min ⇒
  `TOO_SLOW`. Nobody waits for the cursor, so it's a gate, never a $ penalty.
- **Presets are current-gen (2026) only — check `createdAt` before adding any model.**
  Qwen3-era presets (30B-A3B, 235B-A22B) were removed as dated/low-intelligence; so were
  GLM-4.5-Air (2025-07), Kimi-Linear-48B (2025-10), DeepSeek-Coder-V2-Lite (2024-06) after a
  first pass added them by name instead of date. Current preset set: GLM-5.3-Flash,
  DeepSeek-V4-Flash-0731, Qwen3.8-Flash-Next, Qwen3.8-27B (all 2026, verified 2026-09-12).
  GPT-OSS-120B deliberately absent (user: tail of the 2026 leaderboard).
- **Kimi has no 2026 local-tier LLM** — K3 / K2.7-Code (Jun 2026) are 1T-class. Don't add
  2025 Kimi small models "for coverage".
- **Resale % is a uniform 40% on every card** (user call, Sep 2026: one year of a 3–4 y
  corporate amortization horizon), replacing the per-card 30–35% guesses. Per-card notes
  no longer restate resale — the "Accuracy & sources" block is the single place it's
  flagged, and the M3 Ultra note keeps the 11%-trade-in data point as a caveat.
- **Hosted $/M is prefilled per model preset** (each model has its own API price,
  verified 2026-09-12); the usage field stays user-editable and the strip's "Hosted
  bar" follows it. Previously it was a single fixed 0.47 default — misleading for
  models like Qwen3.8-27B at $3/M.
- **Used-market prices and the DRAM trend are NOT verified** (volatile / no project
  value). Verified 2026-09-12: RTX PRO 6000 $16k, hosted output $/M per model —
  see README data table; re-check before citing prices as facts.

## Known simplifications

- Money is per **output** token; hosted pricing is in/out asymmetric, so input-heavy
  agent workloads skew the comparison.
- Batch 1 only; no multi-user serving, no prefill/decode disaggregation.
- Electricity assumes the box idles 24/7 and loads only during usage hours.
- MoE decode runs cooler than the 50% efficiency default (one measured run: ~28%);
  the measured-t/s override exists for exactly this — keep it prominent.
