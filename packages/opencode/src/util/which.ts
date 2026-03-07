import { createRequire } from "node:module"

const req = createRequire(import.meta.url)
const mod = req("which") as {
  sync: (cmd: string, opts: { nothrow: boolean; path?: string; pathExt?: string }) => string | null
}

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = mod.sync(cmd, {
    nothrow: true,
    path: env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
