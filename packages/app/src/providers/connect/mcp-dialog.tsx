import { Component, createEffect, createMemo, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import fuzzysort from "fuzzysort"
import { Predicate } from "effect"
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
import { useMcpToggle } from "@/providers/connect/mcp"
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
  const directory = () => props.directory
  const toggle = useMcpToggle(directory)

  const target = () => {
    const current = toggle.isPending ? toggle.variables : undefined

    return Predicate.isString(current) ? current : current?.name
  }

  createEffect(() => void data.location.mcp.server.sync({ directory: directory() }).catch(() => undefined))

  return (
    <McpDialog
      servers={data.location.mcp.server.list({ directory: directory() })}
      server={props.server}
      pending={toggle.isPending}
      target={target()}
      onToggle={(input) => toggle.mutate(input)}
    />
  )
}

export function McpDialog(props: {
  servers: McpServer[] | undefined
  server?: string
  pending: boolean
  target?: string
  onToggle: (input: string | { name: string; enabled: boolean }) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()

  const [store, setStore] = createStore<{ detail?: string; copied: boolean; query: string }>({
    detail: props.server,
    copied: false,
    query: "",
  })

  const loaded = () => props.servers
  const servers = createMemo(() => loaded() ?? [])

  const items = createMemo(() =>
    servers()
      .map((server) => ({ name: server.name, status: server.status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const results = createMemo(() => {
    const query = store.query.trim()

    if (!query) return items()

    return fuzzysort
      .go(query, items(), { keys: ["name", "status"] })
      .map((result) => result.obj)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  // Like the TUI, a failed server's row opens its error; retrying and disabling happen there.
  const failure = createMemo(() => {
    const server = servers().find((item) => item.name === store.detail)

    return server?.status.status === "failed" ? { name: server.name, error: server.status.error } : undefined
  })

  const toggleServer = (name: string) => {
    const status = servers().find((server) => server.name === name)?.status.status

    if (!status || status === "pending" || props.pending) return
    props.onToggle(name)
  }

  const select = (name: string) => {
    if (servers().find((server) => server.name === name)?.status.status !== "failed") return toggleServer(name)
    setStore({ detail: name, copied: false })
    requestAnimationFrame(() => backRef?.focus())
  }

  // The list stays mounted behind the error, so going back keeps the search, the highlight and the scroll.
  const back = () => {
    setStore("detail", undefined)
    requestAnimationFrame(() => listRef?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus())
  }

  const onDetailKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    back()
  }

  // A successful retry or a removed server leaves nothing to show, so return to the list.
  createEffect(
    on(failure, (current) => {
      if (store.detail && loaded() && !current) back()
    }),
  )

  const copy = (current: { name: string; error: string }) => {
    const details = language.t("dialog.mcp.error.details", { name: current.name, error: current.error })

    return (platform.writeClipboardText?.(details) ?? navigator.clipboard.writeText(details))
      .then(() => setStore("copied", true))
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

  return (
    // Like the model picker and the TUI, the list has no visible header; the search field leads.
    <Dialog class="command-palette command-palette-compact search-list-dialog mcp-dialog" size="large" fit>
      <Show
        when={failure()}
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
                  icon={store.copied ? "check" : "copy"}
                  onClick={() => void copy(current())}
                >
                  {language.t(store.copied ? "common.copied" : "dialog.mcp.error.copy")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={props.pending}
                  onClick={() => props.onToggle({ name: current().name, enabled: false })}
                >
                  {language.t("dialog.mcp.error.disable")}
                </Button>
                <Button variant="neutral" disabled={props.pending} onClick={() => toggleServer(current().name)}>
                  {language.t("common.retry")}
                </Button>
              </ErrorDetails>
            </DialogBody>
          </div>
        )}
      </Show>
      <div class="contents" ref={listRef} style={{ display: failure() ? "none" : undefined }}>
        <DialogBody class="command-palette-body">
          <SearchList
            query={store.query}
            onQuery={(query) => setStore("query", query)}
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

              const busy = () => props.target === item().name

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
                          disabled={status()?.status === "pending" || busy()}
                          description={label()}
                          class="[&_[data-slot=switch-description]]:sr-only"
                          onChange={(enabled) => {
                            if (props.pending) return
                            props.onToggle({ name: item().name, enabled })
                          }}
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
                        onClick={() => toggleServer(item().name)}
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
