/* llm-card-econ — local GPU vs hosted tokens. Pure math, no DOM, no deps.
 *
 * Everything here is an ESTIMATE for gating and amortization, not a
 * performance prediction. Formulas and their limits: README.md → Accuracy.
 * Units: GB, GB/s, TFLOPS (dense, FP16-class), W, USD, tokens, years.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LLMEcon = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GATES = {
    decodeTpsMin: 5,      // TOO_SLOW below
    ttftWarnMin: 5,       // warn above
    ttftFailMin: 30,      // TOO_SLOW above
    buyHorizonYears: 3,   // break-even beyond this → rent; also the resale point
    overheadGB: 2,        // CUDA context + activation margin
    decodeEffPct: 50,     // % of bandwidth-bound decode t/s reached
    prefillEffPct: 35,    // % of TFLOPS-bound prefill t/s reached
    depreciationPerYear: 0.25,
    holdYears: [3, 5, 8]  // local $/M horizons
  };

  // fraction of purchase price recovered on resale after `years`
  function resaleFraction(years) {
    return Math.pow(1 - GATES.depreciationPerYear, years);
  }

  // weights + KV + overhead, for a context of `contextK` thousand tokens
  // kvScale: KV-cache precision, 1 = bf16 (default), 0.5 = fp8
  function fitGB(totalParamsB, bytesPerWeight, kvPerKGB, contextK, kvScale) {
    var weightsGB = totalParamsB * bytesPerWeight;
    var kvGB = kvPerKGB * (kvScale || 1) * contextK;
    return { weightsGB: weightsGB, kvGB: kvGB, totalGB: weightsGB + kvGB + GATES.overheadGB };
  }

  // batch-1 decode is bandwidth-bound: every token re-reads active weights
  function decodeTps(bandwidthGBs, activeParamsB, bytesPerWeight, efficiencyPct) {
    return (bandwidthGBs / (activeParamsB * bytesPerWeight)) * (efficiencyPct / 100);
  }

  // prefill is compute-bound: ~2 FLOPs per active param per token
  function prefillTps(tflops, activeParamsB, efficiencyPct) {
    return (tflops * 1e12 * (efficiencyPct / 100)) / (2 * activeParamsB * 1e9);
  }

  function ttftMinutes(promptTokens, prefillTps) {
    return promptTokens / prefillTps / 60;
  }

  // idle 24/7, TDP for `loadHoursPerDay`
  function annualElecUSD(idleW, loadW, loadHoursPerDay, usdPerKwh) {
    var kwh = (idleW * 8760 + (loadW - idleW) * loadHoursPerDay * 365) / 1000;
    return kwh * usdPerKwh;
  }

  // local cost per 1M output tokens, holding the card `years` then reselling it
  function localCostPerM(priceUSD, elecAnnualUSD, outTokensPerYear, years) {
    var tokens = outTokensPerYear * years;
    if (tokens <= 0) return Infinity;
    return (priceUSD * (1 - resaleFraction(years)) + elecAnnualUSD * years) / (tokens / 1e6);
  }

  // years until the card's net cost is covered by what the workload's tokens would cost
  // hosted, minus the electricity to generate them
  function breakevenYears(netHardwareUSD, elecAnnualUSD, outTokensPerYear, hostedUsdPerM) {
    var savedPerYear = (outTokensPerYear / 1e6) * hostedUsdPerM - elecAnnualUSD;
    if (savedPerYear <= 0) return Infinity;
    return netHardwareUSD / savedPerYear;
  }

  // hosted $/M output incl. input: per turn the fresh input is the last response + tool output
  // (O + T); the rest of the session's average context (C/2 − O − T, context grows 0 → C) bills at
  // the cache discount, except the missed share, which bills at the full input price
  function hostedUsdPerM(outUsd, inUsd, cacheDiscPct, contextK, outTokens, toolTokens, cacheMissPct) {
    var fresh = outTokens + (toolTokens || 0);
    var cached = inUsd * (1 - (cacheDiscPct || 0) / 100 * (1 - (cacheMissPct || 0) / 100));
    return outUsd + (inUsd * fresh + cached * Math.max(contextK * 500 - fresh, 0)) / Math.max(outTokens, 1);
  }

  // card: {vramGB, bandwidthGBs, tflops, tdpW, idleW, priceUSD}
  // model:{totalParamsB, activeParamsB, bytesPerWeight, kvPerKGB, kvScale?, maxContextK?}
  // usage:{hoursPerDay, usdPerKwh, contextK, hostedUsdPerM, hostedInUsdPerM,
  //        hostedCacheDiscPct, cacheMissPct, turnsPerDay, outTokensPerTurn, toolTokensPerTurn,
  //        parallel? (default false)}
  // tpsOverride: measured t/s; wins over the estimate
  function evaluate(card, model, usage, tpsOverride) {
    var reasons = [], costPerM = {};

    // working context = a session's prompt fill (system prompt included), capped at the model's max
    var promptK = (model.maxContextK != null) ? Math.min(usage.contextK, model.maxContextK) : usage.contextK;
    var mem = fitGB(model.totalParamsB, model.bytesPerWeight, model.kvPerKGB, promptK, model.kvScale);
    var fits = mem.totalGB <= card.vramGB;
    // concurrent sessions the VRAM holds: weights + one-time overhead, the rest filled
    // with per-session KV (the 2 GB is engine-level, not per session)
    var sessions = fits && mem.kvGB > 0
      ? Math.floor((card.vramGB - mem.weightsGB - GATES.overheadGB) / mem.kvGB + 1e-9)
      : (fits ? 1 : 0);

    var tps1 = (tpsOverride != null) ? tpsOverride
      : decodeTps(card.bandwidthGBs, model.activeParamsB, model.bytesPerWeight, GATES.decodeEffPct);
    // per-session decode t/s at batch s: each step reads the active weights once plus every
    // session's KV at the average context (C/2); the batch-1 figure stands for one session's read
    var activeGB = model.activeParamsB * model.bytesPerWeight, kvAvgGB = mem.kvGB / 2;
    function tpsAt(s) { return tps1 * (activeGB + kvAvgGB) / (activeGB + s * kvAvgGB); }
    var ptps = prefillTps(card.tflops, model.activeParamsB, GATES.prefillEffPct);
    var ttft = ttftMinutes(promptK * 1000, ptps);

    var netHardware = card.priceUSD * (1 - resaleFraction(GATES.buyHorizonYears));
    var hostedPerM = hostedUsdPerM(usage.hostedUsdPerM, usage.hostedInUsdPerM, usage.hostedCacheDiscPct,
      promptK, usage.outTokensPerTurn, usage.toolTokensPerTurn, usage.cacheMissPct);
    // workload output is set by the user's turns (total across all parallel agents),
    // not by the card's speed
    var outPerYear = usage.turnsPerDay * usage.outTokensPerTurn * 365;
    // the card works only while decoding responses and prefilling fresh input; local prefix
    // cache doesn't expire, so missed hosted cache reads cost no local prefill. Prefill is
    // compute-bound, batching does not shrink it
    var decodeTokens = usage.turnsPerDay * usage.outTokensPerTurn;
    var prefillSec = usage.turnsPerDay * (usage.outTokensPerTurn + (usage.toolTokensPerTurn || 0)) / ptps;
    var hoursSec = usage.hoursPerDay * 3600;
    function busySec(s) { return prefillSec + decodeTokens / (s * tpsAt(s)); }
    // fewest sessions that finish the turns in the usage hours; parallel off = one session
    var sessionsCap = usage.parallel ? sessions : Math.min(sessions, 1);
    var sessionsUsed = sessionsCap > 0 ? 1 : 0;
    while (prefillSec < hoursSec && sessionsUsed < sessionsCap && busySec(sessionsUsed) > hoursSec) sessionsUsed++;
    var s1 = Math.max(sessionsUsed, 1);
    // sessions needed ignoring VRAM: S × tpsAt(S) ≥ rate solves to S ≥ rate × A ÷ (tps1 × (A + K) − rate × K);
    // aggregate decode saturates at tps1 × (A + K) ÷ K, past which no S finishes the turns
    var sNeeded = Infinity;
    if (usage.parallel && prefillSec < hoursSec) {
      var rate = decodeTokens / (hoursSec - prefillSec);
      var den = tps1 * (activeGB + kvAvgGB) - rate * kvAvgGB;
      if (den > 0) sNeeded = Math.max(1, Math.ceil(rate * activeGB / den - 1e-9));
    }
    var moreVramHelps = sessions < sNeeded && isFinite(sNeeded) && tpsAt(sNeeded) >= GATES.decodeTpsMin;
    var tps = tpsAt(s1);
    var busyHoursPerDay = busySec(s1) / 3600;
    var elec = annualElecUSD(card.idleW, card.tdpW, Math.min(busyHoursPerDay, usage.hoursPerDay), usage.usdPerKwh);
    var be = breakevenYears(netHardware, elec, outPerYear, hostedPerM);

    var verdict;
    if (!fits) {
      verdict = 'NO_FIT';
      reasons.push('Needs ~' + mem.totalGB.toFixed(1) + ' GB (weights ' + mem.weightsGB.toFixed(1) +
        ' + KV ' + mem.kvGB.toFixed(1) + ' + ' + GATES.overheadGB + ' overhead); card has ' + card.vramGB + ' GB.');
    } else if (tps < GATES.decodeTpsMin) {
      verdict = 'TOO_SLOW';
      reasons.push('Decode ~' + tps.toFixed(1) + ' t/s' + (s1 > 1 ? ' per session at ' + s1 + ' sessions' : '') +
        ' — below the ' + GATES.decodeTpsMin + ' t/s usability floor.');
    } else if (ttft > GATES.ttftFailMin) {
      verdict = 'TOO_SLOW';
      reasons.push(promptK + 'K prefill (working context) takes ~' + ttft.toFixed(0) + ' min (> ' + GATES.ttftFailMin + ' min floor).');
    } else if (usage.hoursPerDay <= 0 && decodeTokens > 0) {
      verdict = 'TOO_SLOW';
      reasons.push('No usage hours to serve the turns in.');
    } else if (prefillSec > 0 && prefillSec >= hoursSec) {
      verdict = 'TOO_SLOW';
      reasons.push('Prefill alone takes ~' + (prefillSec / 3600).toFixed(1) + ' h/day — above the ' +
        usage.hoursPerDay.toFixed(1) + ' h usage window, and batching does not shrink compute.');
    } else if (busySec(s1) > hoursSec && moreVramHelps) {
      verdict = 'NO_FIT';
      reasons.push('Serving the turns at the ' + sessions + ' sessions VRAM fits (' + mem.kvGB.toFixed(1) +
        ' GB KV each) takes ~' + busyHoursPerDay.toFixed(1) + ' h/day; usage hours give ' +
        usage.hoursPerDay.toFixed(1) + ' h/day.');
    } else if (busySec(s1) > hoursSec) {
      verdict = 'TOO_SLOW';
      reasons.push('Serving the turns takes ~' + busyHoursPerDay.toFixed(1) + ' h/day of decode + prefill' +
        (s1 > 1 ? ' at ' + s1 + ' sessions' : '') + '; usage hours give ' + usage.hoursPerDay.toFixed(1) + ' h/day.');
    } else {
      verdict = (be <= GATES.buyHorizonYears) ? 'BUY' : 'RENT';
      if (verdict === 'RENT')
        reasons.push(outPerYear <= 0 ? 'No turns — nothing to amortize against.'
          : isFinite(be) ? 'Break-even ~' + be.toFixed(1) + ' y, past the ' + GATES.buyHorizonYears + ' y horizon.'
          : 'Never breaks even — electricity costs at least what the hosted tokens would.');
      if (ttft > GATES.ttftWarnMin)
        reasons.push('First token ~' + ttft.toFixed(1) + ' min (> ' + GATES.ttftWarnMin + ' min warn) for a ' + promptK + 'K prompt.');
    }

    GATES.holdYears.forEach(function (y) {
      costPerM[y] = localCostPerM(card.priceUSD, elec, outPerYear, y);
    });

    return {
      verdict: verdict,
      reasons: reasons,
      totalGB: fits ? mem.weightsGB + mem.kvGB * sessionsUsed + GATES.overheadGB : mem.totalGB,
      sessions: sessions,
      sessionsUsed: sessionsUsed,
      tps: tps,
      ttftMin: ttft,
      netHardwareUSD: netHardware,
      elecAnnualUSD: elec,
      outTokensPerYear: outPerYear,
      localCostPerM: costPerM,
      breakevenYears: be,
      hostedUsdPerM: hostedPerM
    };
  }

  return {
    GATES: GATES,
    resaleFraction: resaleFraction,
    fitGB: fitGB,
    decodeTps: decodeTps,
    prefillTps: prefillTps,
    ttftMinutes: ttftMinutes,
    annualElecUSD: annualElecUSD,
    localCostPerM: localCostPerM,
    breakevenYears: breakevenYears,
    hostedUsdPerM: hostedUsdPerM,
    evaluate: evaluate
  };
});
