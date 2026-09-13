// Runnable check for calc.js — pin the math and the gate order.
// Run: node test/calc.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../calc.js');

// --- fit: 27B Q4 + 32K KV (0.0655 GB/1K) + 2 GB overhead = 16.2 + 2.096 + 2 = 20.296 GB
let mem = C.fitGB(27, 0.6, 0.0655, 32);
assert.ok(Math.abs(mem.totalGB - 20.296) < 0.001, `fit total ${mem.totalGB}`);

// --- decode: 1792 GB/s, 6B active @ 0.55 bytes/weight, 50% eff → 1792/3.3*0.5 = 271.52
assert.ok(Math.abs(C.decodeTps(1792, 6, 0.55, 50) - 271.515) < 0.01);

// --- prefill: 460 TFLOPS, 27B active, 35% eff → 460e12*.35/(54e9) = 2981.5
assert.ok(Math.abs(C.prefillTps(460, 27, 35) - 2981.48) < 1);

// --- ttft: 64K tokens @ 2981.5 t/s = 21.47 s = 0.358 min
assert.ok(Math.abs(C.ttftMinutes(64000, 2981.48) - 0.3578) < 0.001);

// --- electricity: idle 25W 24/7 + 325W extra for 4 h/day @ $0.12 → $83.22
assert.ok(Math.abs(C.annualElecUSD(25, 350, 4, 0.12) - 83.22) < 0.01);

// --- resale: 25%/yr depreciation → 42.2% back after the 3 y hold
assert.ok(Math.abs(C.resaleFraction(3) - 0.421875) < 1e-9);

// --- breakeven: net $9250 ($16k × 57.8%), 271.52 t/s @ 4 h/day, $0.47/M → $670.73/y hosted
//     − $131.4/y electricity (PRO 6000, 30 W idle / 600 W load) = $539.33/y → 17.15 y
assert.ok(Math.abs(C.breakevenYears(9250, 131.4, 271.515, 4, 0.47) - 17.15) < 0.01);

// --- local $/M over 3 y: ($9250 + 3 × $131.4) ÷ 4281.25 M tok = $2.25
assert.ok(Math.abs(C.localCostPerM(16000, 131.4, 271.515, 4, 3) - 2.2527) < 0.001);

// --- end-to-end verdicts
const usage = { hoursPerDay: 4, usdPerKwh: 0.12, contextK: 32, systemPromptK: 32, hostedUsdPerM: 0.47 };
const m27   = { totalParamsB: 27, activeParamsB: 27, bytesPerWeight: 0.6, kvPerKGB: 0.0655 };
const m70   = { totalParamsB: 70, activeParamsB: 70, bytesPerWeight: 0.6, kvPerKGB: 0.328 };
const m14   = { totalParamsB: 14, activeParamsB: 14, bytesPerWeight: 0.6, kvPerKGB: 0.082 };
const pro   = { vramGB: 96, bandwidthGBs: 1792, tflops: 504, tdpW: 600, idleW: 30, priceUSD: 16000 };
const r3090 = { vramGB: 24, bandwidthGBs: 936, tflops: 142, tdpW: 350, idleW: 25, priceUSD: 946 };
const spark = { vramGB: 128, bandwidthGBs: 273, tflops: 119, tdpW: 170, idleW: 12, priceUSD: 6000 };

// NO_FIT before decode: 70B Q4 needs 54.5 GB > 24; 50 GB/s would also fail decode (0.6 t/s)
let r = C.evaluate({ ...r3090, bandwidthGBs: 50 }, m70, usage);
assert.equal(r.verdict, 'NO_FIT');
// FIT + RENT: 27B fits the 3090 (16.2 + 2.1 + 2 = 20.3 GB), but 4 h/day @ $0.47/M saves $71/y
// against $83/y electricity → never breaks even
r = C.evaluate(r3090, m27, usage);
assert.equal(r.verdict, 'RENT');
assert.equal(r.breakevenYears, Infinity);
assert.ok(r.reasons[0].includes('Never breaks even'), r.reasons[0]);
// FIT + RENT: same on PRO 6000, 16k card @ 4 h/day → 10+ y break-even
r = C.evaluate(pro, m27, usage);
assert.equal(r.verdict, 'RENT');
assert.ok(r.breakevenYears > 10, r.breakevenYears);
assert.ok(r.reasons[0].includes('Break-even'), r.reasons[0]);
// FIT + BUY: 14B on 3090 at 12 h/day → ~2.5 y
r = C.evaluate(r3090, m14, { ...usage, hoursPerDay: 12 });
assert.equal(r.verdict, 'BUY');
assert.ok(r.breakevenYears < 3, r.breakevenYears);
// TOO_SLOW, decode before TTFT: 70B Q4 fits the Spark's 128 GB, 273 GB/s → 3.25 t/s < 5;
// 2 TFLOPS would also fail TTFT (~213 min)
r = C.evaluate({ ...spark, tflops: 2 }, m70, usage);
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('t/s'), r.reasons[0]);
// TOO_SLOW, TTFT before economics: the BUY case above on a 2-TFLOPS box → 64K prefill ~43 min
r = C.evaluate({ ...r3090, tflops: 2 }, m14, { ...usage, hoursPerDay: 12 });
assert.equal(r.verdict, 'TOO_SLOW');
assert.ok(r.reasons[0].includes('prefill'), r.reasons[0]);
// measured t/s override wins over the estimate
r = C.evaluate(r3090, m14, usage, 20);
assert.ok(Math.abs(r.tps - 20) < 1e-9);

// presets: cards.json × models.json parse and evaluate to finite numbers
const cards = require('../cards.json'), models = require('../models.json');
for (const m of models)
  assert.ok(Number.isFinite(m.contextK) && m.contextK > 0, `${m.id}: contextK = ${m.contextK}`);
const uiUsage = { hoursPerDay: 40 / 7, usdPerKwh: 0.12, systemPromptK: 32 };
for (const m of models) for (const c of cards) {
  r = C.evaluate(c, m, { ...uiUsage, contextK: m.contextK, hostedUsdPerM: m.hostedUsdPerM });
  for (const k of ['totalGB', 'tps', 'ttftMin', 'netHardwareUSD', 'elecAnnualUSD'])
    assert.ok(Number.isFinite(r[k]), `${c.id} × ${m.id}: ${k} = ${r[k]}`);
}

console.log('calc.js: all checks passed');
