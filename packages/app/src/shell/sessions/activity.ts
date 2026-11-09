import type { ServerCtx } from "@/runtime/server/runtime"

export function sessionBackgroundShells(data: ServerCtx["data"], sessionID: string, family = false) {
  return (family ? [sessionID, ...data.session.family(sessionID)] : [sessionID])
    .flatMap((id) => data.shell.listBySession(id))
    .filter((shell) => shell.status === "running")
}
