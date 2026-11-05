import { Component, createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import fuzzysort from "fuzzysort"
import type { McpServer } from "@opencode/client/promise"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { ErrorDetails } from "@opencode/ui/error-details"
import { SearchList } from "@opencode/ui/search-list"
import { Switch } from "@opencode/ui/switch"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useLanguage } from "@/runtime/i18n/language"
import { type McpController, useMcpController } from "@/providers/connect/mcp"
import { mcpDetailAttempt, mcpDetailView, mcpRowView } from "@/providers/connect/mcp-machine"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import "@/shell/commands/dialog.css"
import "@/shell/search-list.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

/** The MCPs dialog for the current workspace. */
export const DialogSelectMcp: Component = () => {
  const sdk = useWorkspaceLocation()

  return <DialogMcp directory={sdk().directory} />
}

/** Lists the MCP servers of `directory`; `server` opens directly on that server's error. */
export const DialogMcp: Component<{ directory: string; server?: string }> = (props) => {
  const data = useData()
  const mcp = useMcpController(() => props.directory)

  createEffect(() => void data.location.mcp.server.sync({ directory: props.directory }).catch(() => undefined))

  return (
    <McpDialog
      servers={data.location.mcp.server.list({ directory: props.directory })}
      server={props.server}
      mcp={mcp.controller()}
    />
  )
}

export function McpDialog(props: {
  servers: McpServer[] | undefined
  server?: string
  mcp: Pick<McpController, "state" | "dispatch" | "onFocus">
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [query, setQuery] = createSignal("")

  const servers = createMemo(() => props.servers ?? [])
  const statusOf = (name: string) => servers().find((server) => server.name === name)?.status

  const items = createMemo(() =>
    servers()
      .map((server) => ({ name: server.name, status: server.status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const results = createMemo(() => {
    const current = query().trim()

    if (!current) return items()

    return fuzzysort
      .go(current, items(), { keys: ["name", "status"] })
      .map((result) => result.obj)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  // The error view's server, by attempt, so its status follows the list while it shows.
  const target = createMemo(() => mcpDetailAttempt(props.mcp.state()), undefined, {
    equals: (previous, next) => previous?.attempt === next?.attempt,
  })

  const detail = createMemo(() => {
    const current = target()

    return mcpDetailView(props.mcp.state(), current ? statusOf(current.name)?.status : undefined)
  })

  const toggle = (name: string, enabled: boolean) =>
    props.mcp.dispatch({ type: "toggle.requested", name, enabled, status: statusOf(name)?.status })

  // Like the TUI, a failed server's row opens its error; retrying and disabling happen there.
  const select = (name: string) => {
    const status = statusOf(name)

    if (status?.status !== "failed") return toggle(name, status?.status !== "connected")
    props.mcp.dispatch({ type: "detail.opened", name, loaded: true, status, focus: true })
  }

  const back = () => {
    const current = detail()

    if (current) props.mcp.dispatch({ type: "detail.dismissed", attempt: current.attempt })
  }

  const onDetailKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    back()
  }

  const copy = (current: { attempt: number; name: string; error: string }) => {
    const details = language.t("dialog.mcp.error.details", { name: current.name, error: current.error })

    return (platform.writeClipboardText?.(details) ?? navigator.clipboard.writeText(details))
      .then(() => props.mcp.dispatch({ type: "detail.copied", attempt: current.attempt, error: current.error }))
      .catch((error) =>
        showToast({
          variant: "error",
          title: language.t("dialog.mcp.error.copyFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
  }

  let listRef: HTMLDivElement | undefined
  let backRef: HTMLButtonElement | undefined

  // Opens before the first render, so the dialog mounts on the error and its Back button takes the initial focus.
  const initial = untrack(() => props.server)

  if (initial)
    props.mcp.dispatch({
      type: "detail.opened",
      name: initial,
      loaded: untrack(() => props.servers) !== undefined,
      status: untrack(() => statusOf(initial)),
      focus: false,
    })

  // Follows the shown server's status, which changes here and anywhere else: a reconnect or a removal returns to the
  // list, and a new failure replaces the error in place.
  createEffect(() => {
    const current = target()

    if (!current) return
    const synced = { loaded: props.servers !== undefined, status: statusOf(current.name) }
    untrack(() => props.mcp.dispatch({ type: "server.synced", attempt: current.attempt, ...synced }))
  })

  // The list stays mounted behind the error, so going back keeps the search, the highlight and the scroll.
  createEffect(() =>
    onCleanup(
      props.mcp.onFocus((effect) =>
        requestAnimationFrame(() => {
          if (effect.type === "focus-detail") return backRef?.focus()
          listRef?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()
        }),
      ),
    ),
  )

  onCleanup(() => {
    const current = untrack(target)

    if (current) props.mcp.dispatch({ type: "detail.closed", attempt: current.attempt })
  })

  return (
    // Like the model picker and the TUI, the list has no visible header; the search field leads.
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <Show
        when={detail()}
        fallback={
          <div class="sr-only">
            <DialogTitle>{language.t("dialog.mcp.title")}</DialogTitle>
          </div>
        }
      >
        {(current) => (
          // Escape steps back to the list, like the TUI, instead of closing the dialog.
          <div class="contents" data-owns-escape onKeyDown={onDetailKeyDown}>
            <DialogHeader>
              <div class="mcp-error-heading">
                <button
                  ref={backRef}
                  type="button"
                  autofocus
                  class="flex size-5 shrink-0 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                  onClick={back}
                  aria-label={language.t("common.goBack")}
                >
                  <Icon name="arrow-left" size="small" />
                </button>
                <DialogTitleGroup
                  title={
                    <span dir="auto" class="[overflow-wrap:anywhere]">
                      {current().name}
                    </span>
                  }
                  description={language.t("dialog.mcp.error.status")}
                />
              </div>
            </DialogHeader>
            <DialogBody class="search-list-body">
              <ErrorDetails error={current().error}>
                <Button
                  class="error-details-copy"
                  variant="ghost-muted"
                  icon={current().copied ? "check" : "copy"}
                  onClick={() => void copy(current())}
                >
                  {language.t(current().copied ? "common.copied" : "dialog.mcp.error.copy")}
                </Button>
                <Button variant="ghost" disabled={current().busy} onClick={() => toggle(current().name, false)}>
                  {language.t("dialog.mcp.error.disable")}
                </Button>
                <Button variant="neutral" disabled={current().busy} onClick={() => toggle(current().name, true)}>
                  {language.t("common.retry")}
                </Button>
              </ErrorDetails>
            </DialogBody>
          </div>
        )}
      </Show>
      <div class="contents" ref={listRef} style={{ display: detail() ? "none" : undefined }}>
        <DialogBody class="command-palette-body">
          <SearchList
            query={query()}
            onQuery={setQuery}
            placeholder={language.t("dialog.mcp.search.placeholder")}
            items={results()}
            key={(item) => item.name}
            empty={language.t(items().length > 0 ? "dialog.mcp.search.empty" : "dialog.mcp.empty")}
            onSelect={(item) => select(item.name)}
          >
            {(item, row) => {
              const server = () => servers().find((entry) => entry.name === item().name)
              const status = () => server()?.status

              const error = () => {
                const current = status()

                return current?.status === "failed" ? current.error : undefined
              }

              // The switch would start sign-in anyway, so an auth-gated server shows that action instead.
              const signIn = () => status()?.status === "needs_auth" && !!server()?.integrationID

              const view = () => mcpRowView(props.mcp.state(), item().name, status()?.status)
              const busy = () => view().busy

              // The dot shows the status, as in the session's MCP list; the words stay for assistive technology.
              const label = () => {
                const current = status()?.status

                return current && current !== "pending" ? language.t(statusLabels[current]) : undefined
              }

              return (
                <div {...row} data-option-key={item().name} data-status={status()?.status} data-size="compact">
                  <span class="mcp-dialog-lead">
                    <span class="mcp-dialog-status" aria-hidden="true">
                      <span class="mcp-status-dot" data-status={status()?.status} />
                    </span>
                    <TruncatedText text={item().name} class="mcp-dialog-name" />
                  </span>
                  <div class="mcp-trailing" onClick={(event) => event.stopPropagation()}>
                    <Show when={error()}>
                      <Button
                        size="small"
                        variant="ghost-muted"
                        class="mcp-status-action"
                        aria-label={language.t("dialog.mcp.error.viewLabel", { name: item().name })}
                        onClick={() => select(item().name)}
                      >
                        {language.t("dialog.mcp.error.view")}
                      </Button>
                    </Show>
                    <Show
                      when={signIn()}
                      fallback={
                        <Switch
                          checked={!!status() && status()?.status !== "disabled"}
                          disabled={view().pending}
                          description={label()}
                          class="[&_[data-slot=switch-description]]:sr-only"
                          onChange={(enabled) => toggle(item().name, enabled)}
                        >
                          <span class="sr-only">{item().name}</span>
                        </Switch>
                      }
                    >
                      <Button
                        size="small"
                        variant="ghost-muted"
                        class="mcp-status-action"
                        disabled={busy()}
                        aria-busy={busy()}
                        aria-label={language.t("dialog.mcp.signIn.open", { name: item().name })}
                        onClick={() => toggle(item().name, true)}
                      >
                        {language.t(busy() ? "dialog.mcp.signingIn" : "dialog.mcp.signIn")}
                      </Button>
                    </Show>
                  </div>
                </div>
              )
            }}
          </SearchList>
        </DialogBody>
      </div>
    </Dialog>
  )
}
