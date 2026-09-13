# llm-card-econ

Single-page calculator: **should I buy this GPU/machine to serve local LLMs, or rent tokens?**

Built from a local-vs-hosted economics discussion (session history) and a YouTube
transcript on local AI hardware (Jan–Jun 2026 claims). The UI lists every card with one
verdict each for the chosen model and usage; click a row for its cost breakdown.
Live market price feeds are not built.

## Run

No build, no deps.

```sh
# tests (the math lives in calc.js, pure and node-runnable)
node test/calc.test.mjs

# UI: open index.html directly, or
python3 -m http.server 8080   # → http://localhost:8080
```

## Files

- `calc.js` — pure math (fit, decode/prefill estimates, electricity, break-even, gates).
- `index.html` — UI (card table, model/usage controls, row detail strip), `CARDS` and
  `MODELS` presets, wiring. Classic script tag, works from `file://`.
- `test/calc.test.mjs` — pins the formulas and gate order.
- `AGENTS.md` — working notes for agents editing this project.

## The model

Gates run in series; failing one stops the economics:

1. **Fit** — `total_params × bytes/weight + KV/1K × context + 2 GB ≤ VRAM`.
2. **Usability** — decode ≥ **5 t/s**; first token (system prompt + working context)
   ≤ **30 min** prefill, warn above 5 min. Rationale: slow decode is un-interactive;
   nobody waits 30 min for an agent to start working.
3. **Economics** — break-even = `price × (1 − 0.75³)` ÷ (annual hosted-dollar value
   of the tokens you actually generate − annual electricity). **BUY** if ≤ 3 years,
   **RENT** otherwise.

Verdicts: `BUY` / `RENT` / `NO_FIT` / `TOO_SLOW` (shown as "NO FIT" / "TOO SLOW") +
one-line reasons.

## Accuracy

Everything is an **estimate for gating**, not a performance prediction:

- **Decode** `t/s = bandwidth ÷ (active × bytes) × 50%`. Batch-1 decode is
  bandwidth-bound; the 50% covers kernel overhead. **MoE caveat:** sparse expert
  gather runs cooler than dense (one measured GPT-OSS-class run hit ~28%, not 50%),
  so MoE estimates skew optimistic — put a measured figure in the override field
  if you have one. It wins over the estimate.
- **Prefill** `t/s = TFLOPS × 35% ÷ (2 × active)`. Coarse (MoE prefill, batching and
  framework efficiency all move it); it only feeds the TTFT gate.
- **TFLOPS** is FP16-dense class. Apple Silicon and 2×4090 values are estimates (no
  published number); the rest are sourced in the data table.
- **KV/1K values** assume bf16 KV. fp8 KV halves them — not modeled.
- **Break-even horizon (3 y)** is the "new" hardware tier: the card is still in use at 3 y,
  then resold. Hardware tiers by age: new 2–3 y, mid cycle 3–5 y, old 5–8 y.
- **Resale** follows 25%/yr depreciation: 42% back after 3 y, 24% after 5 y, 10% after 8 y.
  The strip's local $/M columns (3 / 5 / 8 y) each use their own resale.
- **Electricity** assumes the box idles 24/7 and runs at TDP only during usage hours.
- **Money is per output token.** Hosted input is priced separately, so input-heavy agent
  workloads skew the comparison.
- **Batch 1 only** — no multi-user serving, no prefill/decode disaggregation.

Editable in the UI: card price, quant, and the usage fields. Card specs and model parameters
are fixed preset data.

### Data status (checked 2026-09-13)

| Claim (default in UI) | Status |
|---|---|
| RTX PRO 6000 Blackwell $16,000 | **Verified** — NVIDIA marketplace, Sep 2026; MSRP was $8,565 (Mar 2025), 12-mo median $10,099 |
| Hosted output $/M per model (Flash-Next $0.47; GLM-5.3-Flash $0.50; DS-V4-Flash $0.60 off-peak / $1.20 peak; 27B $3.00) | **Verified** 2026-09-12 — Artificial Analysis, z.ai, DeepSeek, QwenCloud pricing pages |
| GPU specs, non-price — H100 PCIe 80 GB @ 2.0 TB/s, 350 W, FP16-dense 756; H100 NVL 94 GB @ 3.9 TB/s, 350–400 W, 835; H200 141 GB @ 4.8 TB/s, 700 W, 989; B200 192 GB @ 8 TB/s, 1000 W, 2,250; B300 288 GB @ 8 TB/s, 1100 W, ~2,500 (HGX SKU 2,200); PRO 6000 96 GB @ 1792 GB/s, 600 W, FP16 504 (TF32 126); 3090 936 GB/s, 350 W, FP16-dense 142; 4090 1008, 450, 330; 5090 1792, 575, 419; DGX Spark 128 GB @ 273 GB/s, GB10 TDP 140 W (card row uses 170 W whole-box, estimate), FP16 119; M3 Ultra 512 GB @ 819 GB/s, 80-core GPU; M5 Ultra 512 GB @ 1.2 TB/s, 80-core GPU, 480 W max continuous | **Verified** 2026-09-12 — NVIDIA product pages, Hopper in-depth brief, Blackwell tech brief v2.1, GB200/GB300 NVL72 tables; Apple newsroom (2025-03, 2026-08-25). PRO 6000 / 5090 TFLOPS user-provided 2026-09-13; GB10 TFLOPS TechPowerUp GPU DB (user-provided 2026-09-13). Per-card idle power: estimates (nobody publishes it) |
| Model tiers + KV/token (V4-Flash 284B/13B; GLM-5.3-Flash 320B/18B 1M ctx; Flash-Next 125B/6B+51B n-gram; 27B dense) | **Verified** — HF configs/model cards, re-checked 2026-09-12; incl. 27B `kvPerKGB` corrected 0.256→0.064 (16/64 full-attn layers). GLM/DS-V4 KV estimates run conservatively high (see UI notes) |
| H100 PCIe 80 GB $35,000 | **Verified** 2026-09-13 — Newegg listing (user-provided; retailer pages are bot-walled for re-check) |
| H100 NVL $40 K / H200 $45 K / B200 $50 K / B300 $60 K / M5 Ultra 512 GB $18 K | **Unverified estimates** — 2026 HBM shortage; scaled from the verified H100 $35 K. H200 was $30–40 K outright, ~$2.4–4/GPU-h rented (verified 2026-09-12), before the H100 price put it above that range. M5 512 GB CTO price not announced; base 96 GB $5,499 verified 2026-08-25 |
| Depreciation 25%/yr on all cards (42% resale at 3 y) | **Assumption** (user set, 2026-09-13) — typical computer-hardware depreciation; a real 12-mo Mac trade-in returned 11% |
| RTX 4090 $1,600 / RTX 5090 $2,400 / 2×4090 $3,200 | **Unverified estimates** — enter real quotes |
| Used RTX 3090 $946 (+48% Jan→Jun) | **Unverified** — from the video; used market is volatile; edit to your real number |
| DGX Spark $6,000 | **Unverified** — user-provided 2026-09-13 (launch price was $4,699); DRAM shortage is moving it up |
| Mac Studio M3 Ultra 512 GB ~$16.5k | **Unverified** — from the video |
| Idle power per card | **Estimates** — nobody publishes idle draw per SKU; edit if you measure |
| DRAM +172% in 2025 | **Not modeled** — it only reaches you through card prices |

## Presets

Cards: RTX PRO 6000, 3090/4090/5090 (used/retail), 2×4090, DGX Spark, Mac Studio M3 Ultra 512 GB,
Mac Studio M5 Ultra 512 GB, and the server tier: H100 PCIe 80 GB, H100 NVL 94 GB, H200 141 GB,
B200 192 GB, B300 288 GB.

Models (current-gen 2026 local tiers): GLM-5.3-Flash 320B/18B (1M ctx, 3×96 GB tier),
DeepSeek-V4-Flash-0731 284B/13B (1M ctx, 2×96 GB tier), Qwen3.8-Flash-Next (single-96 GB
tier), Qwen3.8-27B dense.

### Adding a model preset

- `bytes/weight`: the UI offers the standard quant dropdown — BF16 2.0, FP8 1.0, Q8_0 1.06,
  Q6_K 0.75, Q5_K_M 0.69, Q4_K_M 0.6, MXFP4 0.55, Q3_K_M 0.47, Q2_K 0.4 (effective bytes
  incl. scale/min overhead; a raw 4-bit format is 0.5, real block-quants sit above it).
- `kvPerKGB` (GB of KV per 1K tokens) = `2 × layers × kv_heads × head_dim × kv_bytes ÷ 10⁶`.
  **Hybrid linear-attention models: `layers` = full-attention layers only** — linear/DeltaNet
  layers hold a constant-size state, not per-token KV (Qwen3.8-27B: 16 of 64; Flash-Next: 12 of 48).
  MHA: `kv_heads = num_attention_heads`; GQA: `num_key_value_heads`; MLA/latent-compressed:
  derive from the latent dim (GPT-OSS-class ≈ 14–25 KB/token). Halve it for fp8 KV.
- MoE: `totalParamsB` = everything that must be VRAM-resident (all experts);
  `activeParamsB` = routed per token. Tables deliberately offloaded to system RAM
  (e.g. Flash-Next's 51 B n-gram) go in the note, **not** in `totalParamsB`.
