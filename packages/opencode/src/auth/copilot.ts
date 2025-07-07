import { Global } from "../global"
import { lazy } from "../util/lazy"
import path from "path"

export const AuthCopilot = lazy(async () => {
  const file = Bun.file(path.join(Global.Path.state, "plugin", "copilot.ts"))
  const response = fetch("https://raw.githubusercontent.com/sst/opencode-github-copilot/refs/heads/main/auth.ts")
    .then((x) => Bun.write(file, x))
    .catch(() => {})

  if (!file.exists()) {
    const worked = await response
    if (!worked) return
  }
  const result = await import(file.name!).catch(() => {})
  if (!result) return
  return result.AuthCopilot
})
