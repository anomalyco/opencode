// One open session: the shared session timeline, its blocking requests, the browser strip, and the
// composer. Loaded lazily; it carries the timeline, markdown, and diff renderers.
import type { FileDiffInfo, FormAnswer, SessionStatus } from "@opencode/client/promise"
import { DataProvider } from "@opencode/session-ui/context"
import { MarkdownProvider } from "@opencode/session-ui/context/markdown"
import { File } from "@opencode/session-ui/file"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { FileComponentProvider } from "@opencode/ui/context/file"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { BrowserControlHandoffDock } from "./browser-control"
import { BrowserStrip } from "./browser-strip"
import { BrowsingAccessDock } from "./browsing-access"
import { TabRequestDock } from "./tab-request"
import { Composer } from "./composer"
import { useServer } from "./connection"
import { PermissionDock, QuestionDock, UnsupportedFormDock, answerable } from "./docks"
import { toastError } from "./format"
import { FilePreview } from "./preview"
import { ScriptApprovalDock, ScriptInstallCard } from "./site-scripts"

const noDiffs: FileDiffInfo[] = []
const idle: SessionStatus = { type: "idle" }
const busy: SessionStatus = { type: "busy" }
// Distance from the bottom that still counts as following the stream.
const pinThreshold = 24
// Start loading older messages before the reader reaches the very top.
const historyThreshold = 400

export default function SessionView(props: {
  sessionID: string
  onOpen: (sessionID: string) => void
  composerRef: (element: HTMLTextAreaElement) => void
}) {
  const server = useServer()
  const data = server.data
  const connected = () => server.connection.status() === "connected"
  const info = createMemo(() => data.session.get(props.sessionID))
  const directory = createMemo(() => info()?.location.directory ?? "")
  const [ready, setReady] = createSignal(false)

  // This session and its subagents, whose permission and question requests surface here too.
  const tree = createMemo(() => {
    const children = new Map<string, string[]>()
    data.session.list().forEach((session) => {
      if (!session.parentID) return
      children.set(session.parentID, [...(children.get(session.parentID) ?? []), session.id])
    })
    const ids = [props.sessionID]
    // A breadth-first walk; `for...of` visits the IDs appended while it runs.
    for (const id of ids) ids.push(...(children.get(id) ?? []).filter((child) => !ids.includes(child)))
    return ids
  })

  // Remote reads for the open session; reconnects invalidate the cache and run these again.
  createEffect(() => {
    const id = props.sessionID
    if (!connected()) return
    void Promise.all([
      data.session.sync(id, { children: true }),
      data.session.message.sync(id),
      data.session.pending.sync(id),
    ])
      .then(() => setReady(true))
      .catch(toastError("Couldn't load the session"))
  })
  createEffect(() => {
    const ids = tree()
    // A session that is still being created has no requests yet; its events bring any new ones.
    if (!connected() || data.session.creating(props.sessionID)) return
    void Promise.all(ids.flatMap((id) => [data.session.permission.sync(id), data.session.form.sync(id)])).catch(
      toastError("Couldn't load pending requests"),
    )
  })

  const status = createMemo(() => (data.session.status(props.sessionID) === "running" ? busy : idle))
  // Queued prompts wait outside the transcript; pending steers render after the current response.
  const messages = createMemo(() => {
    const all = data.session.message.list(props.sessionID)
    const pending = data.session.pending.list(props.sessionID)
    const revert = info()?.revert?.messageID
    const queued = new Set(
      pending.flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item.id] : [])),
    )
    const steers = new Set(
      pending.flatMap((item) => (item.type === "user" && item.delivery === "steer" ? [item.id] : [])),
    )
    if (queued.size === 0 && steers.size === 0 && !revert) return all
    const visible = all.filter((message) => !queued.has(message.id) && (!revert || message.id < revert))
    if (steers.size === 0) return visible
    return [
      ...visible.filter((message) => !steers.has(message.id)),
      ...visible.filter((message) => steers.has(message.id)),
    ]
  })
  const document = createMemo(() => ({
    sessionID: props.sessionID,
    messages: messages(),
    status: status(),
    diffs: noDiffs,
  }))

  const location = createMemo(() => (directory() ? { directory: directory() } : undefined))
  const timelineData = createMemo(() => {
    const all = new Map<string, { models: Record<string, { name: string }> }>()
    ;(data.location.model.list(location()) ?? []).forEach((model) => {
      const entry = all.get(model.providerID) ?? { models: {} }
      entry.models[model.id] = { name: model.name }
      all.set(model.providerID, entry)
    })
    const sessions = data.session.list()
    return {
      agent: (data.location.agent.list(location()) ?? []).map((agent) => ({ name: agent.id, color: agent.color })),
      provider: { all, connected: Array.from(all.keys()), default: {} },
      session: sessions,
      session_status: Object.fromEntries(
        sessions.map((session) => [session.id, data.session.status(session.id) === "running" ? busy : idle]),
      ),
      session_diff: {},
    }
  })

  const permission = createMemo(() =>
    tree()
      .map((id) => data.session.permission.list(id)?.[0])
      .find((request) => request !== undefined),
  )
  const form = createMemo(() =>
    tree()
      .map((id) => data.session.form.list(id)?.[0])
      .find((request) => request !== undefined),
  )
  const blocked = () => !!permission() || !!form()
  const [responding, setResponding] = createSignal<string>()

  const decide = (decision: "once" | "always" | "reject") => {
    const request = permission()
    if (!request || responding() === request.id) return
    setResponding(request.id)
    void data.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.id, decision })
      .catch(toastError("Couldn't answer the permission request"))
      .finally(() => setResponding(undefined))
  }
  const settleForm = (action: (input: { sessionID: string; formID: string }) => Promise<unknown>) => {
    const request = form()
    if (!request || responding() === request.id) return
    setResponding(request.id)
    void action({ sessionID: request.sessionID, formID: request.id })
      .catch(toastError("Couldn't answer the question"))
      .finally(() => setResponding(undefined))
  }
  const reply = (answer: FormAnswer) => settleForm((input) => data.session.form.reply({ ...input, answer }))
  const dismiss = () => settleForm((input) => data.session.form.cancel(input))

  const working = () => status().type === "busy" && !blocked()
  const preview = () => {
    const request = server.background.preview()
    return request?.sessionID === props.sessionID ? request : undefined
  }

  let scroller!: HTMLDivElement
  let content!: HTMLDivElement
  const [pinned, setPinned] = createSignal(true)
  let dragging = false

  const scrollToEnd = () => {
    scroller.scrollTop = scroller.scrollHeight
    setPinned(true)
  }

  const loadOlder = () => {
    const id = props.sessionID
    if (!data.session.message.more(id) || data.session.message.loading(id)) return
    const before = { height: 0, top: 0 }
    void data.session.message
      .loadMore(id, {
        beforePublish: () => {
          before.height = scroller.scrollHeight
          before.top = scroller.scrollTop
        },
      })
      .then(() => {
        // Chrome's scroll anchoring usually keeps the reader in place; it does not apply at the very top.
        if (scroller.scrollTop === before.top) scroller.scrollTop = before.top + scroller.scrollHeight - before.height
      })
      .catch(toastError("Couldn't load older messages"))
  }

  // Follow the stream: the timeline grows as text streams and markdown renders, so keep the bottom in
  // view while the reader has not scrolled away.
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (pinned()) scroller.scrollTop = scroller.scrollHeight
      if (scroller.scrollHeight <= scroller.clientHeight) loadOlder()
    })
    observer.observe(content)
    observer.observe(scroller)
    onCleanup(() => observer.disconnect())
  })

  return (
    <DataProvider
      data={timelineData()}
      directory={directory()}
      sessionID={props.sessionID}
      shellRunning={(id) => !!data.shell.get(id)}
      shellOutput={(input) => server.api.shell.output(input)}
      onNavigateToSession={props.onOpen}
    >
      <MarkdownProvider openSession={props.onOpen}>
        <FileComponentProvider component={File}>
          <div class="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scroller}
              data-slot="session-timeline-scroll"
              class="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
              tabIndex={-1}
              onScroll={() => {
                const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
                // Content growth and scroll anchoring also scroll; only the reader's own scrolling unpins.
                if (distance < pinThreshold) setPinned(true)
                if (dragging && distance >= pinThreshold) setPinned(false)
                if (scroller.scrollTop < historyThreshold) loadOlder()
              }}
              onWheel={(event) => {
                if (event.deltaY < 0) setPinned(false)
              }}
              onKeyDown={(event) => {
                if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setPinned(false)
              }}
              onPointerDown={(event) => {
                // A press on the scroller itself, not its content, is the scrollbar.
                if (event.target === scroller) dragging = true
              }}
              onPointerUp={() => (dragging = false)}
              onPointerCancel={() => (dragging = false)}
            >
              <div ref={content} class="flex min-h-full flex-col pt-3 pb-4">
                <Show when={data.session.message.loading(props.sessionID)}>
                  <div class="flex justify-center py-2 text-v2-icon-icon-muted">
                    <Spinner class="size-3.5" />
                  </div>
                </Show>
                <Show
                  when={messages().length > 0}
                  fallback={
                    <Show when={!ready() && !data.session.creating(props.sessionID)}>
                      <div class="flex flex-1 items-center justify-center text-v2-icon-icon-muted">
                        <Spinner class="size-4" />
                      </div>
                    </Show>
                  }
                >
                  <SessionTimeline document={document()} />
                </Show>
                <Show when={working()}>
                  <div class="flex h-9 items-center px-4 pt-3 text-[13px] font-[530] leading-text-compact">
                    <div data-component="session-working" role="status">
                      <TextShimmer text="Working…" active />
                    </div>
                  </div>
                </Show>
              </div>
            </div>
            <Show when={!pinned()}>
              <IconButton
                variant="neutral"
                size="normal"
                class="absolute right-3 bottom-3 z-10 rounded-full shadow-[var(--v2-elevation-raised)]"
                icon={<Icon name="arrow-down-to-line" size="small" />}
                aria-label="Scroll to latest"
                onClick={scrollToEnd}
              />
            </Show>
            <Show when={preview()} keyed>
              {(request) => (
                <FilePreview
                  path={request.path}
                  directory={directory()}
                  onClose={() => server.background.closePreview()}
                />
              )}
            </Show>
          </div>
          <div class="flex shrink-0 flex-col gap-1 px-2 pb-2">
            <Show when={permission()} keyed>
              {(request) => (
                <PermissionDock request={request} responding={responding() === request.id} onDecide={decide} />
              )}
            </Show>
            <Show when={!permission() && form()} keyed>
              {(request) => (
                <Show
                  when={answerable(request)}
                  fallback={
                    <UnsupportedFormDock request={request} sending={responding() === request.id} onDismiss={dismiss} />
                  }
                >
                  <QuestionDock
                    request={request}
                    sending={responding() === request.id}
                    onReply={reply}
                    onDismiss={dismiss}
                  />
                </Show>
              )}
            </Show>
            <BrowserControlHandoffDock />
            <ScriptApprovalDock />
            <TabRequestDock />
            <BrowsingAccessDock />
            <Show
              when={
                !blocked() &&
                server.background.state.approvals.length === 0 &&
                server.background.state.access.length === 0
              }
            >
              <ScriptInstallCard sessionID={props.sessionID} />
            </Show>
            <BrowserStrip sessionID={props.sessionID} />
            <Show when={!blocked()}>
              <Composer sessionID={props.sessionID} ref={props.composerRef} />
            </Show>
          </div>
        </FileComponentProvider>
      </MarkdownProvider>
    </DataProvider>
  )
}
