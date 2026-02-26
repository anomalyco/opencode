import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { checkServerHealth, type ServerHealth } from "@/utils/server-health"

interface AddRowProps {
  value: string
  placeholder: string
  adding: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onBlur: () => void
}

interface EditRowProps {
  value: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onBlur: () => void
}

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer(platform: ReturnType<typeof usePlatform>, language: ReturnType<typeof useLanguage>) {
  const [defaultUrl, defaultUrlActions] = createResource(
    async () => {
      try {
        const url = await platform.getDefaultServerUrl?.()
        if (!url) return null
        return normalizeServerUrl(url) ?? null
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const canDefault = createMemo(() => !!platform.getDefaultServerUrl && !!platform.setDefaultServerUrl)
  const setDefault = async (url: string | null) => {
    try {
      await platform.setDefaultServerUrl?.(url)
      defaultUrlActions.mutate(url)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaultUrl, canDefault, setDefault }
}

function useServerPreview(fetcher: typeof fetch) {
  const looksComplete = (value: string) => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) return false
    const host = normalized.replace(/^https?:\/\//, "").split("/")[0]
    if (!host) return false
    if (host.includes("localhost") || host.startsWith("127.0.0.1")) return true
    return host.includes(".") || host.includes(":")
  }

  const previewStatus = async (value: string, setStatus: (value: boolean | undefined) => void) => {
    setStatus(undefined)
    if (!looksComplete(value)) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) return
    const result = await checkServerHealth({ url: normalized }, fetcher)
    setStatus(result.healthy)
  }

  return { previewStatus }
}

function AddRow(props: AddRowProps) {
  return (
    <div class="flex items-center px-4 min-h-14 py-3 min-w-0 flex-1">
      <div class="flex-1 min-w-0 [&_[data-slot=input-wrapper]]:relative">
        <div
          classList={{
            "size-1.5 rounded-full absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none": true,
            "bg-icon-success-base": props.status === true,
            "bg-icon-critical-base": props.status === false,
            "bg-border-weak-base": props.status === undefined,
          }}
          ref={(el) => {
            // Position relative to input-wrapper
            requestAnimationFrame(() => {
              const wrapper = el.parentElement?.querySelector('[data-slot="input-wrapper"]')
              if (wrapper instanceof HTMLElement) {
                wrapper.appendChild(el)
              }
            })
          }}
        />
        <TextField
          type="text"
          hideLabel
          placeholder={props.placeholder}
          value={props.value}
          autofocus
          validationState={props.error ? "invalid" : "valid"}
          error={props.error}
          disabled={props.adding}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
          onBlur={props.onBlur}
          class="pl-7"
        />
      </div>
    </div>
  )
}

function EditRow(props: EditRowProps) {
  return (
    <div class="flex items-center gap-3 px-4 min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
      <div
        classList={{
          "size-1.5 rounded-full shrink-0": true,
          "bg-icon-success-base": props.status === true,
          "bg-icon-critical-base": props.status === false,
          "bg-border-weak-base": props.status === undefined,
        }}
      />
      <div class="flex-1 min-w-0">
        <TextField
          type="text"
          hideLabel
          placeholder={props.placeholder}
          value={props.value}
          autofocus
          validationState={props.error ? "invalid" : "valid"}
          error={props.error}
          disabled={props.busy}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
          onBlur={props.onBlur}
        />
      </div>
    </div>
  )
}

export function DialogSelectServer() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const fetcher = platform.fetch ?? globalThis.fetch
  const { defaultUrl, canDefault, setDefault } = useDefaultServer(platform, language)
  const { previewStatus } = useServerPreview(fetcher)
  let listRoot: HTMLDivElement | undefined
  const [store, setStore] = createStore({
    status: {} as Record<ServerConnection.Key, ServerHealth | undefined>,
    addServer: {
      url: "",
      adding: false,
      error: "",
      showForm: false,
      status: undefined as boolean | undefined,
    },
    editServer: {
      id: undefined as string | undefined,
      value: "",
      error: "",
      busy: false,
      status: undefined as boolean | undefined,
    },
  })

  const resetAdd = () => {
    setStore("addServer", {
      url: "",
      error: "",
      showForm: false,
      status: undefined,
    })
  }

  const resetEdit = () => {
    setStore("editServer", {
      id: undefined,
      value: "",
      error: "",
      status: undefined,
      busy: false,
    })
  }

  const replaceServer = (original: ServerConnection.Http, next: string) => {
    const active = server.key
    const newConn = server.add(next)
    if (!newConn) return

    const nextActive = active === ServerConnection.key(original) ? ServerConnection.key(newConn) : active
    if (nextActive) server.setActive(nextActive)
    server.remove(ServerConnection.key(original))
  }

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const current = createMemo(() => items().find((x) => ServerConnection.key(x) === server.key) ?? items()[0])

  const sortedItems = createMemo(() => {
    const list = items()
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(store.status[ServerConnection.key(a)]) - rank(store.status[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<ServerConnection.Key, ServerHealth> = {}
    await Promise.all(
      items().map(async (conn) => {
        results[ServerConnection.key(conn)] = await checkServerHealth(conn.http, fetcher)
      }),
    )
    setStore("status", reconcile(results))
  }

  createEffect(() => {
    items()
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  async function select(conn: ServerConnection.Any, persist?: boolean) {
    if (!persist && store.status[ServerConnection.key(conn)]?.healthy === false) return
    dialog.close()
    if (persist) {
      server.add(conn.http.url)
      navigate("/")
      return
    }
    server.setActive(ServerConnection.key(conn))
    navigate("/")
  }

  const handleAddChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { url: value, error: "" })
    void previewStatus(value, (next) => setStore("addServer", { status: next }))
  }

  const scrollListToBottom = () => {
    const scroll = listRoot?.querySelector<HTMLDivElement>('[data-slot="list-scroll"]')
    if (!scroll) return
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight
    })
  }

  const handleEditChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { value, error: "" })
    void previewStatus(value, (next) => setStore("editServer", { status: next }))
  }

  async function handleAdd(value: string) {
    if (store.addServer.adding) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      resetAdd()
      return
    }

    setStore("addServer", { adding: true, error: "" })

    const result = await checkServerHealth({ url: normalized }, fetcher)
    setStore("addServer", { adding: false })

    if (!result.healthy) {
      setStore("addServer", { error: language.t("dialog.server.add.error") })
      return
    }

    resetAdd()
    await select({ type: "http", http: { url: normalized } }, true)
  }

  async function handleEdit(original: ServerConnection.Any, value: string) {
    if (store.editServer.busy || original.type !== "http") return
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      resetEdit()
      return
    }

    if (normalized === original.http.url) {
      resetEdit()
      return
    }

    setStore("editServer", { busy: true, error: "" })

    const result = await checkServerHealth({ url: normalized }, fetcher)
    setStore("editServer", { busy: false })

    if (!result.healthy) {
      setStore("editServer", { error: language.t("dialog.server.add.error") })
      return
    }

    replaceServer(original, normalized)

    resetEdit()
  }

  const handleAddKey = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    handleAdd(store.addServer.url)
  }

  const blurAdd = () => {
    if (!store.addServer.url.trim()) {
      resetAdd()
      return
    }
    handleAdd(store.addServer.url)
  }

  const handleEditKey = (event: KeyboardEvent, original: ServerConnection.Any) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      resetEdit()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    handleEdit(original, store.editServer.value)
  }

  async function handleRemove(url: ServerConnection.Key) {
    server.remove(url)
    if ((await platform.getDefaultServerUrl?.()) === url) {
      platform.setDefaultServerUrl?.(null)
    }
  }

  return (
    <Dialog title={language.t("dialog.server.title")}>
      <div class="flex flex-col gap-2">
        <div ref={(el) => (listRoot = el)}>
          <List
            search={{
              placeholder: language.t("dialog.server.search.placeholder"),
              autofocus: false,
            }}
            noInitialSelection
            emptyMessage={language.t("dialog.server.empty")}
            items={sortedItems}
            key={(x) => x.http.url}
            onSelect={(x) => {
              if (x) select(x)
            }}
            onFilter={(value) => {
              if (value && store.addServer.showForm && !store.addServer.adding) {
                resetAdd()
              }
            }}
            divider={true}
            class="px-5 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]:max-h-[300px] [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-raised-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent [&_[data-slot=list-item-add]]:px-0"
            add={
              store.addServer.showForm
                ? {
                    render: () => (
                      <AddRow
                        value={store.addServer.url}
                        placeholder={language.t("dialog.server.add.placeholder")}
                        adding={store.addServer.adding}
                        error={store.addServer.error}
                        status={store.addServer.status}
                        onChange={handleAddChange}
                        onKeyDown={handleAddKey}
                        onBlur={blurAdd}
                      />
                    ),
                  }
                : undefined
            }
          >
            {(i) => {
              const key = ServerConnection.key(i)
              return (
                <div class="flex items-center gap-3 min-w-0 flex-1 group/item">
                  <Show
                    when={store.editServer.id !== i.http.url}
                    fallback={
                      <EditRow
                        value={store.editServer.value}
                        placeholder={language.t("dialog.server.add.placeholder")}
                        busy={store.editServer.busy}
                        error={store.editServer.error}
                        status={store.editServer.status}
                        onChange={handleEditChange}
                        onKeyDown={(event) => handleEditKey(event, i)}
                        onBlur={() => handleEdit(i, store.editServer.value)}
                      />
                    }
                  >
                    <ServerRow
                      conn={i}
                      status={store.status[key]}
                      dimmed={store.status[key]?.healthy === false}
                      class="flex items-center gap-3 px-4 min-w-0 flex-1"
                      badge={
                        <Show when={defaultUrl() === i.http.url}>
                          <span class="text-text-weak bg-surface-base text-14-regular px-1.5 rounded-xs">
                            {language.t("dialog.server.status.default")}
                          </span>
                        </Show>
                      }
                    />
                  </Show>
                  <Show when={store.editServer.id !== i.http.url}>
                    <div class="flex items-center justify-center gap-5 pl-4">
                      <Show when={ServerConnection.key(current()) === key}>
                        <p class="text-text-weak text-12-regular">{language.t("dialog.server.current")}</p>
                      </Show>

                      <Show when={i.type === "http"}>
                        <DropdownMenu>
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="dot-grid"
                            variant="ghost"
                            class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                            onClick={(e: MouseEvent) => e.stopPropagation()}
                            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="mt-1">
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setStore("editServer", {
                                    id: i.http.url,
                                    value: i.http.url,
                                    error: "",
                                    status: store.status[ServerConnection.key(i)]?.healthy,
                                  })
                                }}
                              >
                                <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                              <Show when={canDefault() && defaultUrl() !== i.http.url}>
                                <DropdownMenu.Item onSelect={() => setDefault(i.http.url)}>
                                  <DropdownMenu.ItemLabel>
                                    {language.t("dialog.server.menu.default")}
                                  </DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </Show>
                              <Show when={canDefault() && defaultUrl() === i.http.url}>
                                <DropdownMenu.Item onSelect={() => setDefault(null)}>
                                  <DropdownMenu.ItemLabel>
                                    {language.t("dialog.server.menu.defaultRemove")}
                                  </DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </Show>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onSelect={() => handleRemove(ServerConnection.key(i))}
                                class="text-text-on-critical-base hover:bg-surface-critical-weak"
                              >
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.delete")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}
          </List>
        </div>

        <div class="px-5 pb-5">
          <Button
            variant="secondary"
            icon="plus-small"
            size="large"
            onClick={() => {
              setStore("addServer", { showForm: true, url: "", error: "" })
              scrollListToBottom()
            }}
            class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
          >
            {store.addServer.adding ? language.t("dialog.server.add.checking") : language.t("dialog.server.add.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
