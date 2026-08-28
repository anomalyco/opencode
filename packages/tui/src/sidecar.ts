import type { useSync } from "./context/sync"
import type { useLocal } from "./context/local"
import type { useSDK } from "./context/sdk"
import type { useToast } from "./ui/toast"

type Navigate = (route: { type: "session"; sessionID: string } | { type: "home" }) => void

export async function toggleSidecar(input: {
  route: { type: string; sessionID?: string }
  navigate: Navigate
  sync: ReturnType<typeof useSync>
  local: ReturnType<typeof useLocal>
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
}) {
  const { route, navigate, sync, local, sdk, toast } = input
  if (route.type !== "session" || !route.sessionID) {
    local.agent.move(1)
    return
  }
  const current = sync.session.get(route.sessionID)
  if (!current) return
  const meta = current.metadata ?? {}

  const originID = typeof meta.sidecarOf === "string" ? meta.sidecarOf : undefined
  if (originID) {
    const origin = sync.session.get(originID)
    if (!origin) {
      toast.show({ message: "Sidecar origin session not found", variant: "error" })
      return
    }
    if (origin.agent) local.agent.set(origin.agent)
    navigate({ type: "session", sessionID: originID })
    return
  }

  const linkedID = typeof meta.sidecarID === "string" ? meta.sidecarID : undefined
  const linked = linkedID ? sync.session.get(linkedID) : undefined
  const sidecar =
    linked ?? sync.data.session.find((s) => (s.metadata as Record<string, unknown> | undefined)?.sidecarOf === current.id)
  if (sidecar) {
    if (sidecar.agent) local.agent.set(sidecar.agent)
    navigate({ type: "session", sessionID: sidecar.id })
    return
  }

  const currentAgentName = local.agent.current()?.name
  const target = local.agent.list().find((a) => a.name !== currentAgentName)
  if (!target || !currentAgentName) {
    toast.show({ message: "No other agent available for a sidecar conversation", variant: "warning" })
    return
  }
  const note = [
    "<sidecar-orientation>",
    `This session was forked from the user's main conversation. The history above was transplanted verbatim from that session — every assistant reply in it was written by the main agent "${currentAgentName}", not by you.`,
    `You are now speaking directly with the user as sidecar agent "${target.name}". Treat the history above as reference material about the earlier conversation with ${currentAgentName}.`,
    "</sidecar-orientation>",
  ].join("\n")
  const res = await sdk.client.session
    .fork({
      sessionID: route.sessionID,
      agent: target.name,
      metadata: { sidecarOf: route.sessionID },
      note,
    })
    .catch((error) => {
      toast.show({
        message: error instanceof Error ? error.message : "Failed to start sidecar conversation",
        variant: "error",
      })
    })
  const forked = res?.data
  if (!forked) return
  await sdk.client.session
    .update({
      sessionID: route.sessionID,
      metadata: { ...meta, sidecarID: forked.id },
    })
    .catch(() => {})
  toast.show({ message: `Sidecar conversation started with @${target.name}`, variant: "info" })
  local.agent.set(target.name)
  navigate({ type: "session", sessionID: forked.id })
}
