import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { InviteDialog } from "./InviteDialog"

export function CollabBadge() {
  const collab = useCollab()
  const [showInvite, setShowInvite] = createSignal(false)
  const onlineCount = () => collab.participants().filter((p) => p.isOnline).length

  return (
    <>
      <div class="flex items-center gap-2">
        <div
          class={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
            collab.isConnected()
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-zinc-700 text-zinc-500 border border-zinc-600"
          }`}
        >
          <span
            class={`w-1.5 h-1.5 rounded-full ${collab.isConnected() ? "bg-blue-400 animate-pulse" : "bg-zinc-500"}`}
          />
          <span>Collab</span>
          <Show when={onlineCount() > 0}>
            <span class="text-blue-300">{onlineCount()}</span>
          </Show>
        </div>

        <Show when={collab.session()?.participants.some((p) => p.role === "driver")}>
          <button
            onClick={() => setShowInvite(true)}
            class="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-1 rounded-full transition-colors"
            title="Invite participants"
          >
            + Invite
          </button>
        </Show>
      </div>

      <Show when={showInvite()}>
        <InviteDialog onClose={() => setShowInvite(false)} />
      </Show>
    </>
  )
}
