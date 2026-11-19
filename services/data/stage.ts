// The stage a `--mode` deploys. Only `dev` and `production` are stages: anything else, including no mode at all, throws,
// so a typo or a bare `cf deploy` can never fall through to production.
const hosts = {
  dev: "dev.opencode.ai",
  production: "opencode.ai",
} as const

export type Stage = keyof typeof hosts

export function stage(mode: string | undefined): Stage {
  if (mode === "dev" || mode === "production") return mode
  throw new Error(`Unknown mode ${JSON.stringify(mode)}; pass --mode dev or --mode production`)
}

// The host the stage's site is served from.
export function stageHost(value: Stage) {
  return hosts[value]
}

export function stageAccount(value: Stage) {
  return value === "dev" ? "d8e944f537ceef3f06a5bd3aec1d7a53" : "15d29c8639fd3733b1b5486a2acfd968"
}
