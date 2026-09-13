// Runnable check for calc.js — pin the math and the gate order.
// Run: node test/calc.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../calc.js');

// --- fit: 27B Q4 + 32K KV (0.0655 GB/1K) + 2 GB overhead = 16.2 + 2.096 + 2 = 20.296 GB
let mem = C.fitGB(27, 0.6, 0.0655, 32);
assert.ok(Math.abs(mem.totalGB - 20.296) < 0.001, `fit total ${mem.totalGB}`);
// --- fit, fp8 KV: scale halves the KV term = 16.2 + 1.048 + 2 = 19.248 GB
mem = C.fitGB(27, 0.6, 0.0655, 32, 0.5);
assert.ok(Math.abs(mem.totalGB - 19.248) <  0.001, `fit total fp8 ${mem.totalGB}`);

// --- decode: 1792 GB/s, 6B active @ 0.55 bytes/weight, 50% eff → 1792/3.3*0.5 = 271.52
assert.ok(Math.abs(C.decodeTps(1792, 6, 0.55, 50) - 271.515) < 0.01);

// --- prefill: 460 TFLOPS, 27B active, 35% eff → 460e12*.35/(54e9) = 2981.5
assert.ok(Math.abs(C.prefillTps(460, 27, 35) - 2981.48) < 1);

// --- ttft: 64K tokens @ 2981.5 t/s = 21.47 s = 0.358 min
assert.ok(Math.abs(C.ttftMinutes(64000, 2981.48) - 0.3578) < 0.001);

// --- electricity: idle 25W 24/7 + 325W extra for 4 load h/day @ $0.12 → $83.22
assert.ok(Math.abs(C.annualElecUSD(25, 350, 4, 0.12) - 83.22) < 0.01);

// --- resale: 25%/yr depreciation → 42.2% back after the 3 y hold
assert.ok(Math.abs(C.resaleFraction(3) - 0.421875) < 1e-9);

// --- breakeven: net $9250 ($16k × 57.8%), 300 turns/day × 512 tok × 365 = 56.064M tok/y
//     @ $15.95/M → $894.22/y hosted − $131.4/y electricity (PRO 6000) = $762.82/y → 12.13 y
assert.ok(Math.abs(C.breakevenYears(9250, 131.4, 56.064e6, 15.95) - 12.126) < 0.001);

// --- hosted $/M output, input-loaded: out + (in×(O+T) + in×(1−disc×(1−miss))×(C/2−O−T))/O
// 256K context, 512-token response: (128000−512)/512 = 249 → 3 + 0.5 + 0.05×249 = 15.95
assert.ok(Math.abs(C.hostedUsdPerM(3, 0.5, 90, 256, 512) - 15.95) < 0.001);
// half the context ≤ response: nothing to cache → out + in
assert.ok(Math.abs(C.hostedUsdPerM(3, 0.5, 90, 1, 512) - 3.5) < 1e-9);
// no cache discount: the cache reads bill at in → 0.47 + 0.15 + 0.15×249 = 37.97
assert.ok(Math.abs(C.hostedUsdPerM(0.47, 0.15, 0, 256, 512) - 37.97) < 0.001);
// tool output 2000 tok joins the fresh input: (0.5×2512 + 0.05×125488)/512 = 14.71 → 17.71
assert.ok(Math.abs(C.hostedUsdPerM(3, 0.5, 90, 256, 512, 2000) - 17.7078) < 0.001);
// 10% cache misses: cached rate 0.5×(1 − 0.9×0.9) = 0.095 → (1256 + 11921.4)/512 + 3 = 28.74
assert.ok(Math.abs(C.hostedUsdPerM(3, 0.5, 90, 256, 512, 2000, 10) - 28.737) < 0.001);
// 100% misses bill the whole average context at in: 3 + 0.5×128000/512 = 128
assert.ok(Math.abs(C.hostedUsdPerM(3, 0.5, 90, 256, 512, 0, 100) - 128) < 1e-9);
// outTokens 0 (exported surface): guarded divisor stays finite
assert.ok(Number.isFinite(C.hostedUsdPerM(3, 0.5, 90, 256, 0)));

// --- local $/M over 3 y: ($9250 + 3 × $131.4) ÷ 168.192 M tok = $57.34
assert.ok(Math.abs(C.localCostPerM(16000, 131.4, 56.064e6, 3) - 57.340) < 0.001);

// --- end-to-end verdicts
// loaded hosted rate at 32K context, 512-token response + 2000 tool tokens, 5% cache misses:
// cached rate 0.5×(1 − 0.9×0.95) = 0.0725 → 3 + (0.5×2512 + 0.0725×13488)/512 = 7.363
const usage = { hoursPerDay: 4, usdPerKwh: 0.12, contextK: 32, hostedUsdPerM: 3,
  hostedInUsdPerM: 0.5, hostedCacheDiscPct: 90, cacheMissPct: 5,
  outTokensPerTurn: 512, toolTokensPerTurn: 2000 };
const m27   = { totalParamsB: 27, activeParamsB: 27, bytesPerWeight: 0.6, kvPerKGB: 0.0655 };
const m70   = { totalParamsB: 70, activeParamsB: 70, bytesPerWeight: 0.6, kvPerKGB: 0.328 };
const m14   = { totalParamsB: 14, activeParamsB: 14, bytesPerWeight: 0.6, kvPerKGB: 0.082 };
const pro   = { vramGB: 96, bandwidthGBs: 1792, tflops: 504, tdpW: 600, idleW: 30, priceUSD: 16000 };
const r5090 = { vramGB: 32, bandwidthGBs: 1792, tflops: 419, tdpW: 575, idleW: 30, priceUSD: 2400 };
const r3090 = { vramGB: 24, bandwidthGBs: 936, tflops: 142, tdpW: 350, idleW: 25, priceUSD: 946 };
const spark = { vramGB: 128, bandwidthGBs: 273, tflops: 119, tdpW: 140, idleW: 12, priceUSD: 6000 };

// NO_FIT before decode: 70B Q4 needs 54.5 GB > 24; 50 GB/s would also fail decode (0.6 t/s)
let r = C.evaluate({ ...r3090, bandwidthGBs: 50 }, m70, usage);
assert.equal(r.verdict, 'NO_FIT');
assert.equal(r.agents, 0, `agents ${r.agents}`);
// FIT + BUY, 27B on the 3090 at 32K, 4 h/day:
// one agent: 2512 tok ÷ 920.4 t/s prefill + 512 ÷ 28.89 t/s decode = 20.45 s/turn → 704 turns/day
// = 4,929/week → 131.6 M tok/y × $7.363/M = $968.8/y hosted − $83.22/y electricity (TDP all
// 4 h) against net $547 → break-even 0.62 y
// VRAM holds 2 sessions, both ≥ 10 t/s: 28.89 × (16.2 + 1.048) ÷ (16.2 + 2 × 1.048) = 27.23 t/s;
// 2512 ÷ 920.4 + 512 ÷ (2 × 27.23) = 12.13 s/turn → 8,310/week → break-even 0.35 y
r = C.evaluate(r3090, m27, usage);
assert.equal(r.verdict, 'BUY');
assert.equal(r.sessions, 2, `sessions ${r.sessions}`);
assert.equal(r.agents, 2, `agents ${r.agents}`);
assert.ok(Math.abs(r.tpsMulti - 27.234) < 0.001, `tpsMulti ${r.tpsMulti}`);
assert.ok(Math.abs(r.totalGB - (16.2 + 2 * 2.096 + 2)) < 0.001, `fit total ${r.totalGB}`);
assert.ok(Math.abs(r.turnsPerWeek - 4928.5) < 0.5, `turns/week ${r.turnsPerWeek}`);
assert.ok(Math.abs(r.turnsPerWeekMulti - 8310.4) < 0.5, `turns/week multi ${r.turnsPerWeekMulti}`);
assert.ok(Math.abs(r.elecAnnualUSD - 83.22) < 0.01, `electricity ${r.elecAnnualUSD}`);
assert.ok(Math.abs(r.breakevenYears1 - 0.618) < 0.001, `breakeven 1 ${r.breakevenYears1}`);
assert.ok(Math.abs(r.breakevenYears - 0.353) < 0.001, `breakeven ${r.breakevenYears}`);
// hosted spend follows card capacity: the 5090 decodes ~2× the 3090 → more output/year
assert.ok(C.evaluate(r5090, m27, usage).outTokensPerYear > r.outTokensPerYear);
// the 10 t/s floor caps agents below VRAM: 14B on the Spark at 32K fits 44 sessions, but
// 16.25 × (8.4 + 1.312) ÷ (8.4 + S × 1.312) ≥ 10 → S ≤ 5.6 → 5 agents at 10.55 t/s
r = C.evaluate(spark, m14, usage);
assert.equal(r.sessions, 44, `sessions ${r.sessions}`);
assert.equal(r.agents, 5, `agents ${r.agents}`);
assert.ok(Math.abs(r.tpsMulti - 10.549) < 0.001, `tpsMulti ${r.tpsMulti}`);
// verdict follows multi-agent break-even: PRO 6000 × 27B at 0.5 h/day, 37 agents → 6.0 y RENT;
// one agent alone would take 45.6 y
r = C.evaluate(pro, m27, { ...usage, hoursPerDay: 0.5 });
assert.equal(r.verdict, 'RENT');
assert.equal(r.agents, 37, `agents ${r.agents}`);
assert.ok(Math.abs(r.breakevenYears - 6.018) < 0.001, `breakeven ${r.breakevenYears}`);
assert.ok(Math.abs(r.breakevenYears1 - 45.563) < 0.001, `breakeven 1 ${r.breakevenYears1}`);
assert.ok(r.reasons[0].includes('at 37 agents'), r.reasons[0]);
// a 21 GB 3090 holds one 27B session → singular "agent"
r = C.evaluate({ ...r3090, vramGB: 21 }, m27, { ...usage, hoursPerDay: 0.5 });
assert.ok(r.reasons[0].includes('at 1 agent,'), r.reasons[0]);
// 0.1 h/day: one agent never covers electricity; 2 agents take ~41.6 y
r = C.evaluate(r3090, m27, { ...usage, hoursPerDay: 0.1 });
assert.equal(r.verdict, 'RENT');
assert.equal(r.breakevenYears1, Infinity);
assert.ok(r.reasons[0].includes('Break-even ~41.6 y'), r.reasons[0]);
// no usage hours → one reason, not "never breaks even" on top
r = C.evaluate(r3090, m27, { ...usage, hoursPerDay: 0 });
assert.deepEqual(r.reasons, ['No usage hours — nothing to amortize against.']);
// TOO_SLOW, decode before TTFT: 70B Q4 fits the Spark's 128 GB, 273 GB/s → 3.25 t/s < 10;
// 2 TFLOPS would also fail TTFT (~213 min)
r = C.evaluate({ ...spark, tflops: 2 }, m70, usage);
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('t/s'), r.reasons[0]);
// below the floor at one agent → one agent shown
assert.equal(r.agents, 1, `agents ${r.agents}`);
// TOO_SLOW, TTFT: 14B on a 2-TFLOPS 3090, 64K prefill ~43 min
r = C.evaluate({ ...r3090, tflops: 2 }, m14, { ...usage, contextK: 64 });
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('prefill'), r.reasons[0]);
// context over the model max: 512K requested, capped at 256K → 4 sessions of 16.77 GB KV
r = C.evaluate(pro, { ...m27, maxContextK: 256 }, { ...usage, contextK: 512 });
assert.equal(r.sessions, 4, `sessions ${r.sessions}`);
assert.ok(Math.abs(r.totalGB - (16.2 + r.agents * 16.768 + 2)) < 0.001, `fit total ${r.totalGB}`);
// measured t/s override wins over the estimate
r = C.evaluate(r3090, m14, usage, 20);
assert.ok(Math.abs(r.tps - 20) < 1e-9);
// decode floor is 10 t/s: a measured 9 t/s fails usability
r = C.evaluate(r3090, m14, usage, 9);
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('below the 10 t/s'), r.reasons[0]);
// fp8 KV flips 5090 × 27B at 256K context: 35.0 GB (NO_FIT) → 26.6 GB (fits → BUY)
r = C.evaluate(r5090, { ...m27, maxContextK: 256 }, { ...usage, contextK: 256 });
assert.equal(r.verdict, 'NO_FIT');
r = C.evaluate(r5090, { ...m27, maxContextK: 256, kvScale: 0.5 }, { ...usage, contextK: 256 });
assert.equal(r.verdict, 'BUY');

// presets: cards.json × models.json parse and evaluate to finite numbers
const cards = require('../cards.json'), models = require('../models.json');
for (const m of models) {
  assert.ok(Number.isFinite(m.contextK) && m.contextK > 0 && (!m.maxContextK || m.maxContextK >= m.contextK),
    `${m.id}: contextK = ${m.contextK}, maxContextK = ${m.maxContextK}`);
  assert.ok(m.hostedUsdPerM > 0 && m.hostedInUsdPerM > 0 && m.hostedCacheDiscPct >= 0,
    `${m.id}: hosted out/in rates and cache discount`);
}
const uiUsage = { hoursPerDay: 40 / 7, usdPerKwh: 0.12, cacheMissPct: 1,
  outTokensPerTurn: 650, toolTokensPerTurn: 1350 };
for (const m of models) for (const c of cards) {
  r = C.evaluate(c, m, { ...uiUsage, contextK: m.contextK, hostedUsdPerM: m.hostedUsdPerM,
    hostedInUsdPerM: m.hostedInUsdPerM, hostedCacheDiscPct: m.hostedCacheDiscPct });
  assert.ok(r.agents <= r.sessions && r.turnsPerWeekMulti >= r.turnsPerWeek - 1e-6, `${c.id} × ${m.id}: agents`);
  assert.ok(r.tps < C.GATES.decodeTpsMin || r.agents === 0 || r.tpsMulti >= C.GATES.decodeTpsMin - 1e-9,
    `${c.id} × ${m.id}: tpsMulti ${r.tpsMulti}`);
  for (const k of ['totalGB', 'tps', 'tpsMulti', 'ttftMin', 'turnsPerWeek', 'turnsPerWeekMulti', 'netHardwareUSD',
    'elecAnnualUSD', 'hostedUsdPerM', 'sessions', 'agents'])
    assert.ok(Number.isFinite(r[k]), `${c.id} × ${m.id}: ${k} = ${r[k]}`);
}

console.log('calc.js: all checks passed');
