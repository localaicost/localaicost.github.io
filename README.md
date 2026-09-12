# llm-card-econ

Single-page calculator: **should I buy this GPU/machine to serve local LLMs, or rent tokens?**

Built from a local-vs-hosted economics discussion (session history) and a YouTube
transcript on local AI hardware (Jan–Jun 2026 claims). v1 = one card at a time.
v2 (not built) = side-by-side market table, prefill-as-money, live price feeds.

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
- `index.html` — UI (card comparison table + model/usage controls), presets, wiring.
  Card specs are fixed in the `CARDS` data; only the per-row price input is user-editable.
  Classic script tag, works from `file://`.
- `test/calc.test.mjs` — pins the formulas and gate order.
- `AGENTS.md` — working notes for agents editing this project.

## The model

Gates run in series; failing one stops the economics:

1. **Fit** — `total_params × bytes/weight + KV/1K × context + 2 GB ≤ VRAM`.
2. **Usability** — decode ≥ **5 t/s**; first token (system prompt + working context)
   ≤ **30 min** prefill, warn above 5 min. Rationale: slow decode is un-interactive;
   nobody waits 30 min for an agent to start working.
3. **Economics** — break-even = `price × (1 − resale%)` ÷ annual hosted-dollar value
   of the tokens you actually generate. **BUY** if ≤ 3 years, **RENT** otherwise.

Verdicts: `BUY` / `RENT` / `DOESN'T FIT` / `TOO SLOW` + one-line reasons.

## Accuracy

Everything is an **estimate for gating**, not a performance prediction:

- **Decode** `t/s = bandwidth ÷ (active × bytes) × 50%`. Batch-1 decode is
  bandwidth-bound; the 50% covers kernel overhead. **MoE caveat:** sparse expert
  gather runs cooler than dense (one measured GPT-OSS-class run hit ~28%, not 50%),
  so MoE estimates skew optimistic — put a measured figure in the override field
  if you have one. It wins over the estimate.
- **Prefill** `t/s = TFLOPS × 35% ÷ (2 × active)`. Coarse (MoE prefill, batching and
  framework efficiency all move it); it only feeds the TTFT gate.
- **TFLOPS fields are estimates** (FP16-dense class) where a clean published number
  didn't exist — appliance figures especially. Edit freely.
- **KV/1K values** assume bf16 KV. fp8 KV halves them (use 0.5× in the field).
- **Break-even horizon (3 y)** encodes "a better model lands in ~18 months; the card
  must pay for itself well before it's irrelevant".

### Data status (checked 2026-09-12)

| Claim (default in UI) | Status |
|---|---|
| RTX PRO 6000 Blackwell $16,000 | **Verified** — NVIDIA marketplace, Sep 2026; MSRP was $8,565 (Mar 2025), 12-mo median $10,099 |
| Hosted output $/M per model (Flash-Next $0.47; GLM-5.3-Flash $0.50; DS-V4-Flash $0.60 off-peak / $1.20 peak; 27B $3.00) | **Verified** 2026-09-12 — Artificial Analysis, z.ai, DeepSeek, QwenCloud pricing pages |
| H200 $30–40 K outright, ~$2.4–4/GPU-h rented (Sep 2026) | **Verified** — 2026 GPU pricing trackers |
| H100/B200/B300/4×H200-server prices | **Unverified estimates** — 2026 HBM shortage moves these fast; enter real quotes |
| Resale 40% on all cards | **Assumption** (user set, Sep 2026) — 1 y of a 3–4 y corporate amortization horizon; a real 12-mo Mac trade-in returned 11% |
| Used RTX 3090 $946 (+48% Jan→Jun) | **Unverified** — used market is volatile; edit to your real number |
| DGX Spark $4,699 / Mac Studio 512 GB ~$16.5k | **Unverified** — from the video |
| DRAM +172% in 2025 | **Not modeled** — it only reaches you through card prices and resale % |
| Model tiers (V4-Flash-0731 284B/13B; GLM-5.3-Flash 320B/18B 1M ctx; Qwen3.8 pair) | **Verified** — HF model cards / configs, 2026-09-12 |

## Presets

Cards: RTX PRO 6000, 3090/4090/5090 (used/retail), 2×4090, DGX Spark, M3 Ultra 512 GB, and the
server tier: H100 SXM 80 GB, H100 NVL 94 GB, H200 141 GB, B200 192 GB, B300 288 GB,
4×H200 2U server composite (SMB niche). Server prices are estimates except H200 — get real quotes.
Models — **current-gen (2026) local tiers only** (verified from HF, 2026-09-12):
GLM-5.3-Flash 320B/18B (1M ctx, 3×96 GB tier), DeepSeek-V4-Flash-0731 284B/13B (1M ctx,
2×96 GB tier), Qwen3.8-Flash-Next (single-96 GB tier),
Qwen3.8-27B dense. All fields editable; presets just fill them.
Note: Kimi has no 2026 local-tier LLM — K3 / K2.7-Code (Jun 2026) are 1T-class flagships;
its small models (Kimi-Linear-48B, Moonlight) are 2025 and were dropped with the rest.

### Adding a model preset

- `bytes/weight`: the UI offers the standard quant dropdown — BF16 2.0, FP8 1.0, Q8_0 1.06,
  Q6_K 0.75, Q5_K_M 0.69, Q4_K_M 0.6, MXFP4 0.55, Q3_K_M 0.47, Q2_K 0.4 (effective bytes
  incl. scale/min overhead; a raw 4-bit format is 0.5, real block-quants sit above it).
- `kvPerKGB` (GB of KV per 1K tokens) = `2 × layers × kv_heads × head_dim × kv_bytes ÷ 10⁶`.
  MHA: `kv_heads = num_attention_heads`; GQA: `num_key_value_heads`; MLA/latent-compressed:
  derive from the latent dim (GPT-OSS-class ≈ 14–25 KB/token). Halve it for fp8 KV.
- MoE: `totalParamsB` = everything that must be VRAM-resident (all experts);
  `activeParamsB` = routed per token. Tables deliberately offloaded to system RAM
  (e.g. Flash-Next's 51 B n-gram) go in the note, **not** in `totalParamsB`.
