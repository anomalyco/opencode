import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// Checking never installs anything. Updates only happen when the user runs `/update` or `opencode upgrade`.
export function shouldNotify(input: {
  autoupdate: boolean | "notify" | undefined
  disabled: boolean
  always: boolean
  current: string
  latest: string
}) {
  if (input.autoupdate === false || input.disabled) return false
  if (input.always) return true
  return input.current !== input.latest
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const latest = await Installation.latest(await Installation.method()).catch(() => {})
  if (!latest) return
  if (
    !shouldNotify({
      autoupdate: config.autoupdate,
      disabled: Flag.OPENCODE_DISABLE_AUTOUPDATE,
      always: Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE,
      current: InstallationVersion,
      latest,
    })
  )
    return
  return latest
}
