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
    decodeTpsMin: 10,     // TOO_SLOW below
    ttftWarnMin: 5,       // warn above
    ttftFailMin: 30,      // TOO_SLOW above
    turnsPerWeekMin: 7000, // TOO_SLOW below (1 agent; one Pro plan user's week)
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
  //        hostedCacheDiscPct, cacheMissPct, outTokensPerTurn, toolTokensPerTurn}
  // tpsOverride: measured t/s; wins over the estimate
  function evaluate(card, model, usage, tpsOverride) {
    var reasons = [], costPerM = {};

    // working context = a session's prompt fill (system prompt included), capped at the model's max
    var promptK = (model.maxContextK != null) ? Math.min(usage.contextK, model.maxContextK) : usage.contextK;
    var mem = fitGB(model.totalParamsB, model.bytesPerWeight, model.kvPerKGB, promptK, model.kvScale);
    var fits = mem.totalGB <= card.vramGB;
    // concurrent sessions the VRAM holds (the 2 GB overhead is engine-level, not per session)
    var sessions = fits && mem.kvGB > 0
      ? Math.floor((card.vramGB - mem.weightsGB - GATES.overheadGB) / mem.kvGB + 1e-9)
      : (fits ? 1 : 0);

    var tps = (tpsOverride != null) ? tpsOverride
      : decodeTps(card.bandwidthGBs, model.activeParamsB, model.bytesPerWeight, GATES.decodeEffPct);
    // per-session decode t/s at batch s: each step reads the active weights once plus every
    // session's KV at the average context (C/2); the batch-1 figure stands for one session's read
    var activeGB = model.activeParamsB * model.bytesPerWeight, kvAvgGB = mem.kvGB / 2;
    function tpsAt(s) { return tps * (activeGB + kvAvgGB) / (activeGB + s * kvAvgGB); }
    // most agents whose per-session decode stays at the floor: tpsAt(S) ≥ floor solved for S
    var agents = kvAvgGB > 0
      ? Math.min(sessions, Math.floor((tps * (activeGB + kvAvgGB) / GATES.decodeTpsMin - activeGB) / kvAvgGB + 1e-9))
      : sessions;
    agents = Math.max(agents, Math.min(sessions, 1));
    var tpsMulti = agents > 0 ? tpsAt(agents) : tps;
    var ptps = prefillTps(card.tflops, model.activeParamsB, GATES.prefillEffPct);
    var ttft = ttftMinutes(promptK * 1000, ptps);

    var netHardware = card.priceUSD * (1 - resaleFraction(GATES.buyHorizonYears));
    var hostedPerM = hostedUsdPerM(usage.hostedUsdPerM, usage.hostedInUsdPerM, usage.hostedCacheDiscPct,
      promptK, usage.outTokensPerTurn, usage.toolTokensPerTurn, usage.cacheMissPct);
    // turns the card produces in the usage hours: fresh input (O + T) prefills compute-bound and
    // does not batch; decode of O runs across the agents at their per-session t/s. Local prefix
    // cache doesn't expire, so missed hosted cache reads cost no local prefill
    var O = usage.outTokensPerTurn, prefillPerTurn = (O + (usage.toolTokensPerTurn || 0)) / ptps;
    function turnsPerDay(s, t) { return usage.hoursPerDay * 3600 / (prefillPerTurn + O / (s * t)); }
    var turns1 = turnsPerDay(1, tps), turnsMulti = turnsPerDay(Math.max(agents, 1), tpsMulti);
    var out1 = turns1 * O * 365, outMulti = turnsMulti * O * 365;
    // the card runs at capacity for all usage hours
    var elec = annualElecUSD(card.idleW, card.tdpW, usage.hoursPerDay, usage.usdPerKwh);
    var be1 = breakevenYears(netHardware, elec, out1, hostedPerM);
    var be = breakevenYears(netHardware, elec, outMulti, hostedPerM);

    var verdict;
    if (!fits) {
      verdict = 'NO_FIT';
      reasons.push('Needs ~' + mem.totalGB.toFixed(1) + ' GB (weights ' + mem.weightsGB.toFixed(1) +
        ' + KV ' + mem.kvGB.toFixed(1) + ' + ' + GATES.overheadGB + ' overhead); card has ' + card.vramGB + ' GB.');
    } else if (tps < GATES.decodeTpsMin) {
      verdict = 'TOO_SLOW';
      reasons.push('Decode ~' + tps.toFixed(1) + ' t/s — below the ' + GATES.decodeTpsMin + ' t/s usability floor.');
    } else if (ttft > GATES.ttftFailMin) {
      verdict = 'TOO_SLOW';
      reasons.push(promptK + 'K prefill (working context) takes ~' + ttft.toFixed(0) + ' min (> ' + GATES.ttftFailMin + ' min floor).');
    } else if (turns1 > 0 && turns1 * 7 < GATES.turnsPerWeekMin) {
      verdict = 'TOO_SLOW';
      // floor to 0.1K so a value just under the floor never prints as the floor
      reasons.push('Only ~' + Math.floor(turns1 * 7 / 100) / 10 + 'K turns/week for 1 agent in the usage hours — under the ' +
        GATES.turnsPerWeekMin / 1000 + 'K floor (one Pro plan user).');
    } else {
      verdict = (be <= GATES.buyHorizonYears) ? 'PASS' : 'RENT';
      if (verdict === 'RENT')
        reasons.push(outMulti <= 0 ? 'No usage hours — nothing to amortize against.'
          : isFinite(be) ? 'Break-even ~' + be.toFixed(1) + ' y at ' + agents + (agents === 1 ? ' agent' : ' agents') + ', past the ' + GATES.buyHorizonYears + ' y horizon.'
          : 'Never breaks even — electricity costs at least what the hosted tokens would.');
    }
    // the TTFT warning also rides on a turns-floor failure
    if (fits && tps >= GATES.decodeTpsMin && ttft > GATES.ttftWarnMin && ttft <= GATES.ttftFailMin)
      reasons.push('First token ~' + ttft.toFixed(1) + ' min (> ' + GATES.ttftWarnMin + ' min warn) for a ' + promptK + 'K prompt.');

    GATES.holdYears.forEach(function (y) {
      costPerM[y] = localCostPerM(card.priceUSD, elec, outMulti, y);
    });

    return {
      verdict: verdict,
      reasons: reasons,
      totalGB: fits ? mem.weightsGB + mem.kvGB * agents + GATES.overheadGB : mem.totalGB,
      sessions: sessions,
      agents: agents,
      tps: tps,
      tpsMulti: tpsMulti,
      ttftMin: ttft,
      turnsPerWeek: turns1 * 7,
      turnsPerWeekMulti: turnsMulti * 7,
      netHardwareUSD: netHardware,
      elecAnnualUSD: elec,
      outTokensPerYear: outMulti,
      localCostPerM: costPerM,
      breakevenYears: be,
      breakevenYears1: be1,
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
