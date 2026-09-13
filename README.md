# LocalAI Cost (localaicost.com)

Single-page calculator: should I buy this GPU/machine to serve local LLMs, or rent tokens?
The UI lists every card with one verdict each for the chosen model and usage.

## Run

No build, no deps.

```sh
# tests (the math lives in calc.js, pure and node-runnable)
node test/calc.test.mjs

# UI (needs HTTP; file:// can't fetch the presets)
python3 -m http.server 8080   # → http://localhost:8080
```

## The model

Gates run in series; failing one sets the verdict (break-even and $/M are still shown):

1. Fit —
   `total_params × bytes/weight + KV/1K × (system prompt + working context) + 2 GB ≤ VRAM`.
2. Usability — decode ≥ 5 t/s; first token (system prompt + working context)
   ≤ 30 min prefill, warn above 5 min. Rationale: slow decode is un-interactive;
   nobody waits 30 min for an agent to start working.
3. Economics — break-even = `price × (1 − 0.75³)` ÷ (annual hosted-dollar value
   of the tokens you actually generate − annual electricity). `BUY` if ≤ 3 years,
   `RENT` otherwise.

Verdicts: `BUY` / `RENT` / `NO_FIT` / `TOO_SLOW` (shown as "NO FIT" / "TOO SLOW") +
one-line reasons.

System prompt is the agent harness's fixed prompt (instructions, tool definitions), sent
ahead of the working context. It fills KV and prefill like any other token. System prompt +
working context is capped at the model's window (preset `contextK`).

## Accuracy

Everything is an **estimate for gating**, not a performance prediction:

- Decode: `t/s = bandwidth ÷ (active × bytes) × 50%`. Batch-1 decode is
  bandwidth-bound; the 50% covers kernel overhead. MoE caveat: sparse expert
  gather runs cooler than dense (one measured GPT-OSS-class run hit ~28%, not 50%),
  so MoE estimates skew optimistic — put a measured figure in the override field
  if you have one. It wins over the estimate.
- Prefill: `t/s = TFLOPS × 35% ÷ (2 × active)`. Coarse (MoE prefill, batching, framework
  efficiency and long-context attention cost all move it); it only feeds the TTFT gate.
- TFLOPS is FP16-dense class; estimated specs are flagged in the card's note. Prices are street
  estimates.
- KV/1K values are bf16; the KV cache precision dropdown halves them for fp8.
- Break-even horizon (3 y) is the "new" hardware tier: the card is still in use at 3 y,
  then resold. Hardware tiers by age: new 2–3 y, mid cycle 3–5 y, old 5–8 y.
- Resale follows 25%/yr depreciation: 42% back after 3 y, 24% after 5 y, 10% after 8 y.
  The strip's local $/M columns (3 / 5 / 8 y) each use their own resale.
- Electricity assumes the box idles 24/7 and runs at TDP only during usage hours.
- **Money is per output token.** Hosted input is priced separately, so input-heavy agent
  workloads skew the comparison.
- Batch 1 only — no multi-user serving, no prefill/decode disaggregation.

Editable in the UI: card price, quant, KV cache precision, and the usage fields.
Card specs and model parameters
are fixed preset data.

## Presets

Cards: RTX PRO 6000, RTX 3090 (used), 4090, 5090, 2×4090, DGX Spark, Mac Studio M3 Ultra 512 GB,
Mac Studio M5 Ultra 512 GB, and the server tier: H100 PCIe 80 GB, H100 NVL 94 GB, H200 141 GB,
B200 180 GB, B300 288 GB.

Models: GLM-5.3-Flash, DeepSeek-V4-Flash-0731, Qwen3.8-Flash-Next, Qwen3.8-27B.

### Adding a model preset

- Bytes per weight: one of the UI quant dropdown values — effective bytes incl. scale/min
  overhead (a raw 4-bit format is 0.5, real block-quants sit above it).
- `kvPerKGB` (GB of KV per 1K tokens) = `2 × layers × kv_heads × head_dim × kv_bytes ÷ 10⁶`.
  Hybrid linear-attention models: `layers` = full-attention layers only — linear/DeltaNet
  layers hold a constant-size state, not per-token KV. MHA: `kv_heads = num_attention_heads`;
  GQA: `num_key_value_heads`; MLA/latent-compressed: derive from the latent dim. Halve it for
  fp8 KV.
- `contextK` (default working context, K tokens): the model's advertised context. It also caps
  system prompt + working context, and is prefilled into the Working context dropdown on model
  select. A value missing from the dropdown (128/256/512/1000) gets its own option added.
- MoE: `totalParamsB` = everything that must be VRAM-resident (all experts);
  `activeParamsB` = routed per token. Tables deliberately offloaded to system RAM go in the
  note, not in `totalParamsB`.
