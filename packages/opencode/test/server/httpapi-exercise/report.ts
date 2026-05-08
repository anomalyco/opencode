import { indent, pad } from "./assertions"
import type { Options, Result, Scenario } from "./types"

export const color = {
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
}

export function printHeader(
  options: Options,
  effectRoutes: string[],
  honoRoutes: string[],
  selected: Scenario[],
  missing: string[],
  extra: Scenario[],
  paths: { database: string; global: string },
) {
  console.log(`${color.cyan}HttpApi exerciser${color.reset}`)
  console.log(`${color.dim}db=${paths.database}${color.reset}`)
  console.log(`${color.dim}global=${paths.global}${color.reset}`)
  console.log(
    `${color.dim}mode=${options.mode} selected=${selected.length} effectRoutes=${effectRoutes.length} missing=${missing.length} extra=${extra.length} onlyEffect=${effectRoutes.filter((route) => !honoRoutes.includes(route)).length} onlyHono=${honoRoutes.filter((route) => !effectRoutes.includes(route)).length}${color.reset}`,
  )
  console.log("")
}

export function printResults(results: Result[], missing: string[], extra: Scenario[]) {
  for (const result of results) {
    if (result.status === "pass") {
      console.log(
        `${color.green}PASS${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name}`,
      )
      continue
    }
    if (result.status === "skip") {
      console.log(
        `${color.yellow}SKIP${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name} ${color.dim}${result.scenario.reason}${color.reset}`,
      )
      continue
    }
    console.log(
      `${color.red}FAIL${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name}`,
    )
    console.log(`${color.red}${indent(result.message)}${color.reset}`)
  }
  if (missing.length > 0) {
    console.log("\nMissing scenarios")
    for (const route of missing) console.log(`${color.red}MISS${color.reset} ${route}`)
  }
  if (extra.length > 0) {
    console.log("\nExtra scenarios")
    for (const scenario of extra)
      console.log(`${color.yellow}EXTRA${color.reset} ${routeKey(scenario)} ${scenario.name}`)
  }
  console.log(
    `\n${color.dim}summary pass=${results.filter((result) => result.status === "pass").length} fail=${results.filter((result) => result.status === "fail").length} skip=${results.filter((result) => result.status === "skip").length} missing=${missing.length} extra=${extra.length}${color.reset}`,
  )
}

function routeKey(scenario: Scenario) {
  return `${scenario.method} ${scenario.path}`
}
