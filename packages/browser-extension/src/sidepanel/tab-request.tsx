// A conversation asking to see one of the user's open tabs (browser.tabs.request). Sharing gives the agent
// that tab the same way the Share tab button does; any open panel may answer.
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Show, createSignal } from "solid-js"
import { hostLabel } from "../shared/site-script"
import { useServer } from "./connection"

/** The oldest tab request, as a dock above the composer. Site script approvals go first. */
export function TabRequestDock() {
  const server = useServer()
  const background = server.background
  const request = () => (background.state.approvals.length ? undefined : background.state.tabRequests[0])
  const total = () => background.state.tabRequests.length
  // An ID rather than a flag, so the next request starts answerable.
  const [answered, setAnswered] = createSignal<string>()
  const busy = () => answered() === request()?.id
  const [broken, setBroken] = createSignal<string>()

  const reply = (allow: boolean) => {
    const id = request()?.id
    if (!id || answered() === id) return
    setAnswered(id)
    background.send({ type: "tabRequest.reply", id, allow })
  }

  return (
    <Show when={request()}>
      {(value) => (
        <DockPrompt
          kind="permission"
          header={
            <div data-slot="permission-row" data-variant="header">
              <span data-slot="permission-icon">
                <Icon name="eye" size="normal" />
              </span>
              <div class="flex min-w-0 items-center justify-between gap-2">
                <div data-slot="permission-header-title">
                  {value().current ? "Share the tab you're on?" : "Share this tab?"}
                </div>
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
                  Don't share
                </Button>
                <Button variant="submit" size="normal" disabled={busy()} onClick={() => reply(true)}>
                  Share tab
                </Button>
              </div>
            </>
          }
        >
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div class="flex min-w-0 flex-col gap-2 pb-3">
              <div class="flex min-w-0 items-center gap-2.5 rounded-lg bg-v2-background-bg-layer-01 px-2.5 py-2">
                <Show
                  when={value().tab.favIconUrl && broken() !== value().tab.favIconUrl && value().tab.favIconUrl}
                  fallback={<Icon name="globe" size="small" class="shrink-0 text-v2-icon-icon-muted" />}
                >
                  {(src) => (
                    <img src={src()} alt="" class="size-4 shrink-0 rounded-[3px]" onError={() => setBroken(src())} />
                  )}
                </Show>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-[13px] font-[530] leading-[18px] text-v2-text-text-base">
                    {value().tab.title}
                  </span>
                  <span class="truncate text-12-regular leading-4 text-v2-text-text-faint">
                    {hostLabel(value().tab.url)}
                  </span>
                </span>
              </div>
              <Show when={value().reason}>
                {(reason) => <p class="text-[13px] leading-5 break-words text-v2-text-text-muted">{reason()}</p>}
              </Show>
              <p class="text-12-regular break-words text-v2-text-text-faint">
                <Show when={server.data.session.get(value().sessionID)?.title} fallback="A conversation">
                  {(title) => <span class="font-[530] text-v2-text-text-base">{title()}</span>}
                </Show>{" "}
                can then see and use this tab until you stop sharing it.
              </p>
            </div>
          </div>
        </DockPrompt>
      )}
    </Show>
  )
}
