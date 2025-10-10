import { createSignal, For, Match, Show, Switch, onMount, onCleanup, createMemo } from "solid-js"
import { FileIcon, Logo } from "@/ui"
import { Tabs } from "@/ui/tabs"
import FileTree from "@/components/file-tree"
import SessionList from "@/components/session-list"
import SessionTimeline from "@/components/session-timeline"
import PromptForm from "@/components/prompt-form"
import SuggestionChips from "@/components/suggestion-chips"
import MobileNavigation, { type MobileTab } from "@/components/mobile-navigation"
import MobileHeader from "@/components/mobile-header"
import Drawer from "@/components/drawer"
import EditorPane from "@/components/editor-pane"
import { useLocal, useSync } from "@/context"
import type { LocalFile } from "@/context/local"
import { getDirectory, getFilename, createSwipeGesture, vibrate } from "@/utils"

interface MobileLayoutProps {
  layoutKey: string
  timelinePane: string
  onFileClick: (file: LocalFile) => void
  onPromptSubmit: (prompt: string) => Promise<void>
  onOpenModelSelect: () => void
  onOpenAgentSelect: () => void
}

export default function MobileLayout(props: MobileLayoutProps) {
  const local = useLocal()
  const sync = useSync()
  const [activeTab, setActiveTab] = createSignal<MobileTab>("editor")
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [keyboardHeight, setKeyboardHeight] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(typeof window !== "undefined" ? window.innerHeight : 0)

  const suggestions = createMemo(() => {
    const hasFiles = Object.keys(sync.data.node).length > 0
    if (!hasFiles) {
      return ["Open a folder to get started"]
    }

    const files = Object.keys(sync.data.node)
    const agentsMdFile = files.find((f) => f.endsWith("AGENTS.md") || f.endsWith("agents.md"))
    const hasAgentsMd = !!agentsMdFile
    const hasPackageJson = files.some((f) => f.endsWith("package.json"))
    const hasReadme = files.some((f) => f.toLowerCase().includes("readme"))

    const result = []

    if (!hasAgentsMd) {
      result.push("Create an AGENTS.md file")
    } else {
      result.push("Review AGENTS.md")
    }

    if (hasPackageJson) {
      result.push("What build commands are configured?")
    }

    if (hasReadme) {
      result.push("Summarize this project")
    }

    result.push("Show me all components")
    result.push("Create a new feature")
    result.push("Write tests")

    return result.slice(0, 6)
  })

  const handleSuggestion = async (suggestion: string) => {
    await props.onPromptSubmit(suggestion)
    setActiveTab("chat")
  }

  const handleSwipeLeft = () => {
    const tabs: MobileTab[] = ["files", "editor", "chat"]
    const currentIndex = tabs.indexOf(activeTab())
    if (currentIndex < tabs.length - 1) {
      vibrate(10)
      setActiveTab(tabs[currentIndex + 1])
    }
  }

  const handleSwipeRight = () => {
    const tabs: MobileTab[] = ["files", "editor", "chat"]
    const currentIndex = tabs.indexOf(activeTab())
    if (currentIndex > 0) {
      vibrate(10)
      setActiveTab(tabs[currentIndex - 1])
    }
  }

  let containerRef: HTMLDivElement | undefined

  onMount(() => {
    const handleResize = () => {
      const newHeight = window.innerHeight
      const heightDiff = viewportHeight() - newHeight
      if (heightDiff > 100) {
        setKeyboardHeight(heightDiff)
      } else {
        setKeyboardHeight(0)
      }
      setViewportHeight(newHeight)
    }

    const handleVisualViewportResize = () => {
      if (window.visualViewport) {
        const keyboardOffset = window.innerHeight - window.visualViewport.height
        setKeyboardHeight(keyboardOffset > 100 ? keyboardOffset : 0)
      }
    }

    window.addEventListener("resize", handleResize)
    window.visualViewport?.addEventListener("resize", handleVisualViewportResize)

    if (containerRef) {
      const cleanupSwipe = createSwipeGesture(containerRef, {
        onSwipeLeft: handleSwipeLeft,
        onSwipeRight: handleSwipeRight,
      })

      onCleanup(() => {
        cleanupSwipe()
      })
    }

    onCleanup(() => {
      window.removeEventListener("resize", handleResize)
      window.visualViewport?.removeEventListener("resize", handleVisualViewportResize)
    })
  })

  return (
    <div
      ref={containerRef}
      class="flex flex-col bg-background transition-all duration-200"
      style={{
        height: keyboardHeight() > 0 ? `calc(100vh - ${keyboardHeight()}px)` : "100vh",
        "padding-bottom": keyboardHeight() > 0 ? "0" : "calc(4rem + var(--safe-area-inset-bottom))",
        "touch-action": "pan-y",
      }}
    >
      <Switch>
        <Match when={activeTab() === "files"}>
          <MobileHeader title="Files" onMenuClick={() => setDrawerOpen(true)} />
          <div class="flex-1 overflow-y-auto">
            <Tabs class="relative flex flex-col h-full" defaultValue="files">
              <Tabs.List class="shrink-0 px-4 pt-2">
                <Tabs.Trigger value="files" class="flex-1">
                  Files
                </Tabs.Trigger>
                <Tabs.Trigger value="changes" class="flex-1">
                  Changes
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="files" class="flex-1 overflow-y-auto py-2">
                <FileTree path="" onFileClick={props.onFileClick} />
              </Tabs.Content>
              <Tabs.Content value="changes" class="flex-1 overflow-y-auto py-2">
                <Show
                  when={local.file.changes().length}
                  fallback={<div class="px-4 text-sm text-text-muted">No changes</div>}
                >
                  <ul>
                    <For each={local.file.changes()}>
                      {(path) => (
                        <li>
                          <button
                            onClick={() => local.file.open(path, { view: "diff-unified", pinned: true })}
                            class="w-full flex items-center px-4 py-2 gap-x-2 text-text-muted hover:bg-background-element min-h-[44px]"
                          >
                            <FileIcon node={{ path, type: "file" }} class="shrink-0 size-4" />
                            <span class="text-sm text-text whitespace-nowrap">{getFilename(path)}</span>
                            <span class="text-xs text-text-muted/60 truncate min-w-0">{getDirectory(path)}</span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Tabs.Content>
            </Tabs>
          </div>
        </Match>

        <Match when={activeTab() === "editor"}>
          <MobileHeader
            title={local.file.active() ? getFilename(local.file.active()!.path) : "Editor"}
            onMenuClick={() => setDrawerOpen(true)}
          />
          <div class="flex-1 overflow-hidden flex flex-col">
            <Show when={!local.file.active()}>
              <div class="flex-1 flex flex-col items-center justify-center px-6 pb-32">
                <div class="w-full max-w-md space-y-6">
                  <div class="text-center flex flex-col items-center">
                    <Logo size={48} variant="ornate" class="mb-6 opacity-40" />
                    <p class="text-sm text-text-muted">Start a conversation or open a file to begin</p>
                  </div>
                  <div class="w-full">
                    <PromptForm
                      onSubmit={props.onPromptSubmit}
                      onOpenModelSelect={props.onOpenModelSelect}
                      onOpenAgentSelect={props.onOpenAgentSelect}
                      docked={true}
                    />
                  </div>
                  <SuggestionChips suggestions={suggestions()} onSelect={handleSuggestion} />
                </div>
              </div>
            </Show>
            <Show when={local.file.active()}>
              <div class="flex-1 overflow-hidden">
                <EditorPane
                  layoutKey={props.layoutKey}
                  timelinePane={props.timelinePane}
                  onFileClick={props.onFileClick}
                  onOpenModelSelect={props.onOpenModelSelect}
                  onOpenAgentSelect={props.onOpenAgentSelect}
                  onInputRefChange={() => {}}
                  hideFloatingChat={true}
                />
              </div>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "chat"}>
          <Show
            when={local.session.active()}
            fallback={
              <>
                <MobileHeader title="Conversations" onMenuClick={() => setDrawerOpen(true)} />
                <div class="flex-1 overflow-y-auto">
                  <SessionList />
                </div>
              </>
            }
          >
            {(activeSession) => (
              <>
                <MobileHeader
                  title={activeSession().title || "Untitled Session"}
                  showBack
                  onBack={() => local.session.clearActive()}
                />
                <div class="flex-1 overflow-y-auto pb-64">
                  <SessionTimeline session={activeSession().id} />
                </div>
                <div
                  class="fixed left-0 right-0 px-4 pb-4 bg-gradient-to-t from-background via-background to-transparent pt-8 pointer-events-none transition-all duration-200"
                  style={{
                    bottom:
                      keyboardHeight() > 0 ? `${keyboardHeight()}px` : "calc(4rem + var(--safe-area-inset-bottom))",
                  }}
                >
                  <div class="pointer-events-auto">
                    <PromptForm
                      onSubmit={props.onPromptSubmit}
                      onOpenModelSelect={props.onOpenModelSelect}
                      onOpenAgentSelect={props.onOpenAgentSelect}
                      docked={true}
                    />
                  </div>
                </div>
              </>
            )}
          </Show>
        </Match>
      </Switch>

      <MobileNavigation
        activeTab={activeTab()}
        onTabChange={setActiveTab}
        hasActiveSession={!!local.session.active()}
      />

      <Drawer open={drawerOpen()} onClose={() => setDrawerOpen(false)} title="Settings" side="left">
        <div class="p-4 space-y-4">
          <div>
            <h3 class="text-sm font-medium text-text mb-2">Agent</h3>
            <button
              onClick={() => {
                props.onOpenAgentSelect()
                setDrawerOpen(false)
              }}
              class="w-full px-4 py-3 text-left bg-background-element rounded-lg text-sm min-h-[44px]"
            >
              {local.agent.current().name}
            </button>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text mb-2">Model</h3>
            <button
              onClick={() => {
                props.onOpenModelSelect()
                setDrawerOpen(false)
              }}
              class="w-full px-4 py-3 text-left bg-background-element rounded-lg text-sm min-h-[44px]"
            >
              <div>{local.model.current()?.name}</div>
              <div class="text-xs text-text-muted">{local.model.current()?.provider.name}</div>
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  )
}
