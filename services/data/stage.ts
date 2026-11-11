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
