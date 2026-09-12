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
    decodeTpsMin: 5,      // below this, interactive use is pointless
    ttftWarnMin: 5,       // first token noticeably painful
    ttftFailMin: 30,      // disqualify: nobody waits 30+ min to start
    buyHorizonYears: 3,   // break-even beyond this → rent
    overheadGB: 2         // CUDA context + activation margin
  };

  // weights + KV + overhead, for a context of `contextK` thousand tokens
  function fitGB(totalParamsB, bytesPerWeight, kvPerKGB, contextK) {
    var weightsGB = totalParamsB * bytesPerWeight;
    var kvGB = kvPerKGB * contextK;
    return { weightsGB: weightsGB, kvGB: kvGB, totalGB: weightsGB + kvGB + GATES.overheadGB };
  }

  // batch-1 decode is bandwidth-bound: every token re-reads active weights
  function decodeTps(bandwidthGBs, activeParamsB, bytesPerWeight, efficiencyPct) {
    var gbPerToken = activeParamsB * bytesPerWeight;
    if (gbPerToken <= 0) return 0;
    return (bandwidthGBs / gbPerToken) * (efficiencyPct / 100);
  }

  // prefill is compute-bound: ~2 FLOPs per active param per token
  function prefillTps(tflops, activeParamsB, efficiencyPct) {
    var flopsPerToken = 2 * activeParamsB * 1e9;
    if (flopsPerToken <= 0) return 0;
    return (tflops * 1e12 * (efficiencyPct / 100)) / flopsPerToken;
  }

  function ttftMinutes(promptTokens, prefillTps) {
    if (prefillTps <= 0) return Infinity;
    return promptTokens / prefillTps / 60;
  }

  // machine idles 24/7, loads only during `hoursPerDay`
  function annualElecUSD(idleW, loadW, hoursPerDay, usdPerKwh) {
    var kwh = (idleW * 8760 + (loadW - idleW) * hoursPerDay * 365) / 1000;
    return kwh * usdPerKwh;
  }

  function tokensPerYear(tps, hoursPerDay) {
    return tps * 3600 * hoursPerDay * 365;
  }

  // amortized local cost per 1M output tokens over `years`
  function localCostPerM(netHardwareUSD, elecAnnualUSD, tps, hoursPerDay, years) {
    var tokens = tokensPerYear(tps, hoursPerDay) * years;
    if (tokens <= 0) return Infinity;
    return (netHardwareUSD + elecAnnualUSD * years) / (tokens / 1e6);
  }

  // years until the card's net cost is covered by tokens it generates
  // instead of paying `hostedUsdPerM` for the same tokens
  function breakevenYears(netHardwareUSD, tps, hoursPerDay, hostedUsdPerM) {
    var savedPerYear = (tokensPerYear(tps, hoursPerDay) / 1e6) * hostedUsdPerM;
    if (savedPerYear <= 0) return Infinity;
    return netHardwareUSD / savedPerYear;
  }

  // card: {vramGB, bandwidthGBs, tflops, tdpW, idleW, priceUSD, resalePct}
  // model:{totalParamsB, activeParamsB, bytesPerWeight, kvPerKGB}
  // usage:{hoursPerDay, usdPerKwh, contextK, systemPromptK, hostedUsdPerM}
  // ov:   {tps?}  (measured t/s override; wins over the estimate)
  function evaluate(card, model, usage, ov) {
    ov = ov || {};
    var reasons = [];

    var mem = fitGB(model.totalParamsB, model.bytesPerWeight, model.kvPerKGB, usage.contextK);
    var fits = mem.totalGB <= card.vramGB;

    var tps = (ov.tps != null) ? ov.tps
      : decodeTps(card.bandwidthGBs, model.activeParamsB, model.bytesPerWeight, 50);
    var ptps = prefillTps(card.tflops, model.activeParamsB, 35);
    var promptK = usage.systemPromptK + usage.contextK;
    var ttft = ttftMinutes(promptK * 1000, ptps);

    var netHardware = card.priceUSD * (1 - card.resalePct / 100);
    var elec = annualElecUSD(card.idleW, card.tdpW, usage.hoursPerDay, usage.usdPerKwh);
    var be = breakevenYears(netHardware, tps, usage.hoursPerDay, usage.hostedUsdPerM);

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
      if (ttft > GATES.ttftWarnMin)
        reasons.push('Slow first token: ~' + ttft.toFixed(1) + ' min for a ' + promptK + 'K prompt.');
      if (usage.hoursPerDay <= 0)
        reasons.push('0 h/day of usage — nothing to amortize against.');
    }

    return {
      verdict: verdict,
      reasons: reasons,
      fit: { ok: fits, totalGB: mem.totalGB },
      tps: tps,
      ttftMin: ttft,
      netHardwareUSD: netHardware,
      elecAnnualUSD: elec,
      tokensPerYear: tokensPerYear(tps, usage.hoursPerDay),
      localCostPerM: {
        y1: localCostPerM(netHardware, elec, tps, usage.hoursPerDay, 1),
        y3: localCostPerM(netHardware, elec, tps, usage.hoursPerDay, 3),
        y5: localCostPerM(netHardware, elec, tps, usage.hoursPerDay, 5)
      },
      breakevenYears: be,
      gates: GATES
    };
  }

  return {
    GATES: GATES,
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
