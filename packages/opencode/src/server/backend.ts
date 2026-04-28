import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"

export type Backend = "effect-httpapi" | "hono"

export type Selection = {
  backend: Backend
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
  if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) return { backend: "effect-httpapi", reason: "env" }
  if (channelDefaultsToHttpApi()) return { backend: "effect-httpapi", reason: "channel" }
  return { backend: "hono", reason: "stable" }
}

export function attributes(selection: Selection): Record<string, string> {
  return {
    "opencode.server.backend": selection.backend,
    "opencode.server.backend.reason": selection.reason,
    "opencode.installation.channel": InstallationChannel,
    "opencode.installation.version": InstallationVersion,
  }
}

export function force(selection: Selection, backend: Backend): Selection {
  return {
    backend,
    reason: selection.backend === backend ? selection.reason : "explicit",
  }
}
