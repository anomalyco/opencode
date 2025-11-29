import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  useContext,
  type Component,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@opencode-ai/sdk"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { PatchTool } from "@/tool/patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import { useKeyboard, useRenderer, useTerminalDimensions, type BoxProps, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { iife } from "@/util/iife"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogTimeline } from "./dialog-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"

addDefaultParsers(parsers.parsers)

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => sync.data.permission[route.sessionID] ?? [])

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = createSignal(kv.get("thinking_visibility", true))
  const [showTimestamps, setShowTimestamps] = createSignal(kv.get("timestamps", "hide") === "show")
  const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebar() === "show") return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(process.platform === "win32" ? 3 : 1)
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch(() => {
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  // Auto-navigate to whichever session currently needs permission input
  createEffect(() => {
    const currentSession = session()
    if (!currentSession) return
    const currentPermissions = permissions()
    let targetID = currentPermissions.length > 0 ? currentSession.id : undefined

    if (!targetID) {
      const child = sync.data.session.find(
        (x) => x.parentID === currentSession.id && (sync.data.permission[x.id]?.length ?? 0) > 0,
      )
      if (child) targetID = child.id
    }

    if (targetID && targetID !== currentSession.id) {
      navigate({
        type: "session",
        sessionID: targetID,
      })
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    const first = permissions()[0]
    if (first) {
      const response = iife(() => {
        if (evt.ctrl || evt.meta) return
        if (evt.name === "return") return "once"
        if (evt.name === "a") return "always"
        if (evt.name === "d") return "reject"
        if (evt.name === "escape") return "reject"
        return
      })
      if (response) {
        sdk.client.postSessionIdPermissionsPermissionId({
          path: {
            permissionID: first.id,
            id: route.sessionID,
          },
          body: {
            response: response,
          },
        })
      }
    }
  })

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  function moveChild(direction: number) {
    const parentID = session()?.parentID ?? session()?.id
    let children = sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((b, a) => a.id.localeCompare(b.id))
    if (children.length === 1) return
    let next = children.findIndex((x) => x.id === session()?.id) + direction
    if (next >= children.length) next = 0
    if (next < 0) next = children.length - 1
    if (children[next]) {
      navigate({
        type: "session",
        sessionID: children[next].id,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      onSelect: (dialog) => {
        sdk.client.session.summarize({
          path: {
            id: route.sessionID,
          },
          body: {
            modelID: local.model.current().modelID,
            providerID: local.model.current().providerID,
          },
        })
        dialog.clear()
      },
    },
    ...(sync.data.config.share !== "disabled"
      ? [
          {
            title: "Share session",
            value: "session.share",
            keybind: "session_share" as const,
            disabled: !!session()?.share?.url,
            category: "Session",
            onSelect: async (dialog: any) => {
              await sdk.client.session
                .share({
                  path: {
                    id: route.sessionID,
                  },
                })
                .then((res) =>
                  Clipboard.copy(res.data!.share!.url).catch(() =>
                    toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
                  ),
                )
                .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
                .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
              dialog.clear()
            },
          },
        ]
      : []),
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      disabled: !session()?.share?.url,
      category: "Session",
      onSelect: (dialog) => {
        sdk.client.session.unshare({
          path: {
            id: route.sessionID,
          },
        })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      onSelect: async (dialog) => {
        const status = sync.data.session_status[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ path: { id: route.sessionID } }).catch(() => {})
        const revert = session().revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            path: {
              id: route.sessionID,
            },
            body: {
              messageID: message.id,
            },
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      disabled: !session()?.revert?.messageID,
      category: "Session",
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session().revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            path: {
              id: route.sessionID,
            },
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          path: {
            id: route.sessionID,
          },
          body: {
            messageID: message.id,
          },
        })
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setSidebar((prev) => {
          if (prev === "auto") return sidebarVisible() ? "hide" : "show"
          if (prev === "show") return "hide"
          return "show"
        })
        if (sidebar() === "show") kv.set("sidebar", "auto")
        if (sidebar() === "hide") kv.set("sidebar", "hide")
        dialog.clear()
      },
    },
    {
      title: "Toggle code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      onSelect: (dialog) => {
        setShowTimestamps((prev) => {
          const next = !prev
          kv.set("timestamps", next ? "show" : "hide")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      category: "Session",
      onSelect: (dialog) => {
        setShowThinking((prev) => {
          const next = !prev
          kv.set("thinking_visibility", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle diff wrapping",
      value: "session.toggle.diffwrap",
      category: "Session",
      onSelect: (dialog) => {
        setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const lastAssistantMessage = messages().findLast((msg) => msg.role === "assistant")
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      keybind: "session_copy",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          const sessionMessages = messages()

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Copy to clipboard
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript to file",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          const sessionMessages = messages()

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Prompt for optional filename
          const customFilename = await DialogPrompt.show(dialog, "Export filename", {
            value: `session-${sessionData.id.slice(0, 8)}.md`,
          })

          // Cancel if user pressed escape
          if (customFilename === null) return

          // Save to file in current working directory
          const exportDir = process.cwd()
          const filename = customFilename.trim()
          const filepath = path.join(exportDir, filename)

          await Bun.write(filepath, transcript)

          // Open with EDITOR if available
          const result = await Editor.open({ value: transcript, renderer })
          if (result !== undefined) {
            // User edited the file, save the changes
            await Bun.write(filepath, result)
          }

          toast.show({ message: `Session exported to ${filename}`, variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch (error) {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        conceal,
        showThinking,
        showTimestamps,
        diffWrapMode,
        sync,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <Show when={!sidebarVisible()}>
              <Header />
            </Show>
            <scrollbox
              ref={(r) => (scroll = r)}
              scrollbarOptions={{
                paddingLeft: 2,
                visible: false,
                trackOptions: {
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.border,
                },
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    <Match when={message.id === revert()?.messageID}>
                      {(function () {
                        const command = useCommandDialog()
                        const [hover, setHover] = createSignal(false)
                        const dialog = useDialog()

                        const handleUnrevert = async () => {
                          const confirmed = await DialogConfirm.show(
                            dialog,
                            "Confirm Redo",
                            "Are you sure you want to restore the reverted messages?",
                          )
                          if (confirmed) {
                            command.trigger("session.redo")
                          }
                        }

                        return (
                          <box
                            onMouseOver={() => setHover(true)}
                            onMouseOut={() => setHover(false)}
                            onMouseUp={handleUnrevert}
                            marginTop={1}
                            flexShrink={0}
                            border={["left"]}
                            customBorderChars={SplitBorder.customBorderChars}
                            borderColor={theme.backgroundPanel}
                          >
                            <box
                              paddingTop={1}
                              paddingBottom={1}
                              paddingLeft={2}
                              backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                            >
                              <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                        </Show>
                                      </text>
                                    )}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </box>
                        )
                      })()}
                    </Match>
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={message.id}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
            </scrollbox>
            <box flexShrink={0}>
              <Prompt
                ref={(r) => (prompt = r)}
                disabled={permissions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
            <Show when={!sidebarVisible()}>
              <Footer />
            </Show>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Sidebar sessionID={route.sessionID} />
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : theme.secondary))

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text fg={theme.text}>{text()?.text}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={1} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <text fg={theme.textMuted}>
              {sync.data.config.username ?? "You"}{" "}
              <Show
                when={queued()}
                fallback={
                  <span style={{ fg: theme.textMuted }}>
                    {ctx.showTimestamps()
                      ? Locale.todayTimeOrDateTime(props.message.time.created)
                      : Locale.time(props.message.time.created)}
                  </span>
                }
              >
                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>
              </Show>
            </text>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final()}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span style={{ fg: local.agent.color(props.message.mode) }}>▣ </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => props.part.text.trim())
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={syntax()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const sync = useSync()
  const [margin, setMargin] = createSignal(0)
  const component = createMemo(() => {
    const render = ToolRegistry.render(props.part.tool) ?? GenericTool

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.input ?? {}
    const container = ToolRegistry.container(props.part.tool)
    const permissions = sync.data.permission[props.message.sessionID] ?? []
    const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
    const permission = permissions[permissionIndex]

    const style: BoxProps =
      container === "block" || permission
        ? {
            border: permissionIndex === 0 ? (["left", "right"] as const) : (["left"] as const),
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 2,
            marginTop: 1,
            gap: 1,
            backgroundColor: theme.backgroundPanel,
            customBorderChars: SplitBorder.customBorderChars,
            borderColor: permissionIndex === 0 ? theme.warning : theme.background,
          }
        : {
            paddingLeft: 3,
          }

    return (
      <box
        marginTop={margin()}
        {...style}
        renderBefore={function () {
          const el = this as BoxRenderable
          const parent = el.parent
          if (!parent) {
            return
          }
          if (el.height > 1) {
            setMargin(1)
            return
          }
          const children = parent.getChildren()
          const index = children.indexOf(el)
          const previous = children[index - 1]
          if (!previous) {
            setMargin(0)
            return
          }
          if (previous.height > 1 || previous.id.startsWith("text-")) {
            setMargin(1)
            return
          }
        }}
      >
        <Dynamic
          component={render}
          input={input}
          tool={props.part.tool}
          metadata={metadata}
          permission={permission?.metadata ?? {}}
          output={props.part.state.status === "completed" ? props.part.state.output : undefined}
        />
        {props.part.state.status === "error" && (
          <box paddingLeft={2}>
            <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
          </box>
        )}
        {permission && (
          <box gap={1}>
            <text fg={theme.text}>Permission required to run this tool:</text>
            <box flexDirection="row" gap={2}>
              <text>
                <b>enter</b>
                <span style={{ fg: theme.textMuted }}> accept</span>
              </text>
              <text>
                <b>a</b>
                <span style={{ fg: theme.textMuted }}> accept always</span>
              </text>
              <text>
                <b>d</b>
                <span style={{ fg: theme.textMuted }}> deny</span>
              </text>
            </box>
          </box>
        )}
      </box>
    )
  })

  return <Show when={component()}>{component()}</Show>
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
}
function GenericTool(props: ToolProps<any>) {
  return (
    <ToolTitle icon="⚙" fallback="Writing command..." when={true}>
      {props.tool} {input(props.input)}
    </ToolTitle>
  )
}

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container: "inline" | "block"
  render?: Component<ToolProps<T>>
}
const ToolRegistry = (() => {
  const state: Record<string, ToolRegistration> = {}
  function register<T extends Tool.Info>(input: ToolRegistration<T>) {
    state[input.name] = input
    return input
  }
  return {
    register,
    container(name: string) {
      return state[name]?.container
    },
    render(name: string) {
      return state[name]?.render
    },
  }
})()

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

ToolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle icon="#" fallback="Writing command..." when={props.input.command}>
          {props.input.description || "Shell"}
        </ToolTitle>
        <Show when={props.input.command}>
          <text fg={theme.text}>$ {props.input.command}</text>
        </Show>
        <Show when={output()}>
          <box>
            <text fg={theme.text}>{output()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "inline",
  render(props) {
    return (
      <>
        <ToolTitle icon="→" fallback="Reading file..." when={props.input.filePath}>
          Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const code = createMemo(() => {
      if (!props.input.content) return ""
      return props.input.content
    })

    const diagnostics = createMemo(() => props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? [])

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing write..." when={props.input.filePath}>
          Wrote {props.input.filePath}
        </ToolTitle>
        <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
          <code fg={theme.text} filetype={filetype(props.input.filePath!)} syntaxStyle={syntax()} content={code()} />
        </line_number>
        <Show when={diagnostics().length}>
          <For each={diagnostics()}>
            {(diagnostic) => (
              <text fg={theme.error}>
                Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
              </text>
            )}
          </For>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    return (
      <>
        <ToolTitle icon="✱" fallback="Finding files..." when={props.input.pattern}>
          Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
          <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="✱" fallback="Searching content..." when={props.input.pattern}>
        Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
        <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    return (
      <>
        <ToolTitle icon="→" fallback="Listing directory..." when={props.input.path !== undefined}>
          List {dir()}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()

    return (
      <>
        <ToolTitle icon="◉" fallback="Delegating..." when={props.input.subagent_type ?? props.input.description}>
          {Locale.titlecase(props.input.subagent_type ?? "unknown")} Task "{props.input.description}"
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task) => (
                <text style={{ fg: theme.textMuted }}>
                  ∟ {Locale.titlecase(task.tool)} {task.state.status === "completed" ? task.state.title : ""}
                </text>
              )}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {keybind.print("session_child_cycle")}, {keybind.print("session_child_cycle_reverse")}
          <span style={{ fg: theme.textMuted }}> to navigate between subagent sessions</span>
        </text>
      </>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    return (
      <ToolTitle icon="%" fallback="Fetching from the web..." when={(props.input as any).url}>
        WebFetch {(props.input as any).url}
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
      <ToolTitle icon="◇" fallback="Searching code..." when={input.query}>
        Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
      <ToolTitle icon="◈" fallback="Searching web..." when={input.query}>
        Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()

    const view = createMemo(() => {
      const diffStyle = ctx.sync.data.config.tui?.diff_style
      if (diffStyle === "stacked") return "unified"
      // Default to "auto" behavior
      return ctx.width > 120 ? "split" : "unified"
    })

    const ft = createMemo(() => filetype(props.input.filePath))

    const diffContent = createMemo(() => props.metadata.diff ?? props.permission["diff"])

    const diagnostics = createMemo(() => {
      const arr = props.metadata.diagnostics?.[props.input.filePath ?? ""] ?? []
      return arr.filter((x) => x.severity === 1).slice(0, 3)
    })

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing edit..." when={props.input.filePath}>
          Edit {normalizePath(props.input.filePath!)}{" "}
          {input({
            replaceAll: props.input.replaceAll,
          })}
        </ToolTitle>
        <Show when={diffContent()}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
        </Show>
        <Show when={diagnostics().length}>
          <box>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <ToolTitle icon="%" fallback="Preparing patch..." when={true}>
          Patch
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    return (
      <>
        <Show when={!props.input.todos?.length}>
          <ToolTitle icon="⚙" fallback="Updating todos..." when={true}>
            Updating todos...
          </ToolTitle>
        </Show>
        <Show when={props.metadata.todos?.length}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
                  [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
