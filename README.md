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
   `total_params × bytes/weight + KV/1K × working context + 2 GB ≤ VRAM`, i.e. VRAM holds at
   least one session.
2. Usability — decode ≥ 10 t/s for one agent; first token (working context)
   ≤ 30 min prefill, warn above 5 min. Rationale: slow decode is un-interactive;
   nobody waits 30 min for an agent to start working.
3. Economics — break-even = `price × (1 − 0.75³)` ÷ (annual hosted-dollar value
   of the card's output (input-loaded, see Accuracy) − annual
   electricity). `BUY` if ≤ 3 years at the agents' capacity, `RENT` otherwise.

Capacity — the turns the card produces in the usage hours, shown for one agent and for the
most agents it serves:

- Turns / day at S agents = `usage hours × 3600 ÷ ((response + tool output) ÷ prefill t/s +
  response ÷ (S × decode t/s per agent))`. Prefill is compute-bound and does not batch.
- Agents = the most S ≤ sessions fit whose decode t/s per agent stays ≥ 10; sessions fit =
  `floor((VRAM − weights − 2 GB) ÷ KV per session)`.
- Break-even is shown for both; the verdict uses the agents'.

Verdicts: `BUY` / `RENT` / `NO_FIT` / `TOO_SLOW` (shown as "NO FIT" / "TOO SLOW") +
one-line reasons.

Working context is the prompt fill a session reaches — the agent harness's system prompt
included. Presets default to 256K; pick another value for shorter or longer sessions. It is
capped at the model's max supported context (preset `maxContextK`, defaults to `contextK`).

A turn is set by response tokens / turn (default 650) and tool output tokens / turn (default
1,350); cache misses default to 2%. The defaults are per-request means from a heavy agent user.
The number of turns comes from the card's speed and the usage hours.

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
- The card runs at capacity for all usage hours: electricity is idle 24/7 plus TDP for the usage
  hours, and hosted value counts every turn produced. Local prefix cache doesn't expire, so a
  hosted cache miss costs no local prefill.
- **Hosted $/M is input-loaded:**
  `out + (in×(O+T) + in×(1 − cache disc×(1 − misses))×(C/2−O−T)) / O` per M output.
  One agent turn re-sends the context so far as input: the fresh part — the last response O
  plus tool output T — bills at `in`, the repeated prefix at the cache price, except the
  missed share (idle gaps past the cache TTL), which bills at `in`. Context grows from 0 to C
  over a session, so the average turn carries C/2; the fit and TTFT gates use full C.
  C/2 ≤ O + T → the cache term is 0. Not modeled: one-time cache writes.
- Agents: decode per agent at S agents =
  `1-agent t/s × (active GB + KV/2) ÷ (active GB + S × KV/2)` — each step reads the active
  weights once plus every agent's KV at the average context C/2; the 1-agent estimate (or
  measured override) stands for one agent's read. Agents run in lockstep, an optimistic
  bound: staggered duty cycles and the compute limit on batched decode (low-TFLOPS cards such
  as Mac) are not modeled. Prefill is compute-bound and does not scale with batching.

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
- `contextK` (default working context, K tokens): 256; prefilled into the Working context
  dropdown on model select. A value missing from the dropdown (128/256/512/1000) gets its own
  option added.
- `maxContextK`: the model's max supported context, caps the dropdown. Declare it whenever it
  exceeds `contextK`.
- MoE: `totalParamsB` = everything that must be VRAM-resident (all experts);
  `activeParamsB` = routed per token. Tables deliberately offloaded to system RAM go in the
  note, not in `totalParamsB`.
