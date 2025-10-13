import { FileIcon, Icon, IconButton, Tooltip } from "@/ui"
import { Tabs } from "@/ui/tabs"
import FileTree from "@/components/file-tree"
import EditorPane from "@/components/editor-pane"
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { SelectDialog } from "@/components/select-dialog"
import { useLocal } from "@/context"
import { ResizeableLayout, ResizeablePane } from "@/components/resizeable-pane"
import type { LocalFile } from "@/context/local"
import SessionList from "@/components/session-list"
import SessionTimeline from "@/components/session-timeline"
import { createStore } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"

export default function Page() {
  const local = useLocal()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    modelSelectOpen: false,
    fileSelectOpen: false,
  })

  const layoutKey = "workspace"
  const timelinePane = "timeline"

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

  return (
    <div class="relative">
      <ResizeableLayout
        id={layoutKey}
        defaults={{
          explorer: { size: 24, visible: true },
          editor: { size: 56, visible: true },
          timeline: { size: 20, visible: false },
        }}
        class="h-screen"
      >
        <ResizeablePane
          id="explorer"
          minSize="150px"
          maxSize="300px"
          class="border-r border-border-subtle/30 bg-background z-10 overflow-hidden"
        >
          <Tabs class="relative flex flex-col h-full" defaultValue="files">
            <div class="sticky top-0 shrink-0 flex">
              <Tabs.List class="grow w-full after:hidden">
                <Tabs.Trigger value="files" class="flex-1 justify-center text-xs">
                  Files
                </Tabs.Trigger>
                <Tabs.Trigger value="changes" class="flex-1 justify-center text-xs">
                  Changes
                </Tabs.Trigger>
              </Tabs.List>
            </div>
            <Tabs.Content value="files" class="grow min-h-0 py-2 bg-background">
              <FileTree path="" onFileClick={handleFileClick} />
            </Tabs.Content>
            <Tabs.Content value="changes" class="grow min-h-0 py-2 bg-background">
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
            </Tabs.Content>
          </Tabs>
        </ResizeablePane>
        <ResizeablePane id="editor" minSize={30} maxSize={80} class="bg-background">
          <EditorPane
            layoutKey={layoutKey}
            timelinePane={timelinePane}
            onFileClick={handleFileClick}
            onOpenModelSelect={() => setStore("modelSelectOpen", true)}
            onInputRefChange={(element: HTMLTextAreaElement | null) => {
              inputRef = element ?? undefined
            }}
          />
        </ResizeablePane>
        <ResizeablePane
          id="timeline"
          minSize={20}
          maxSize={40}
          class="border-l border-border-subtle/30 bg-background z-10 overflow-hidden"
        >
          <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <Show when={local.session.active()} fallback={<SessionList />}>
              {(activeSession) => (
                <div class="relative">
                  <div class="sticky top-0 bg-background z-50 px-2 h-8 border-b border-border-subtle/30">
                    <div class="h-full flex items-center gap-2">
                      <IconButton
                        size="xs"
                        variant="ghost"
                        onClick={() => local.session.clearActive()}
                        class="text-text-muted hover:text-text"
                      >
                        <Icon name="arrow-left" size={14} />
                      </IconButton>
                      <h2 class="text-sm font-medium text-text truncate">
                        {activeSession().title || "Untitled Session"}
                      </h2>
                    </div>
                  </div>
                  <SessionTimeline session={activeSession().id} />
                </div>
              )}
            </Show>
          </div>
        </ResizeablePane>
      </ResizeableLayout>
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
          onSelect={(x) => (x ? local.file.open(x, { pinned: true }) : undefined)}
        />
      </Show>
    </div>
  )
}
