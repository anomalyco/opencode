#!/usr/bin/env bun
// Diagnostic: print the active Simplicio1 tier for this machine.
//   bun script/simplicio/which-tier.ts
//
// Useful when debugging why the model picker landed on a given tier.

import { fetchHfBudgetRemaining, selectTier, totalRamGb } from "../../packages/simpliciocode/src/provider/simplicio1"

const ram = totalRamGb()
const hfBudget = await fetchHfBudgetRemaining()
const tier = selectTier({ ramGb: ram, hfTokenPresent: Boolean(process.env.HF_TOKEN), hfBudgetRemainingUsd: hfBudget })

const lines = [
  `RAM detected      : ${ram.toFixed(1)} GB`,
  `HF token present  : ${Boolean(process.env.HF_TOKEN)}`,
  `HF budget left    : $${hfBudget.toFixed(2)}`,
  `Override env      : ${process.env.SIMPLICIO_MODEL_TIER ?? "(none)"}`,
  ``,
  `=> Active tier    : ${tier.id}`,
  `   label          : ${tier.label}`,
  `   provider       : ${tier.provider}`,
  `   model          : ${tier.model}`,
  `   baseUrl        : ${tier.baseUrl}`,
]

console.log(lines.join("\n"))
