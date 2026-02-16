import { For, Show, createMemo } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis } from "@/utils/solid-dnd"
import { SortableTerminalTab } from "@/components/session"
import { Terminal } from "@/components/terminal"
import { useTerminal } from "@/context/terminal"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { terminalTabLabel } from "@/pages/session/terminal-label"

export function TerminalPanel(props: {
  open: boolean
  height: number
  resize: (value: number) => void
  close: () => void
  terminal: ReturnType<typeof useTerminal>
  language: ReturnType<typeof useLanguage>
  command: ReturnType<typeof useCommand>
  handoff: () => string[]
  activeTerminalDraggable: () => string | undefined
  handleTerminalDragStart: (event: unknown) => void
  handleTerminalDragOver: (event: DragEvent) => void
  handleTerminalDragEnd: () => void
  onCloseTab: () => void
}) {
  const all = createMemo(() => props.terminal.all())
  const ids = createMemo(() => all().map((pty) => pty.id))
  const byId = createMemo(() => new Map(all().map((pty) => [pty.id, pty])))

  return (
    <Show when={props.open}>
      <div
        id="terminal-panel"
        role="region"
        aria-label={props.language.t("terminal.title")}
        class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
        style={{ height: `${props.height}px` }}
      >
        <ResizeHandle
          direction="vertical"
          size={props.height}
          min={100}
          max={typeof window === "undefined" ? 1000 : window.innerHeight * 0.6}
          collapseThreshold={50}
          onResize={props.resize}
          onCollapse={props.close}
        />
        <Show
          when={props.terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
              <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weak-base bg-background-stronger overflow-hidden">
                <For each={props.handoff()}>
                  {(title) => (
                    <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                      {title}
                    </div>
                  )}
                </For>
                <div class="flex-1" />
                <div class="text-text-weak pr-2">
                  {props.language.t("common.loading")}
                  {props.language.t("common.loading.ellipsis")}
                </div>
              </div>
              <div class="flex-1 flex items-center justify-center text-text-weak">
                {props.language.t("terminal.loading")}
              </div>
            </div>
          }
        >
          <DragDropProvider
            onDragStart={props.handleTerminalDragStart}
            onDragEnd={props.handleTerminalDragEnd}
            onDragOver={props.handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <div class="flex flex-col h-full">
              <Tabs
                variant="alt"
                value={props.terminal.active()}
                onChange={(id) => props.terminal.open(id)}
                class="!h-auto !flex-none"
              >
                <Tabs.List class="h-10">
                  <SortableProvider ids={ids()}>
                    <For each={all()}>
                      {(pty) => (
                        <SortableTerminalTab
                          terminal={pty}
                          onClose={() => {
                            props.close()
                            props.onCloseTab()
                          }}
                        />
                      )}
                    </For>
                  </SortableProvider>
                  <div class="h-full flex items-center justify-center">
                    <TooltipKeybind
                      title={props.language.t("command.terminal.new")}
                      keybind={props.command.keybind("terminal.new")}
                      class="flex items-center"
                    >
                      <IconButton
                        icon="plus-small"
                        variant="ghost"
                        iconSize="large"
                        onClick={props.terminal.new}
                        aria-label={props.language.t("command.terminal.new")}
                      />
                    </TooltipKeybind>
                  </div>
                </Tabs.List>
              </Tabs>
              <div class="flex-1 min-h-0 relative">
                <For each={all()}>
                  {(pty) => (
                    <div
                      id={`terminal-wrapper-${pty.id}`}
                      class="absolute inset-0"
                      style={{
                        display: props.terminal.active() === pty.id ? "block" : "none",
                      }}
                    >
                      <Show when={pty.id} keyed>
                        <Terminal
                          pty={pty}
                          onCleanup={props.terminal.update}
                          onConnectError={() => props.terminal.clone(pty.id)}
                        />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
            <DragOverlay>
              <Show when={props.activeTerminalDraggable()}>
                {(draggedId) => {
                  return (
                    <Show when={byId().get(draggedId())}>
                      {(t) => (
                        <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                          {terminalTabLabel({
                            title: t().title,
                            titleNumber: t().titleNumber,
                            t: props.language.t as (
                              key: string,
                              vars?: Record<string, string | number | boolean>,
                            ) => string,
                          })}
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </Show>
  )
}
