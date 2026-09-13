# AGENTS.md

Single-page calculator: buy a GPU to serve local LLMs, or rent hosted tokens? Read `README.md`
first: formulas, gate order, accuracy caveats and presets live there.

## Files

- `calc.js` — pure math (fit, decode/prefill estimates, electricity, break-even, gates).
- `index.html` — UI (card table, model/usage controls, row detail strip), wiring.
- `cards.json`, `models.json` — card and model presets; add one by appending an object.
  Units follow the field names in `calc.js` (`evaluate`).
- `test/calc.test.mjs` — pins the formulas and gate order; checks every preset evaluates.

## Rules

- `node test/calc.test.mjs` must pass before claiming anything works. New math → new assertion.
- `calc.js` stays DOM-free (UMD, runs in node and the browser). Formulas and assumption
  constants (`GATES`) stay there.
- UI text stays source-free and date-free.
- A preset `note` flags estimated specs in plain terms. Prices are all estimates; don't flag them.
- Take TFLOPS from TechPowerUp's FP16 row; flopper.io shows TechPowerUp's BF16 as FP16 on
  consumer cards. TechPowerUp blocks bots: ask the user to paste the spec block.
- A card `note` adds facts the columns don't show: FP8/FP4 support, cooling, form factor,
  software limits. No market commentary, nothing the table or footer already says.
- Keep the measured-t/s override prominent (README → Accuracy, MoE caveat).
- Formula text lives in four places: `calc.js`, README → Accuracy, AGENTS.md → Decisions,
  `index.html` `accuracy_body`. Change all four together.
- No build, no dependencies, no frameworks.
- No decision dates in AGENTS.md — git history has them.
- Live market price feeds are planned but unbuilt — don't scaffold for them.

## Decisions

Made on purpose — don't reverse them silently.

- **The card comparison table replaced the single-card view** (v1, git `de17f47`) at user
  request: cards are rows, model + usage are the variables, price is the only per-card input.
  No bandwidth/$ or memory/$ columns — the verdict, t/s, TTFT and break-even columns answer them.
- **Prefill is a disqualifier, not a cost.** Slow decode or TTFT ⇒ `TOO_SLOW`, never a $ penalty.
- **Failed-gate rows still show t/s, break-even and $/M**. The badge carries
  the verdict; don't blank the numbers.
- **Working context = a session's prompt fill, system prompt included; presets default to
  256K** — no separate system prompt input; it double-counted tokens already inside the
  context. Advertised 1M defaults overstated an agent session; 128K understated a heavy user's
  (mean context per request 113K → C ≈ 225K). The dropdown caps at `maxContextK` (defaults to
  `contextK`); presets declare it.
- **Presets are current-gen (2026) only — check the HF repo `createdAt` before adding a
  model.** Removed for
  age: Qwen3 30B-A3B / 235B-A22B, GLM-4.5-Air (2025-07), Kimi-Linear-48B (2025-10),
  DeepSeek-Coder-V2-Lite (2024-06); a first pass had added them by name instead of date.
  GPT-OSS-120B is deliberately absent (user: tail of the 2026 leaderboard).
- **Kimi has no 2026 local-tier LLM** — K3 / K2.7-Code (Jun 2026) are 1T-class. Don't add 2025
  Kimi small models "for coverage".
- **Server cards are single cards.** Dropped: H100 SXM (the H100 PCIe variant covers
  it) and the 4×H200 2U composite (a full-box verdict doesn't parse against per-card usage).
  B200 / B300 have no PCIe variant; they stay as SXM for comparison.
- **Resale = declining balance at 25%/yr, card held for the BUY horizon**. Businesses don't
  resell hardware at 18 months (often never), so don't model a 1 y hold.
  Replaced a uniform 40% framed as 1 y resale.
- **Break-even nets electricity out of hosted savings**.
- **No data-source table**. Specs don't change, prices go stale, git history
  dates a number. Don't re-add sources or check dates to README; the preset `note` flags
  estimated specs.
- **Power circuits are not modeled** — assume anyone running a multi-GPU box has 230 V.
- **Working context and hosted $/M are prefilled per model preset** and stay
  user-editable; the earlier single $0.47 default misled for models like Qwen3.8-27B at $3/M.
- **KV cache precision is a dropdown (bf16 default, fp8 = ½)**. First kept unmodeled, added
  on request — at 256K it flips Qwen3.8-27B on the 5090 (35.0 → 26.6 GB).
- **Hosted $/M is input-loaded:** `out + (in×(O+T) + in×(1−disc×(1−miss))×(C/2−O−T))/O` —
  per turn the fresh input = last response O + tool output T, the cache reads ≈
  average session context C/2−O−T (context grows 0 → C), a cache-miss % of them at
  full `in`. Full C stays for the fit and TTFT gates; C−O for cost overstated hosted ~2×.
  Tool output and misses were first left out; at DeepSeek's 97% discount the cache term no
  longer dominates, and leaving them out understated hosted 25–50%. No explicit input:output
  ratio knob, no cache writes. Presets carry `hostedInUsdPerM` + `hostedCacheDiscPct`.
- **Workload = agent turns / week × response tokens, not card t/s × usage hours.** Hosted spend
  from card throughput grew with card speed (B200 × Qwen3.8-Flash ≈ $44K/y hosted). Usage hours
  cap the busy hours (`TOO_SLOW` above them).
- **Usage defaults come from a heavy agent user, not medians or P90** — buyers of these cards
  are heavy users. From 13.5K logged agent requests (Pro plan): per-request means of 654
  output tokens, 1,335 fresh tokens beyond the response on non-miss requests, misses (cache
  write ≥ ½ context) 1% of prefix tokens under a 1 h cache TTL — stable across work weeks.
  Turns = the busiest full work week, 6,500 (other: 5,357); the all-days mean (3,250) counted
  vacation days, and Pro session limits capped both weeks. Means sum to the yearly spend;
  medians undercount it. P90 per-request fields don't co-occur, and a P90 day annualized
  ~doubles spend, pushing verdicts toward BUY.
- **Max-plan parallel-agent volume (~4.5× Pro, ~29K turns/week) is not the default.** It is
  an unverified extrapolation, and serving it needs parallel requests; the model is batch 1.
- **Electricity bills TDP for busy hours, not usage hours** — busy = decode + fresh-input
  prefill for the turns. Billing all usage hours overstated local cost (5090 × Qwen3.8-27B:
  $168 → $45/y, break-even 6.3 → 4.0 y).
