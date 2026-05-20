import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"

export function InviteDialog(props: { onClose: () => void }) {
  const collab = useCollab()
  const [role, setRole] = createSignal<string>("contributor")
  const [inviteUrl, setInviteUrl] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  async function generate() {
    const result = await collab.createInvite(role())
    setInviteUrl(result.url)
  }

  async function copy() {
    const url = inviteUrl()
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    // Use inline styles + a very high z-index because Tailwind class purging
    // can drop unused colour utilities, and iframes can promote themselves to
    // their own composited stacking context — z-50 wasn't enough to cover
    // the opencode iframe sitting underneath.
    <div
      class="fixed inset-0 flex items-center justify-center"
      style="background-color:#09090b;z-index:99999"
      onClick={props.onClose}
    >
      <div
        class="border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl"
        style="background-color:#18181b;position:relative;z-index:100000"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 class="text-base font-semibold text-zinc-100 mb-4">Invite to Collab Session</h2>

        <div class="mb-4">
          <label class="text-xs text-zinc-400 block mb-1.5">Role</label>
          <select
            class="w-full bg-zinc-800 border border-zinc-600 text-zinc-200 rounded-lg px-3 py-2 text-sm"
            value={role()}
            onChange={(e) => setRole(e.currentTarget.value)}
          >
            <option value="driver">Driver — can create and approve prompts</option>
            <option value="contributor">Contributor — can suggest prompts and vote</option>
            <option value="viewer">Viewer — read-only access</option>
          </select>
        </div>

        <Show
          when={inviteUrl()}
          fallback={
            <button
              onClick={generate}
              class="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              Generate invite link
            </button>
          }
        >
          <div class="bg-zinc-800 rounded-lg p-3 mb-3">
            <div class="text-xs text-zinc-400 mb-1">Invite link (expires in 72 hours)</div>
            <div class="text-xs font-mono text-zinc-300 break-all">{inviteUrl()}</div>
          </div>
          <button
            onClick={copy}
            class={`w-full font-medium py-2 rounded-lg text-sm transition-colors ${
              copied()
                ? "bg-green-600 text-white"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
            }`}
          >
            {copied() ? "Copied!" : "Copy link"}
          </button>
        </Show>

        <button
          onClick={props.onClose}
          class="mt-3 w-full text-xs text-zinc-500 hover:text-zinc-400 py-1"
        >
          Close
        </button>
      </div>
    </div>
  )
}
