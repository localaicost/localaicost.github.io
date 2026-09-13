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
  function fitGB(totalParamsB, bytesPerWeight, kvPerKGB, contextK) {
    var weightsGB = totalParamsB * bytesPerWeight;
    var kvGB = kvPerKGB * contextK;
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

  function annualElecUSD(idleW, loadW, hoursPerDay, usdPerKwh) {
    var kwh = (idleW * 8760 + (loadW - idleW) * hoursPerDay * 365) / 1000;
    return kwh * usdPerKwh;
  }

  function tokensPerYear(tps, hoursPerDay) {
    return tps * 3600 * hoursPerDay * 365;
  }

  // local cost per 1M output tokens, holding the card `years` then reselling it
  function localCostPerM(priceUSD, elecAnnualUSD, tps, hoursPerDay, years) {
    var tokens = tokensPerYear(tps, hoursPerDay) * years;
    if (tokens <= 0) return Infinity;
    return (priceUSD * (1 - resaleFraction(years)) + elecAnnualUSD * years) / (tokens / 1e6);
  }

  // years until the card's net cost is covered by what its tokens would cost
  // hosted, minus the electricity to generate them
  function breakevenYears(netHardwareUSD, elecAnnualUSD, tps, hoursPerDay, hostedUsdPerM) {
    var savedPerYear = (tokensPerYear(tps, hoursPerDay) / 1e6) * hostedUsdPerM - elecAnnualUSD;
    if (savedPerYear <= 0) return Infinity;
    return netHardwareUSD / savedPerYear;
  }

  // card: {vramGB, bandwidthGBs, tflops, tdpW, idleW, priceUSD}
  // model:{totalParamsB, activeParamsB, bytesPerWeight, kvPerKGB, maxContextK?}
  // usage:{hoursPerDay, usdPerKwh, contextK, systemPromptK, hostedUsdPerM}
  // tpsOverride: measured t/s; wins over the estimate
  function evaluate(card, model, usage, tpsOverride) {
    var reasons = [], costPerM = {};

    // system prompt = the harness's fixed prompt, cached ahead of the working context
    var askedK = usage.systemPromptK + usage.contextK;
    var promptK = (model.maxContextK != null) ? Math.min(askedK, model.maxContextK) : askedK;
    var mem = fitGB(model.totalParamsB, model.bytesPerWeight, model.kvPerKGB, promptK);
    var fits = mem.totalGB <= card.vramGB;

    var tps = (tpsOverride != null) ? tpsOverride
      : decodeTps(card.bandwidthGBs, model.activeParamsB, model.bytesPerWeight, GATES.decodeEffPct);
    var ptps = prefillTps(card.tflops, model.activeParamsB, GATES.prefillEffPct);
    var ttft = ttftMinutes(promptK * 1000, ptps);

    var netHardware = card.priceUSD * (1 - resaleFraction(GATES.buyHorizonYears));
    var elec = annualElecUSD(card.idleW, card.tdpW, usage.hoursPerDay, usage.usdPerKwh);
    var be = breakevenYears(netHardware, elec, tps, usage.hoursPerDay, usage.hostedUsdPerM);

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
      reasons.push(promptK + 'K prefill (system prompt + working context) takes ~' + ttft.toFixed(0) + ' min (> ' + GATES.ttftFailMin + ' min floor).');
    } else {
      verdict = (be <= GATES.buyHorizonYears) ? 'BUY' : 'RENT';
      if (verdict === 'RENT')
        reasons.push(usage.hoursPerDay <= 0 ? 'No usage hours — nothing to amortize against.'
          : isFinite(be) ? 'Break-even ~' + be.toFixed(1) + ' y, past the ' + GATES.buyHorizonYears + ' y horizon.'
          : 'Never breaks even — electricity costs at least what the hosted tokens would.');
      if (ttft > GATES.ttftWarnMin)
        reasons.push('First token ~' + ttft.toFixed(1) + ' min (> ' + GATES.ttftWarnMin + ' min warn) for a ' + promptK + 'K prompt.');
    }

    GATES.holdYears.forEach(function (y) {
      costPerM[y] = localCostPerM(card.priceUSD, elec, tps, usage.hoursPerDay, y);
    });

    return {
      verdict: verdict,
      reasons: reasons,
      totalGB: mem.totalGB,
      tps: tps,
      ttftMin: ttft,
      netHardwareUSD: netHardware,
      elecAnnualUSD: elec,
      tokensPerYear: tokensPerYear(tps, usage.hoursPerDay),
      localCostPerM: costPerM,
      breakevenYears: be
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
    tokensPerYear: tokensPerYear,
    localCostPerM: localCostPerM,
    breakevenYears: breakevenYears,
    evaluate: evaluate
  };
});
