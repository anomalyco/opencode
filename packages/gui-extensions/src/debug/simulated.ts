import type { LocationRef } from "@opencode/client/promise"
import type { ServerRef } from "../sdk"

// Drive's simulated provider (script/drive/demo-session.ts). Demo controls act only on a session that runs on it, so a
// demo prompt never reaches a real model or a real conversation.
const provider = "simulation"

export function simulated(session: { id: string; location: LocationRef; server: ServerRef }) {
  const model = session.server.data.session.get(session.id)?.model
  const providers = session.server.data.location.provider.list(session.location)

  return (model === undefined || model.providerID === provider) && !!providers?.some((item) => item.id === provider)
}
