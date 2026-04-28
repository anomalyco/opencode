import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"

export type Runtime = "effect-httpapi" | "hono"

export type Selection = {
  runtime: Runtime
  reason: "env" | "channel" | "stable" | "explicit"
}

export type Attributes = ReturnType<typeof attributes>

const channelDefaultsToHttpApi = () =>
  InstallationChannel === "local" ||
  InstallationChannel === "dev" ||
  InstallationChannel === "beta" ||
  InstallationVersion.includes("-dev") ||
  InstallationVersion.includes("-beta")

export function select(): Selection {
  if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) return { runtime: "effect-httpapi", reason: "env" }
  if (channelDefaultsToHttpApi()) return { runtime: "effect-httpapi", reason: "channel" }
  return { runtime: "hono", reason: "stable" }
}

export function attributes(selection: Selection): Record<string, string> {
  return {
    "opencode.server.runtime": selection.runtime,
    "opencode.server.runtime.reason": selection.reason,
    "opencode.installation.channel": InstallationChannel,
    "opencode.installation.version": InstallationVersion,
  }
}

export function force(selection: Selection, runtime: Runtime): Selection {
  return {
    runtime,
    reason: selection.runtime === runtime ? selection.reason : "explicit",
  }
}
