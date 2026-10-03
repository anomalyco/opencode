// The prompt box. In a session it sends (or steers) and stops; in a new conversation it starts a session
// in the selected directory. Mirrors the desktop composer's surface and controls at side panel scale.
import type { ModelInfo, ModelRef, SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "./connection"
import { toastError } from "./format"

// Drafts outlive the composer, so switching between a new conversation and sessions keeps unsent text.
const [drafts, setDrafts] = createStore<Record<string, string>>({})

/** An image pasted, dropped, or picked into a draft; it travels inline with the prompt as a data URL. */
type DraftImage = { id: string; name: string; mime: string; url: string }
const [images, setImages] = createStore<Record<string, DraftImage[]>>({})
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
// The desktop composer's inline limit.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

type DraftTarget = { sessionID?: string; directory?: string }

const keyFor = (target: DraftTarget) => target.sessionID ?? `new:${target.directory ?? ""}`

/** Starts a prompt in a composer's draft, after any unsent text, for actions outside the composer. */
export function prefillDraft(target: DraftTarget, text: string) {
  const current = drafts[keyFor(target)]?.trimEnd()
  setDrafts(keyFor(target), current ? `${current}\n${text}` : text)
}

export function Composer(props: {
  sessionID?: string
  directory?: string
  onCreate?: (sessionID: string, request: Promise<SessionInfo>) => void
  ref?: (element: HTMLTextAreaElement) => void
}) {
  const server = useServer()
  const data = server.data
  const [choice, setChoice] = createStore<{ agent?: string; model?: ModelRef }>({})
  const [include, setInclude] = createSignal(false)
  const [defaults, setDefaults] = createStore<Record<string, ModelInfo | null>>({})
  const draftKey = () => keyFor(props)
  const text = () => drafts[draftKey()] ?? ""
  const attached = () => images[draftKey()] ?? []
  const ready = () => !!text().trim() || attached().length > 0
  let picker: HTMLInputElement | undefined

  const addImages = async (files: File[]) => {
    const key = draftKey()
    const accepted = files.filter((file) => IMAGE_TYPES.includes(file.type))
    if (files.length && !accepted.length) return toastError("Couldn't attach")("Only PNG, JPEG, GIF, and WebP images can be attached.")
    const fitting = accepted.filter((file) => file.size <= MAX_IMAGE_BYTES)
    if (fitting.length < accepted.length) toastError("Couldn't attach")("Images must be 20 MB or smaller.")
    const read = await Promise.all(
      fitting.map(
        (file) =>
          new Promise<DraftImage>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({ id: crypto.randomUUID(), name: file.name || "Pasted image", mime: file.type, url: String(reader.result) })
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          }),
      ),
    ).catch((error: unknown) => {
      toastError("Couldn't attach")(error)
      return []
    })
    if (read.length) setImages(key, (current) => [...(current ?? []), ...read])
  }
  const removeImage = (id: string) => setImages(draftKey(), (current) => (current ?? []).filter((image) => image.id !== id))
  const session = createMemo(() => (props.sessionID ? data.session.get(props.sessionID) : undefined))
  const directory = createMemo(() => session()?.location.directory ?? props.directory)
  const location = createMemo(() => {
    const value = directory()
    return value ? { directory: value } : undefined
  })
  const connected = () => server.connection.status() === "connected"

  // Remote reads for the agent and model controls of this location.
  createEffect(() => {
    const value = location()
    if (!value || !connected()) return
    void Promise.all([
      data.location.agent.sync(value),
      data.location.model.sync(value),
      data.location.provider.sync(value),
    ]).catch(toastError("Couldn't load agents and models"))
  })
  createEffect(() => {
    const value = directory()
    if (!value || !connected() || value in defaults) return
    void server.api.model
      .default({ location: { directory: value } })
      .then((response) => setDefaults(value, response.data))
      .catch(() => setDefaults(value, null))
  })

  const agents = createMemo(() =>
    (data.location.agent.list(location()) ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
  )
  const models = createMemo(() => (data.location.model.list(location()) ?? []).filter((model) => model.enabled))
  const providers = createMemo(() => {
    const names = new Map((data.location.provider.list(location()) ?? []).map((item) => [item.id, item.name]))
    const groups = new Map<string, ModelInfo[]>()
    models().forEach((model) => groups.set(model.providerID, [...(groups.get(model.providerID) ?? []), model]))
    return Array.from(groups, ([id, items]) => ({ id, name: names.get(id) ?? id, models: items }))
  })
  // A new session starts like the directory's most recent one, so the controls show what will run.
  const recent = createMemo(() =>
    data.session.list().find((item) => item.location.directory === props.directory && !item.parentID),
  )
  const fallbackModel = (): ModelRef | undefined => {
    const value = directory()
    const model = value ? defaults[value] : undefined
    return model ? { id: model.id, providerID: model.providerID } : undefined
  }
  const agent = createMemo(() => {
    const current = session()
    if (current) return current.agent ?? agents()[0]?.id
    return choice.agent ?? recent()?.agent ?? agents()[0]?.id
  })
  const model = createMemo(() => {
    const current = session()
    if (current) return current.model ?? fallbackModel()
    return choice.model ?? recent()?.model ?? fallbackModel()
  })
  const modelName = () => {
    const ref = model()
    if (!ref) return "Default model"
    return models().find((item) => item.providerID === ref.providerID && item.id === ref.id)?.name ?? ref.id
  }
  const agentName = () => agents().find((item) => item.id === agent())?.name ?? agent() ?? "Agent"

  const busy = () => !!props.sessionID && data.session.status(props.sessionID) === "running"
  const stopping = () => busy() && !ready()
  const activeTab = () => server.background.state.activeTab
  const includable = () => !props.sessionID && !!activeTab()?.shareable

  const selectAgent = (id: string) => {
    const sessionID = props.sessionID
    if (!sessionID) return setChoice("agent", id)
    void server.api.session.switchAgent({ sessionID, agent: id }).catch(toastError("Couldn't switch agent"))
  }
  const selectModel = (ref: ModelRef) => {
    const sessionID = props.sessionID
    if (!sessionID) return setChoice("model", ref)
    void server.api.session.switchModel({ sessionID, model: ref }).catch(toastError("Couldn't switch model"))
  }

  const stop = () => {
    const sessionID = props.sessionID
    if (!sessionID) return
    void server.api.session.interrupt({ sessionID }).catch(toastError("Couldn't stop the session"))
  }

  const submit = () => {
    const value = text().trim()
    const pictures = attached()
    if (!value && !pictures.length) return
    const key = draftKey()
    const files = pictures.length ? pictures.map((image) => ({ uri: image.url, name: image.name })) : undefined
    const restore = () => {
      if (!drafts[key]) setDrafts(key, value)
      if (!images[key]?.length) setImages(key, pictures)
    }
    const sessionID = props.sessionID
    if (sessionID) {
      setDrafts(key, "")
      setImages(key, [])
      void data.session.prompt({ sessionID, text: value, files }).catch((error: unknown) => {
        restore()
        toastError("Couldn't send message")(error)
      })
      return
    }
    const target = props.directory
    if (!target) return
    const tab = include() ? activeTab() : undefined
    const created = data.session.create({
      location: { directory: target },
      agent: agent(),
      model: model(),
    })
    setDrafts(key, "")
    setImages(key, [])
    setInclude(false)
    props.onCreate?.(created.id, created.request)
    void created.request
      .then(() => {
        // The background attaches the session's browser on `session.show`, sent by onCreate first.
        if (tab) server.background.send({ type: "tab.share", sessionID: created.id, chromeTabID: tab.chromeTabID })
      })
      .catch((error: unknown) => {
        restore()
        toastError("Couldn't start a session")(error)
      })
    void data.session.prompt({ sessionID: created.id, text: value, files }).catch((error: unknown) => {
      // A failed create already reported itself and rolled the session back.
      if (!data.session.get(created.id)) return
      toastError("Couldn't send message")(error)
    })
  }

  const placeholder = () => {
    if (busy()) return "Steer the agent…"
    if (props.sessionID) return "Ask a follow-up…"
    return "Ask anything…"
  }

  return (
    <form
      data-component="composer"
      class="relative w-full overflow-clip rounded-xl shadow-[var(--v2-elevation-raised)]"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (!files.length) return
        event.preventDefault()
        void addImages(files)
      }}
    >
      <Show when={attached().length > 0}>
        <div class="flex gap-2 overflow-x-auto px-3 pt-3 no-scrollbar" aria-label="Attached images">
          <For each={attached()}>
            {(image) => (
              <div class="group relative size-14 shrink-0">
                <img
                  src={image.url}
                  alt={image.name}
                  title={image.name}
                  class="size-14 rounded-lg border border-v2-border-border-muted object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${image.name}`}
                  class="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-v2-background-bg-inverse text-v2-text-text-inverse opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => removeImage(image.id)}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={props.ref}
        rows={1}
        dir="auto"
        aria-label="Prompt"
        placeholder={placeholder()}
        value={text()}
        class="block max-h-[180px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] font-[440] leading-5 text-v2-text-text-base [field-sizing:content] placeholder:text-v2-text-text-faint focus:outline-none"
        onInput={(event) => setDrafts(draftKey(), event.currentTarget.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))
          if (!files.length) return
          event.preventDefault()
          void addImages(files)
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
          event.preventDefault()
          if (event.repeat) return
          submit()
        }}
      />
      <div class="flex h-10 items-center gap-1 ps-1.5 pe-2">
        <div class="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain no-scrollbar">
          <input
            ref={picker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(event) => {
              void addImages(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ""
            }}
          />
          <Tooltip placement="top" value="Attach images">
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              class="shrink-0"
              icon={<Icon name="plus" />}
              aria-label="Attach images"
              onClick={() => picker?.click()}
            />
          </Tooltip>
          <Show when={includable() && activeTab()}>
            {(tab) => (
              <Tooltip
                placement="top"
                value={
                  tab().sessionID
                    ? `Share “${tab().title}” with the new session. It moves from the session using it now.`
                    : `Share “${tab().title}” with the new session so the agent can use it.`
                }
              >
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="normal"
                  aria-pressed={include()}
                  class="max-w-[160px] shrink-0 justify-start ![font-weight:440]"
                  classList={{ "bg-v2-background-bg-layer-02 !text-v2-text-text-base": include() }}
                  onClick={() => setInclude((value) => !value)}
                >
                  <Favicon url={tab().favIconUrl} />
                  <span class="truncate">{include() ? "This tab" : "Include tab"}</span>
                  <Show when={include()}>
                    <Icon name="check-small" size="small" class="shrink-0" />
                  </Show>
                </Button>
              </Tooltip>
            )}
          </Show>
          <Show when={agents().length > 0}>
            <Menu gutter={6} modal={false} placement="top-start">
              <Menu.Trigger
                as={Button}
                type="button"
                variant="ghost-muted"
                size="normal"
                class="max-w-[140px] shrink-0 justify-start ![font-weight:440]"
                aria-label="Choose agent"
              >
                <span class="truncate">{agentName()}</span>
                <Icon name="chevron-down" size="small" class="-me-1 shrink-0" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content>
                  <Menu.RadioGroup value={agent()} onChange={selectAgent}>
                    <For each={agents()}>
                      {(item) => (
                        <Menu.RadioItem value={item.id} closeOnSelect>
                          {item.name}
                        </Menu.RadioItem>
                      )}
                    </For>
                  </Menu.RadioGroup>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </Show>
          <Menu gutter={6} modal={false} placement="top-start">
            <Menu.Trigger
              as={Button}
              type="button"
              variant="ghost-muted"
              size="normal"
              class="min-w-0 max-w-[200px] justify-start ![font-weight:440]"
              aria-label="Choose model"
              disabled={models().length === 0}
            >
              <span class="truncate">{modelName()}</span>
              <Icon name="chevron-down" size="small" class="-me-1 shrink-0" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content class="max-h-[min(420px,60vh)] max-w-[calc(100vw-16px)] overflow-y-auto">
                <Menu.RadioGroup
                  value={model() ? `${model()!.providerID}/${model()!.id}` : undefined}
                  onChange={(value) => {
                    const found = models().find((item) => `${item.providerID}/${item.id}` === value)
                    if (found) selectModel({ id: found.id, providerID: found.providerID })
                  }}
                >
                  <For each={providers()}>
                    {(provider) => (
                      <Menu.Group>
                        <Menu.GroupLabel>{provider.name}</Menu.GroupLabel>
                        <For each={provider.models}>
                          {(item) => (
                            <Menu.RadioItem value={`${item.providerID}/${item.id}`} closeOnSelect>
                              <span class="truncate">{item.name}</span>
                            </Menu.RadioItem>
                          )}
                        </For>
                      </Menu.Group>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
        <Tooltip placement="top" inactive={!stopping() && !ready()} value={stopping() ? "Stop" : "Send"}>
          <IconButton
            data-action="composer-submit"
            type="button"
            variant="submit"
            class="size-7 rounded-md p-[6px]"
            disabled={!stopping() && (!ready() || (!props.sessionID && !props.directory))}
            icon={<Icon name={stopping() ? "stop" : "arrow-up"} />}
            aria-label={stopping() ? "Stop" : "Send"}
            onClick={() => {
              if (stopping()) return stop()
              submit()
            }}
          />
        </Tooltip>
      </div>
    </form>
  )
}

export function Favicon(props: { url?: string }) {
  const globe = () => <Icon name="globe" size="small" class="shrink-0 text-v2-icon-icon-muted" />
  // Keyed by URL, so a page that fixes a broken icon gets another chance to load it.
  return (
    <Show when={props.url} keyed fallback={globe()}>
      {(url) => {
        const [failed, setFailed] = createSignal(false)
        return (
          <Show when={!failed()} fallback={globe()}>
            <img src={url} alt="" class="size-3.5 shrink-0 rounded-[3px]" onError={() => setFailed(true)} />
          </Show>
        )
      }}
    </Show>
  )
}
