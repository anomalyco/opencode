// Agents asking to read browsing data (history, bookmarks, top sites, recently closed tabs). The
// background remembers a grant per session; any open panel may answer.
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Show, createSignal } from "solid-js"
import { BROWSING_PERMISSIONS, type AccessRequest } from "../shared/protocol"
import { useServer } from "./connection"

const reasons: Record<AccessRequest["reason"], string> = {
  history: "It asked to search your history.",
  bookmarks: "It asked to search your bookmarks.",
  top_sites: "It asked for your most visited sites.",
  recently_closed: "It asked for your recently closed tabs.",
}

/** The oldest access request, as a dock above the composer. Site script approvals go first. */
export function BrowsingAccessDock() {
  const server = useServer()
  const background = server.background
  const request = () =>
    background.state.approvals.length || background.state.tabRequests.length ? undefined : background.state.access[0]
  const total = () => background.state.access.length
  // An ID rather than a flag, so the next request starts answerable.
  const [answered, setAnswered] = createSignal<string>()
  const busy = () => answered() === request()?.id

  const reply = (allow: boolean) => {
    const id = request()?.id
    if (!id || answered() === id) return
    setAnswered(id)
    if (!allow) return background.send({ type: "access.reply", id, allow })
    // Chrome only shows its permission prompt from a click, so request the optional permissions here.
    void chrome.permissions
      .request({ permissions: BROWSING_PERMISSIONS })
      .catch(() => false)
      .then((granted) => background.send({ type: "access.reply", id, allow: granted }))
  }

  return (
    <Show when={request()}>
      {(value) => (
        <DockPrompt
          kind="permission"
          header={
            <div data-slot="permission-row" data-variant="header">
              <span data-slot="permission-icon">
                <Icon name="shield" size="normal" />
              </span>
              <div class="flex min-w-0 items-center justify-between gap-2">
                <div data-slot="permission-header-title">Allow access to your browsing data?</div>
                <Show when={total() > 1}>
                  <span class="shrink-0 text-12-regular tabular-nums text-v2-text-text-faint">1 of {total()}</span>
                </Show>
              </div>
            </div>
          }
          footer={
            <>
              <div />
              <div data-slot="permission-footer-actions">
                <Button variant="ghost" size="normal" disabled={busy()} onClick={() => reply(false)}>
                  Don't allow
                </Button>
                <Button variant="submit" size="normal" disabled={busy()} onClick={() => reply(true)}>
                  Allow for this conversation
                </Button>
              </div>
            </>
          }
        >
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div class="flex min-w-0 flex-col gap-1 pb-3">
              <p class="text-[13px] leading-5 break-words text-v2-text-text-muted">
                This conversation wants to read your history, bookmarks, most visited sites, and recently closed tabs.
              </p>
              <p class="text-12-regular break-words text-v2-text-text-faint">
                <Show when={server.data.session.get(value().sessionID)?.title} fallback="From a conversation.">
                  {(title) => (
                    <>
                      From <span class="font-[530] text-v2-text-text-base">{title()}</span>.
                    </>
                  )}
                </Show>{" "}
                {reasons[value().reason]}
              </p>
            </div>
          </div>
        </DockPrompt>
      )}
    </Show>
  )
}
