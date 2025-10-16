import { FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import * as KobalteTabs from "@kobalte/core/tabs"
import FileTree from "@/components/file-tree"
import EditorPane from "@/components/editor-pane"
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { SelectDialog } from "@/components/select-dialog"
import { useSync, useSDK, useLocal } from "@/context"
import type { LocalFile, TextSelection } from "@/context/local"
import SessionList from "@/components/session-list"
import SessionTimeline from "@/components/session-timeline"
import PromptForm, { type PromptContentPart, type PromptSubmitValue } from "@/components/prompt-form"
import { createStore } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"
import { Select } from "@/components/select"
import { Tabs } from "@/ui/tabs"
import { Code } from "@/components/code"

export default function Page() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    modelSelectOpen: false,
    fileSelectOpen: false,
  })

  let inputRef: HTMLTextAreaElement | undefined = undefined

  const MOD = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.getModifierState(MOD) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault()
      // TODO: command palette
      return
    }
    if (event.getModifierState(MOD) && event.key.toLowerCase() === "p") {
      event.preventDefault()
      setStore("fileSelectOpen", true)
      return
    }

    const focused = document.activeElement === inputRef
    if (focused) {
      if (event.key === "Escape") {
        inputRef?.blur()
      }
      return
    }

    if (local.file.active()) {
      const active = local.file.active()!
      if (event.key === "Enter" && active.selection) {
        local.context.add({
          type: "file",
          path: active.path,
          selection: { ...active.selection },
        })
        return
      }

      if (event.getModifierState(MOD)) {
        if (event.key.toLowerCase() === "a") {
          return
        }
        if (event.key.toLowerCase() === "c") {
          return
        }
      }
    }

    if (event.key.length === 1 && event.key !== "Unidentified") {
      inputRef?.focus()
    }
  }

  const resetClickTimer = () => {
    if (!store.clickTimer) return
    clearTimeout(store.clickTimer)
    setStore("clickTimer", undefined)
  }

  const startClickTimer = () => {
    const newClickTimer = setTimeout(() => {
      setStore("clickTimer", undefined)
    }, 300)
    setStore("clickTimer", newClickTimer as unknown as number)
  }

  const handleFileClick = async (file: LocalFile) => {
    if (store.clickTimer) {
      resetClickTimer()
      local.file.update(file.path, { ...file, pinned: true })
    } else {
      local.file.open(file.path)
      startClickTimer()
    }
  }

  const handlePromptSubmit = async (prompt: PromptSubmitValue) => {
    const existingSession = local.session.active()
    let session = existingSession
    if (!session) {
      const created = await sdk.session.create()
      session = created.data ?? undefined
    }
    if (!session) return
    local.session.setActive(session.id)

    interface SubmissionAttachment {
      path: string
      selection?: TextSelection
      label: string
    }

    const createAttachmentKey = (path: string, selection?: TextSelection) => {
      if (!selection) return path
      return `${path}:${selection.startLine}:${selection.startChar}:${selection.endLine}:${selection.endChar}`
    }

    const formatAttachmentLabel = (path: string, selection?: TextSelection) => {
      if (!selection) return getFilename(path)
      return `${getFilename(path)} (${selection.startLine}-${selection.endLine})`
    }

    const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))

    const attachments = new Map<string, SubmissionAttachment>()

    const registerAttachment = (path: string, selection: TextSelection | undefined, label?: string) => {
      if (!path) return
      const key = createAttachmentKey(path, selection)
      if (attachments.has(key)) return
      attachments.set(key, {
        path,
        selection,
        label: label ?? formatAttachmentLabel(path, selection),
      })
    }

    const promptAttachments = prompt.parts.filter(
      (part): part is Extract<PromptContentPart, { kind: "attachment" }> => part.kind === "attachment",
    )

    for (const part of promptAttachments) {
      registerAttachment(part.path, part.selection, part.display)
    }

    const activeFile = local.context.active()
    if (activeFile) {
      registerAttachment(
        activeFile.path,
        activeFile.selection,
        activeFile.name ?? formatAttachmentLabel(activeFile.path, activeFile.selection),
      )
    }

    for (const contextFile of local.context.all()) {
      registerAttachment(
        contextFile.path,
        contextFile.selection,
        formatAttachmentLabel(contextFile.path, contextFile.selection),
      )
    }

    const attachmentParts = Array.from(attachments.values()).map((attachment) => {
      const absolute = toAbsolutePath(attachment.path)
      const query = attachment.selection
        ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
        : ""
      return {
        type: "file" as const,
        mime: "text/plain",
        url: `file://${absolute}${query}`,
        filename: getFilename(attachment.path),
        source: {
          type: "file" as const,
          text: {
            value: `@${attachment.label}`,
            start: 0,
            end: 0,
          },
          path: absolute,
        },
      }
    })

    await sdk.session.prompt({
      path: { id: session.id },
      body: {
        agent: local.agent.current()!.name,
        model: {
          modelID: local.model.current()!.id,
          providerID: local.model.current()!.provider.id,
        },
        parts: [
          {
            type: "text",
            text: prompt.text,
          },
          ...attachmentParts,
        ],
      },
    })
  }

  const plus = (
    <IconButton
      class="text-text-muted/60 peer-data-[selected]/tab:opacity-100 peer-data-[selected]/tab:text-text peer-data-[selected]/tab:hover:bg-border-subtle hover:opacity-100 peer-hover/tab:opacity-100"
      size="xs"
      variant="secondary"
      onClick={() => setStore("fileSelectOpen", true)}
    >
      <Icon name="plus" size={12} />
    </IconButton>
  )

  return (
    <div class="relative h-screen flex flex-col">
      <header class="h-12 shrink-0"></header>
      <main class="h-[calc(100vh-3rem)] flex">
        <div class="hidden shrink-0 w-64">
          <SessionList />
        </div>
        <div class="grow w-full min-w-0 overflow-y-auto flex justify-center">
          <Show when={local.session.active()}>
            {(activeSession) => <SessionTimeline session={activeSession().id} class="max-w-xl" />}
          </Show>
        </div>
        <div class="hidden shrink-0 w-56 p-2 h-full overflow-y-auto">
          <FileTree path="" onFileClick={handleFileClick} />
        </div>
        <div class="hidden shrink-0 w-56 p-2">
          <Show
            when={local.file.changes().length}
            fallback={<div class="px-2 text-xs text-text-muted">No changes</div>}
          >
            <ul class="">
              <For each={local.file.changes()}>
                {(path) => (
                  <li>
                    <button
                      onClick={() => local.file.open(path, { view: "diff-unified", pinned: true })}
                      class="w-full flex items-center px-2 py-0.5 gap-x-2 text-text-muted grow min-w-0 cursor-pointer hover:bg-background-element"
                    >
                      <FileIcon node={{ path, type: "file" }} class="shrink-0 size-3" />
                      <span class="text-xs text-text whitespace-nowrap">{getFilename(path)}</span>
                      <span class="text-xs text-text-muted/60 whitespace-nowrap truncate min-w-0">
                        {getDirectory(path)}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <div class="hidden grow min-w-0">
          <EditorPane onFileClick={handleFileClick} />
        </div>
        <div class="absolute bottom-4 inset-x-0 p-2 flex flex-col justify-center items-center gap-2 z-50">
          <PromptForm
            class="w-xl"
            onSubmit={handlePromptSubmit}
            onOpenModelSelect={() => setStore("modelSelectOpen", true)}
            onInputRefChange={(element: HTMLTextAreaElement | undefined) => {
              inputRef = element ?? undefined
            }}
          />
        </div>
      </main>
      <Show when={store.modelSelectOpen}>
        <SelectDialog
          key={(x) => `${x.provider.id}:${x.id}`}
          items={local.model.list()}
          current={local.model.current()}
          render={(i) => (
            <div class="w-full flex items-center justify-between">
              <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                <img src={`https://models.dev/logos/${i.provider.id}.svg`} class="size-4 invert opacity-40" />
                <span class="text-xs text-text whitespace-nowrap">{i.name}</span>
                <span class="text-xs text-text-muted/80 whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                  {i.id}
                </span>
              </div>
              <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0">
                <Tooltip forceMount={false} value="Reasoning">
                  <Icon name="brain" size={16} classList={{ "text-accent": i.reasoning }} />
                </Tooltip>
                <Tooltip forceMount={false} value="Tools">
                  <Icon name="hammer" size={16} classList={{ "text-secondary": i.tool_call }} />
                </Tooltip>
                <Tooltip forceMount={false} value="Attachments">
                  <Icon name="photo" size={16} classList={{ "text-success": i.attachment }} />
                </Tooltip>
                <div class="rounded-full bg-text-muted/20 text-text-muted/80 w-9 h-4 flex items-center justify-center text-[10px]">
                  {new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    compactDisplay: "short",
                  }).format(i.limit.context)}
                </div>
                <Tooltip forceMount={false} value={`$${i.cost?.input}/1M input, $${i.cost?.output}/1M output`}>
                  <div class="rounded-full bg-success/20 text-success/80 w-9 h-4 flex items-center justify-center text-[10px]">
                    <Switch fallback="FREE">
                      <Match when={i.cost?.input > 10}>$$$</Match>
                      <Match when={i.cost?.input > 1}>$$</Match>
                      <Match when={i.cost?.input > 0.1}>$</Match>
                    </Switch>
                  </div>
                </Tooltip>
              </div>
            </div>
          )}
          filter={["provider.name", "name", "id"]}
          groupBy={(x) => x.provider.name}
          onClose={() => setStore("modelSelectOpen", false)}
          onSelect={(x) => local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined)}
        />
      </Show>
      <Show when={store.fileSelectOpen}>
        <SelectDialog
          items={local.file.search}
          key={(x) => x}
          render={(i) => (
            <div class="w-full flex items-center justify-between">
              <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                <span class="text-xs text-text whitespace-nowrap">{getFilename(i)}</span>
                <span class="text-xs text-text-muted/80 whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                  {getDirectory(i)}
                </span>
              </div>
              <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0"></div>
            </div>
          )}
          onClose={() => setStore("fileSelectOpen", false)}
          onSelect={(x) => (x ? local.context.openFile(x) : undefined)}
          // onSelect={(x) => (x ? local.file.open(x, { pinned: true }) : undefined)}
        />
      </Show>
    </div>
  )
}
