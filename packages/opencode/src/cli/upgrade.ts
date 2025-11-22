import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"

export async function upgrade() {
  const config = await Config.global()
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const latest = await Installation.latest().catch(() => {})
  if (!latest) return
  if (Installation.VERSION === latest) return
  const method = await Installation.method()
  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
