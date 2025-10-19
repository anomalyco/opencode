import { FileIcon, Icon, IconButton, Tabs, Tooltip } from "@/ui"
import * as KobalteTabs from "@kobalte/core/tabs"
import FileTree from "@/components/file-tree"
import EditorPane from "@/components/editor-pane"
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { SelectDialog } from "@/components/select-dialog"
import { useLocal, useTheme, useSDK, useSync, useMobile } from "@/context"
import { themes, type FontSize } from "@/context/theme"
import { ResizeableLayout, ResizeablePane } from "@/components/resizeable-pane"
import type { LocalFile } from "@/context/local"
import SessionList from "@/components/session-list"
import SessionTimeline from "@/components/session-timeline"
import PromptForm from "@/components/prompt-form"
import StatusBar from "@/components/status-bar"
import { createStore } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"
import MobileLayout from "@/components/mobile-layout"

export default function Page() {
  const local = useLocal()
  const theme = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const mobile = useMobile()

  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    modelSelectOpen: false,
    agentSelectOpen: false,
    fileSelectOpen: false,
    commandPaletteOpen: false,
    commandPaletteView: "main" as "main" | "theme" | "fontSize" | "fontSizeArea",
    fontSizeArea: undefined as "explorer" | "editor" | "timeline" | "conversation" | undefined,
    dragProximity: { isDragging: false, nearDockZone: false, x: 0, y: 0 },
  })

  const hasWorkspace = () => {
    const dir = sync.data.path.directory
    const nodeCount = sync.data.node.length

    console.log("=== hasWorkspace CHECK ===")
    console.log("Directory:", dir)
    console.log("Node count:", nodeCount)
    console.log("Query params:", window.location.search)

    if (!dir || dir.length === 0) {
      console.log("REJECTED: No directory")
      return false
    }

    if (dir === "/" || dir === "~" || dir === ".") {
      console.log("REJECTED: Root/home/current directory")
      return false
    }

    if (
      dir.startsWith("/System") ||
      dir.startsWith("/usr") ||
      dir.startsWith("/bin") ||
      dir.startsWith("/sbin") ||
      dir.startsWith("/private")
    ) {
      console.log("REJECTED: System directory")
      return false
    }

    if (sync.data.node.length === 0) {
      console.log("REJECTED: No files loaded")
      return false
    }

    if (!dir.startsWith("/Users/") && !dir.startsWith("/home/")) {
      console.log("REJECTED: Not in user directory")
      return false
    }

    console.log("ACCEPTED: Valid workspace")
    return true
  }

  const handleOpenFolder = async () => {
    if (typeof window !== "undefined" && "__TAURI__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const folderPath = await invoke<string>("select_folder")
        if (folderPath) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          await sync.load.path()
          await sync.load.node()
          window.location.reload()
        }
      } catch (err) {
        console.error("Error selecting folder:", err)
      }
    }
  }

  const handleFolderDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (typeof window !== "undefined" && "__TAURI__" in window) {
      const files = e.dataTransfer?.files

      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as any

          if (file.path) {
            try {
              const { invoke } = await import("@tauri-apps/api/core")
              await invoke<string>("select_folder")
              await new Promise((resolve) => setTimeout(resolve, 500))
              await sync.load.path()
              await sync.load.node()
              window.location.reload()
            } catch (err) {
              console.error("Error loading folder:", err)
            }
            return
          }
        }
      }
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  let previewTimer: number | undefined

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
    if (event.getModifierState(MOD) && event.key === ",") {
      event.preventDefault()
      setStore("commandPaletteOpen", true)
      setStore("commandPaletteView", "main")
      return
    }
    if (event.getModifierState(MOD) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault()
      setStore("commandPaletteOpen", true)
      setStore("commandPaletteView", "main")
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

  const handleDragProximity = (proximity: { isDragging: boolean; nearDockZone: boolean; x: number; y: number }) => {
    setStore("dragProximity", proximity)
  }

  const handleDrop = () => {
    console.log("[handleDrop] Called! Timeline visible:", local.layout.visible(layoutKey, timelinePane))
    if (local.layout.visible(layoutKey, timelinePane)) {
      console.log("[handleDrop] Docking chat now!")
      local.session.dockChat()
    }
  }

  const handleDockChat = () => {
    local.session.dockChat()
  }

  const handlePromptSubmit = async (prompt: string) => {
    const existingSession = local.layout.visible(layoutKey, timelinePane) ? local.session.active() : undefined
    let session = existingSession
    if (!session) {
      const created = await sdk.session.create()
      session = created.data ?? undefined
    }
    if (!session) return
    local.session.setActive(session.id)
    local.layout.show(layoutKey, timelinePane)

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
            text: prompt,
          },
          ...(local.context.active()
            ? [
                {
                  type: "file" as const,
                  mime: "text/plain",
                  url: `file://${local.context.active()!.absolute}`,
                  filename: local.context.active()!.name,
                  source: {
                    type: "file" as const,
                    text: {
                      value: "@" + local.context.active()!.name,
                      start: 0,
                      end: 0,
                    },
                    path: local.context.active()!.absolute,
                  },
                },
              ]
            : []),
          ...local.context.all().flatMap((file) => [
            {
              type: "file" as const,
              mime: "text/plain",
              url: `file://${sync.absolute(file.path)}${file.selection ? `?start=${file.selection.startLine}&end=${file.selection.endLine}` : ""}`,
              filename: getFilename(file.path),
              source: {
                type: "file" as const,
                text: {
                  value: "@" + getFilename(file.path),
                  start: 0,
                  end: 0,
                },
                path: sync.absolute(file.path),
              },
            },
          ]),
        ],
      },
    })
  }

  return (
    <Show
      when={hasWorkspace()}
      fallback={
        <div
          class="flex items-center justify-center h-screen bg-background text-text"
          onDrop={handleFolderDrop}
          onDragOver={handleDragOver}
        >
          <div class="text-center space-y-8">
            <div class="space-y-6">
              <svg
                width="120"
                height="120"
                viewBox="0 0 600 600"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                class="mx-auto"
              >
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M115 180H300V420H115V180ZM253.75 229.044H161.25V370.405H253.75V229.044Z"
                  fill="currentColor"
                />
                <path d="M346.25 180H485V229.044H392.5V370.405H485V419.449H346.25V180Z" fill="currentColor" />
              </svg>
              <div>
                <Icon name="folder-search" size={64} class="mx-auto text-text-muted/50 mb-4" />
                <h1 class="text-2xl font-medium mb-2">No Folder Open</h1>
                <p class="text-text-muted">Open a folder to start using OpenCode</p>
              </div>
            </div>
            <button
              onClick={handleOpenFolder}
              class="px-6 py-3 bg-primary text-background-panel rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              Open Folder
            </button>
            <p class="text-sm text-text-muted">or drag a folder here</p>
          </div>
        </div>
      }
    >
      <Show
        when={!mobile.isMobile}
        fallback={
          <MobileLayout
            layoutKey={layoutKey}
            timelinePane={timelinePane}
            onFileClick={handleFileClick}
            onPromptSubmit={handlePromptSubmit}
            onOpenModelSelect={() => setStore("modelSelectOpen", true)}
            onOpenAgentSelect={() => setStore("agentSelectOpen", true)}
          />
        }
      >
        <div class="relative flex flex-col h-screen">
          <ResizeableLayout
            id={layoutKey}
            defaults={{
              explorer: { size: 24, visible: true },
              editor: { size: 56, visible: true },
              timeline: { size: 20, visible: false },
            }}
            class="flex-1 min-h-0"
          >
            <ResizeablePane
              id="explorer"
              minSize="150px"
              maxSize="300px"
              class="border-r border-border-subtle/30 bg-background z-10 overflow-hidden font-explorer"
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
                  <div class="shrink-0 h-full flex items-center px-1 border-b border-border-subtle/40">
                    <Tooltip value="Settings (Cmd/Ctrl+,)" placement="bottom">
                      <IconButton
                        onClick={() => {
                          setStore("commandPaletteOpen", true)
                          setStore("commandPaletteView", "main")
                        }}
                        size="xs"
                        variant="ghost"
                      >
                        <Icon name="settings" size={24} />
                      </IconButton>
                    </Tooltip>
                  </div>
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
            <ResizeablePane id="editor" minSize={30} maxSize={80} class="bg-background font-editor">
              <EditorPane
                layoutKey={layoutKey}
                timelinePane={timelinePane}
                onFileClick={handleFileClick}
                onOpenModelSelect={() => setStore("modelSelectOpen", true)}
                onOpenAgentSelect={() => setStore("agentSelectOpen", true)}
                onInputRefChange={(element: HTMLTextAreaElement | null) => {
                  inputRef = element ?? undefined
                }}
                onPromptSubmit={handlePromptSubmit}
                onDragProximity={handleDragProximity}
                onDrop={handleDrop}
                hideFloatingChat={local.session.chatDocked()}
              />
            </ResizeablePane>
            <ResizeablePane
              id="timeline"
              minSize={20}
              maxSize={40}
              class="border-l border-border-subtle/30 bg-background z-10 overflow-hidden"
            >
              <Show when={local.session.active()} fallback={<SessionList />}>
                {(activeSession) => (
                  <div class="relative h-full flex flex-col">
                    <div class="sticky top-0 bg-background z-50 px-2 h-8 border-b border-border-subtle/30 shrink-0">
                      <div class="h-full flex items-center gap-2">
                        <IconButton
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            local.session.clearActive()
                          }}
                          class="text-text-muted hover:text-text"
                        >
                          <Icon name="arrow-left" size={21} />
                        </IconButton>
                        <h2 class="text-sm font-medium text-text truncate">
                          {activeSession().title || "Untitled Session"}
                        </h2>
                        <Show when={local.session.chatDocked()}>
                          <IconButton
                            size="xs"
                            variant="ghost"
                            onClick={() => local.session.undockChat()}
                            class="text-text-muted hover:text-text ml-auto"
                            title="Undock chat"
                          >
                            <Icon name="close-pane" size={21} />
                          </IconButton>
                        </Show>
                      </div>
                    </div>
                    <div class="flex-1 overflow-y-auto overflow-x-hidden relative min-h-0">
                      <SessionTimeline
                        session={activeSession().id}
                        showDockZone={store.dragProximity.isDragging && store.dragProximity.nearDockZone}
                        onDockChat={handleDockChat}
                      />
                    </div>
                    <Show when={local.session.chatDocked()}>
                      <div class="shrink-0 bg-background">
                        <div
                          class="pt-2 pb-1 px-3 cursor-grab active:cursor-grabbing hover:bg-primary/10 transition-colors"
                          onMouseDown={(e) => {
                            console.log("[Drag handle] Mouse down")
                            e.preventDefault()
                            const startY = e.clientY
                            let hasMoved = false

                            const handleMove = (moveEvent: MouseEvent) => {
                              const deltaY = startY - moveEvent.clientY
                              console.log("[Drag handle] Delta Y:", deltaY)
                              if (Math.abs(deltaY) > 10) {
                                hasMoved = true
                              }
                              if (hasMoved && deltaY > 30) {
                                console.log("[Drag handle] Undocking chat - dragged up")
                                local.session.undockChat()
                                document.removeEventListener("mousemove", handleMove)
                                document.removeEventListener("mouseup", handleUp)
                              }
                            }

                            const handleUp = () => {
                              console.log("[Drag handle] Mouse up")
                              document.removeEventListener("mousemove", handleMove)
                              document.removeEventListener("mouseup", handleUp)
                            }

                            document.addEventListener("mousemove", handleMove)
                            document.addEventListener("mouseup", handleUp)
                          }}
                        >
                          <div class="w-16 h-1 bg-text-muted/30 rounded-full mx-auto" />
                        </div>
                        <div class="px-3 pb-3">
                          <PromptForm
                            onSubmit={handlePromptSubmit}
                            onOpenModelSelect={() => setStore("modelSelectOpen", true)}
                            onOpenAgentSelect={() => setStore("agentSelectOpen", true)}
                            docked={true}
                          />
                        </div>
                      </div>
                    </Show>
                    <Show when={store.dragProximity.isDragging && store.dragProximity.nearDockZone}>
                      <div class="absolute bottom-0 left-0 right-0 h-40 bg-primary/10 border-t-4 border-primary border-dashed flex items-center justify-center backdrop-blur-sm z-40 pointer-events-none">
                        <div class="text-primary text-base font-semibold flex items-center gap-3 animate-pulse">
                          <Icon name="arrow-down" size={28} />
                          Drop to dock chat here
                          <Icon name="arrow-down" size={28} />
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            </ResizeablePane>
          </ResizeableLayout>
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

          <Show when={store.commandPaletteOpen && store.commandPaletteView === "main"}>
            <SelectDialog<{ id: string; name: string; description: string; action: string }>
              items={[
                { id: "theme", name: "Preferences: Color Theme", description: "Change color theme", action: "theme" },
                { id: "fontSize", name: "Preferences: Font Size", description: "Change font size", action: "fontSize" },
              ]}
              key={(x) => x.id}
              placeholder="Type a command..."
              keepOpen={true}
              render={(i) => (
                <div class="w-full flex flex-col gap-y-1">
                  <div class="text-xs text-text">{i.name}</div>
                  <div class="text-xs text-text-muted/60">{i.description}</div>
                </div>
              )}
              filter={["name", "description"]}
              onClose={() => {
                setStore("commandPaletteOpen", false)
              }}
              onSelect={(item) => {
                if (item?.action === "theme") {
                  setStore("commandPaletteView", "theme")
                } else if (item?.action === "fontSize") {
                  setStore("commandPaletteView", "fontSize")
                }
              }}
            />
          </Show>

          <Show when={store.commandPaletteOpen && store.commandPaletteView === "theme"}>
            <SelectDialog<{ id: string; name: string; value: string; themeName: string; isDark: boolean }>
              items={[
                ...themes.map((t) => ({
                  id: `theme-${t}-light`,
                  name: t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " "),
                  value: "Light",
                  themeName: t,
                  isDark: false,
                })),
                ...themes.map((t) => ({
                  id: `theme-${t}-dark`,
                  name: t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " "),
                  value: "Dark",
                  themeName: t,
                  isDark: true,
                })),
              ]}
              key={(x) => x.id}
              placeholder="Select theme..."
              reduceBlur={true}
              groupBy={(x) => x.value}
              onBack={() => {
                theme.clearPreview()
                setStore("commandPaletteView", "main")
              }}
              render={(i) => {
                const isActive = i.themeName === theme.theme && i.isDark === theme.isDark
                return (
                  <div
                    class="w-full flex items-center justify-between"
                    onMouseEnter={() => {
                      if (previewTimer) clearTimeout(previewTimer)
                      theme.previewTheme(i.themeName, i.isDark)
                    }}
                    onMouseLeave={() => {
                      if (previewTimer) clearTimeout(previewTimer)
                      previewTimer = window.setTimeout(() => theme.clearPreview(), 100)
                    }}
                  >
                    <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                      <span class="text-xs text-text whitespace-nowrap">{i.name}</span>
                      {isActive && <Icon name="checkmark" size={24} class="text-primary shrink-0" />}
                    </div>
                  </div>
                )
              }}
              filter={["name"]}
              onClose={() => {
                theme.clearPreview()
                setStore("commandPaletteOpen", false)
              }}
              onSelect={(item) => {
                if (item) {
                  theme.setTheme(item.themeName)
                  theme.setDarkMode(item.isDark)
                }
                setStore("commandPaletteOpen", false)
              }}
            />
          </Show>

          <Show when={store.commandPaletteOpen && store.commandPaletteView === "fontSize"}>
            <SelectDialog<{
              id: string
              name: string
              description: string
              area: "explorer" | "editor" | "timeline" | "conversation"
            }>
              items={[
                {
                  id: "area-explorer",
                  name: "File Explorer",
                  description: "File & folder list",
                  area: "explorer" as const,
                },
                { id: "area-editor", name: "Editor", description: "Code editor pane", area: "editor" as const },
                { id: "area-timeline", name: "Timeline", description: "Session timeline", area: "timeline" as const },
                {
                  id: "area-conversation",
                  name: "Conversation",
                  description: "Chat messages",
                  area: "conversation" as const,
                },
              ]}
              key={(x) => x.id}
              placeholder="Select area..."
              onBack={() => setStore("commandPaletteView", "main")}
              keepOpen={true}
              render={(i) => (
                <div class="w-full flex flex-col gap-y-1">
                  <div class="text-xs text-text">{i.name}</div>
                  <div class="text-xs text-text-muted/60">{i.description}</div>
                </div>
              )}
              filter={["name", "description"]}
              onClose={() => setStore("commandPaletteOpen", false)}
              onSelect={(item) => {
                if (item) {
                  setStore("fontSizeArea", item.area)
                  setStore("commandPaletteView", "fontSizeArea")
                }
              }}
            />
          </Show>

          <Show when={store.commandPaletteOpen && store.commandPaletteView === "fontSizeArea"}>
            <SelectDialog<{ id: string; name: string; fontSize: FontSize }>
              items={[
                { id: "font-smallest", name: "Smallest", fontSize: "smallest" },
                { id: "font-small", name: "Small", fontSize: "small" },
                { id: "font-default", name: "Default", fontSize: "default" },
                { id: "font-large", name: "Large", fontSize: "large" },
                { id: "font-largest", name: "Largest", fontSize: "largest" },
              ]}
              key={(x) => x.id}
              placeholder="Select font size..."
              onBack={() => setStore("commandPaletteView", "fontSize")}
              render={(i) => {
                const isActive = store.fontSizeArea && i.fontSize === theme.fontSizes[store.fontSizeArea]
                return (
                  <div class="w-full flex items-center justify-between">
                    <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                      <span class="text-xs text-text whitespace-nowrap">{i.name}</span>
                      {isActive && <Icon name="checkmark" size={24} class="text-primary shrink-0" />}
                    </div>
                  </div>
                )
              }}
              filter={["name"]}
              onClose={() => setStore("commandPaletteOpen", false)}
              onSelect={(item) => {
                if (item && store.fontSizeArea) {
                  theme.setAreaFontSize(store.fontSizeArea, item.fontSize)
                }
                setStore("commandPaletteOpen", false)
              }}
            />
          </Show>
          <StatusBar />
        </div>
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
        <Show when={store.agentSelectOpen}>
          <SelectDialog
            key={(x) => x.name}
            items={local.agent.list()}
            current={local.agent.current()}
            render={(i) => (
              <div class="w-full flex items-center justify-between">
                <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                  <Icon name="command" size={16} class="text-text-muted" />
                  <span class="text-xs text-text whitespace-nowrap uppercase">{i.name}</span>
                </div>
              </div>
            )}
            filter={["name"]}
            placeholder="Select agent..."
            onClose={() => setStore("agentSelectOpen", false)}
            onSelect={(x) => x && local.agent.set(x.name)}
          />
        </Show>
      </Show>
    </Show>
  )
}
