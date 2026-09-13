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
// cached rate 0.5×(1 − 0.9×0.95) = 0.0725 → 3 + (0.5×2512 + 0.0725×13488)/512 = 7.363;
// 300 turns/day → 56.064M tok/y
const usage = { hoursPerDay: 4, usdPerKwh: 0.12, contextK: 32, hostedUsdPerM: 3,
  hostedInUsdPerM: 0.5, hostedCacheDiscPct: 90, cacheMissPct: 5, turnsPerDay: 300,
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
// FIT + BUY: 27B fits the 3090 (16.2 + KV 32K × 0.0655 = 2.10 + 2 = 20.3 GB);
// busy 300 × (512/28.9 t/s + 2512/920 t/s) = 1.70 h/day, not the 4 usage hours → $50.54/y
// electricity; $412.8/y hosted against net $547 → break-even ~1.51 y
r = C.evaluate(r3090, m27, usage);
assert.equal(r.verdict, 'BUY');
assert.ok(Math.abs(r.totalGB - 20.296) < 0.001, `fit total ${r.totalGB}`);
assert.ok(Math.abs(r.elecAnnualUSD - 50.54) < 0.01, `electricity ${r.elecAnnualUSD}`);
assert.ok(Math.abs(r.breakevenYears - 1.510) < 0.001, `breakeven ${r.breakevenYears}`);
// hosted spend follows turns, not card speed: 5090 decodes ~2× the 3090, same output/year
assert.equal(C.evaluate(r5090, m27, usage).outTokensPerYear, r.outTokensPerYear);
// FIT + RENT: 100 turns/day → ~5.3 y
r = C.evaluate(r3090, m27, { ...usage, turnsPerDay: 100 });
assert.equal(r.verdict, 'RENT');
assert.ok(Math.abs(r.breakevenYears - 5.298) < 0.001, `breakeven ${r.breakevenYears}`);
assert.ok(r.reasons[0].includes('Break-even'), r.reasons[0]);
// 20 turns/day: saved < electricity → never breaks even
r = C.evaluate(r3090, m27, { ...usage, turnsPerDay: 20 });
assert.equal(r.verdict, 'RENT');
assert.equal(r.breakevenYears, Infinity);
assert.ok(r.reasons[0].includes('Never breaks even'), r.reasons[0]);
// FIT + RENT: same on PRO 6000, 16k card → 10+ y break-even
r = C.evaluate(pro, m27, usage);
assert.equal(r.verdict, 'RENT');
assert.ok(r.breakevenYears > 10, r.breakevenYears);
assert.ok(r.reasons[0].includes('Break-even'), r.reasons[0]);
// TOO_SLOW, capacity: the 1.7 busy h/day above don't fit in 1 usage h/day
r = C.evaluate(r3090, m27, { ...usage, hoursPerDay: 1 });
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('1.7 h/day'), r.reasons[0]);
// no usage hours with turns to serve → capacity fails with its own reason
r = C.evaluate(r3090, m14, { ...usage, hoursPerDay: 0 });
assert.deepEqual(r.reasons, ['No usage hours to serve the turns in.']);
// TOO_SLOW, decode before TTFT: 70B Q4 fits the Spark's 128 GB, 273 GB/s → 3.25 t/s < 5;
// 2 TFLOPS would also fail TTFT (~213 min)
r = C.evaluate({ ...spark, tflops: 2 }, m70, usage);
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('t/s'), r.reasons[0]);
// TOO_SLOW, TTFT before capacity: 14B on a 2-TFLOPS 3090, 64K prefill ~43 min; 1 h/day would
// also fail capacity
r = C.evaluate({ ...r3090, tflops: 2 }, m14, { ...usage, hoursPerDay: 1, contextK: 64 });
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('prefill'), r.reasons[0]);
// no turns → one reason, not "never breaks even" on top
r = C.evaluate(r3090, m14, { ...usage, turnsPerDay: 0 });
assert.deepEqual(r.reasons, ['No turns — nothing to amortize against.']);
// context over the model max: 512K requested, capped at 256K → 16.2 + 16.77 + 2 GB
r = C.evaluate(pro, { ...m27, maxContextK: 256 }, { ...usage, contextK: 512 });
assert.ok(Math.abs(r.totalGB - 34.968) < 0.001, `fit total ${r.totalGB}`);
// measured t/s override wins over the estimate
r = C.evaluate(r3090, m14, usage, 20);
assert.ok(Math.abs(r.tps - 20) < 1e-9);
// fp8 KV flips 5090 × 27B at 256K context: 35.0 GB (NO_FIT) → 26.6 GB (fits, and the loaded
// $23.22/M at 256K breaks even in ~1.1 y → BUY)
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
const uiUsage = { hoursPerDay: 40 / 7, usdPerKwh: 0.12, cacheMissPct: 1, turnsPerDay: 6500 / 7,
  outTokensPerTurn: 650, toolTokensPerTurn: 1350 };
for (const m of models) for (const c of cards) {
  r = C.evaluate(c, m, { ...uiUsage, contextK: m.contextK, hostedUsdPerM: m.hostedUsdPerM,
    hostedInUsdPerM: m.hostedInUsdPerM, hostedCacheDiscPct: m.hostedCacheDiscPct });
  for (const k of ['totalGB', 'tps', 'ttftMin', 'netHardwareUSD', 'elecAnnualUSD', 'hostedUsdPerM'])
    assert.ok(Number.isFinite(r[k]), `${c.id} × ${m.id}: ${k} = ${r[k]}`);
}

console.log('calc.js: all checks passed');
