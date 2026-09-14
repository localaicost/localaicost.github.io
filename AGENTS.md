# AGENTS.md

Single-page calculator: buy a GPU to serve local LLMs, or rent hosted tokens? Read `README.md`
first: formulas, gate order, accuracy caveats and presets live there.

## Keeping this file light

- One line, one thought — no history (git has it), no restating README, preset notes or code.
- Rules constrain what we build; Decisions record deliberate choices. If a decision reads
  like a constraint, move it to Rules.
- Name a card or model only where the choice is specific to it.

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
- One card per row — no multi-GPU composites: the interconnect is a variable the formulas can't
  see (2-card bench: NVLink ~10% off, PCIe Gen3 P2P ~40% off, both degrade 2–4× more by 260K).
- Model presets are current-gen (2026) — check the HF repo `createdAt` before adding.

## Decisions

Made on purpose — don't reverse them silently.

- Table shape: cards are rows, model + usage the variables, price the only per-card input.
  No bandwidth/$ or memory/$ columns — the verdict, t/s, TTFT and break-even columns answer them.
- Decode floor is 10 t/s, not 5 — at 5 a card passed the gate but couldn't pace an agent's
  turns; the same floor sets the agent count.
- Prefill is a disqualifier, not a cost — slow decode, TTFT or weekly turns ⇒ `TOO_SLOW`,
  never a $ penalty.
- Failed-gate rows still show t/s, break-even and $/M — the badge carries the verdict.
- Working context = a session's prompt fill, system prompt included (no separate input — it
  double-counts); presets default 256K, dropdown caps at `maxContextK` (defaults to `contextK`).
- Deliberate preset absences: GPT-OSS-120B (user: tail of the 2026 leaderboard); 2025 Kimi
  small models (K3 / K2.7-Code are 1T-class, no 2026 local-tier Kimi).
- Resale = 25%/yr declining balance over the PASS horizon — businesses rarely resell, so no
  short-hold variant.
- Break-even nets electricity out of hosted savings.
- No data-source table — prices go stale, git dates a number; the preset `note` flags
  estimated specs.
- Power circuits are not modeled — assume 230 V.
- Working context and hosted $/M are prefilled per preset, stay user-editable.
- Quant dropdown spans FP8–4-bit; presets default ~FP4 — below 4-bit agentic quality falls
  double digits and no gate models quality; BF16 weights out (2× FP8 memory, not run locally).
- KV precision is a dropdown (bf16 default, fp8 = ½) — at 256K it flips fit (Qwen3.8-27B on
  5090: 35.0 → 26.6 GB).
- Hosted $/M is input-loaded: `out + (in×(O+T) + in×(1−disc×(1−miss))×(C/2−O−T))/O` — per
  turn the fresh input = O + T, cache reads ≈ C/2−O−T, a miss % at full `in`; full C stays for
  fit and TTFT; no I:O knob, no cache writes.
- Workload = card capacity in the usage hours (no turns input); usage hours are fully busy;
  both break-evens shown, the verdict uses the agents'.
- Usage default 30 h/week — hours the card runs agents under load, not the work week.
- Usage defaults come from a heavy agent user's logged means (650 out / 1350 fresh / 2% miss,
  13.5K Pro-plan requests), not medians or P90 — medians undercount spend, a P90 day
  annualized ~doubles it.
- Turns floor: 1-agent turns/week < 7K ⇒ `TOO_SLOW` (TTFT warning still added) — 7K = one
  Pro-plan user's week, full-price buyers don't buy to match it. Defaults target ~30K/week
  (heavy multi-agent ~60K).
- Agents = most S ≤ sessions fit with t/s per agent ≥ the decode floor; sessions fit =
  `floor((VRAM − weights − 2 GB) ÷ KV per session)` (2 GB engine-level); turns/day at S =
  `usage h × 3600 ÷ ((O+T) ÷ prefill t/s + O ÷ (S × t/s(S)))`; prefill doesn't batch.
- Per-session decode reads every session's KV: `t/s(S) = t/s(1) × (active + KV/2) ÷
  (active + S × KV/2)`, KV at C/2 — anchored at S = 1 (batch-1 estimate and measured override
  stay put; a 2-card bench shows batch-1 also decays with context, single-card magnitude
  unconfirmed — the measured override subsumes it). Lockstep, no compute cap on batched
  decode: optimistic bound.
- Electricity bills TDP for all usage hours — the card runs at capacity for them.
