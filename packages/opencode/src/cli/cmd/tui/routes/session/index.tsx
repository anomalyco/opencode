import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
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
import { BoxRenderable, ScrollBoxRenderable, addDefaultParsers } from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type {
  AssistantMessage,
  Part,
  ToolPart,
  UserMessage,
  TextPart,
  ReasoningPart,
} from "@opencode-ai/sdk"
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
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
  type BoxProps,
  type JSX,
} from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { Shimmer } from "@tui/ui/shimmer"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { iife } from "@/util/iife"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { Sidebar } from "./sidebar"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import { Global } from "@/global"
import fs from "fs/promises"

addDefaultParsers(parsers.parsers)

const context = createContext<{
  width: number
  conceal: () => boolean
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
    return messages().findLast((x) => x.role === "assistant" && !x.time?.completed)?.id
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))
  const [conceal, setConceal] = createSignal(true)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => sidebar() === "show" || (sidebar() === "auto" && wide()))
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

  createEffect(() => {
    sync.session.sync(route.sessionID).catch(() => {
      toast.show({
        message: `Session not found: ${route.sessionID}`,
        variant: "error",
      })
      return navigate({ type: "home" })
    })
  })

  const toast = useToast()

  const sdk = useSDK()

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    const first = permissions()[0]
    if (first) {
      const response = iife(() => {
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
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  // snap to bottom when revert position changes
  createEffect((old) => {
    if (old !== session()?.revert?.messageID) toBottom()
    return session()?.revert?.messageID
  })

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
    {
      title: "Share session",
      value: "session.share",
      keybind: "session_share",
      disabled: !!session()?.share?.url,
      category: "Session",
      onSelect: async (dialog) => {
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
      onSelect: (dialog) => {
        const revert = session().revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session.revert({
          path: {
            id: route.sessionID,
          },
          body: {
            messageID: message.id,
          },
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
      title: "Toggle sidebar",
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

        console.log(text)
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

          // Save to file in data directory
          const exportDir = path.join(Global.Path.data, "exports")
          await fs.mkdir(exportDir, { recursive: true })

          const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
          const filename = `session-${sessionData.id.slice(0, 8)}-${timestamp}.md`
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

  const revert = createMemo(() => {
    const s = session()
    if (!s) return
    const messageID = s.revert?.messageID
    if (!messageID) return
    const reverted = messages().filter((x) => x.id >= messageID && x.role === "user")

    const diffFiles = (() => {
      const diffText = s.revert?.diff || ""
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
    })()

    return {
      messageID,
      reverted,
      diff: s.revert!.diff,
      diffFiles,
    }
  })

  const dialog = useDialog()
  const renderer = useRenderer()

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        conceal,
      }}
    >
      <box
        flexDirection="row"
        paddingBottom={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        gap={2}
      >
        <box flexGrow={1} gap={1}>
          <Show when={session()}>
            <Show when={session().parentID}>
              <box
                backgroundColor={theme.backgroundPanel}
                justifyContent="space-between"
                flexDirection="row"
                paddingTop={1}
                paddingBottom={1}
                flexShrink={0}
                paddingLeft={2}
                paddingRight={2}
              >
                <text fg={theme.text}>
                  Previous{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle_reverse")}
                  </span>
                </text>
                <text fg={theme.text}>
                  <b>Viewing subagent session</b>
                </text>
                <text fg={theme.text}>
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle")}
                  </span>{" "}
                  Next
                </text>
              </box>
            </Show>
            <Show when={!sidebarVisible()}>
              <Header />
            </Show>
            <scrollbox
              ref={(r) => (scroll = r)}
              scrollbarOptions={{ visible: false }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
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
                              backgroundColor={
                                hover() ? theme.backgroundElement : theme.backgroundPanel
                              }
                            >
                              <text fg={theme.textMuted}>
                                {revert()!.reverted.length} message reverted
                              </text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>
                                  {keybind.print("messages_redo")}
                                </span>{" "}
                                or /redo to restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}>
                                            {" "}
                                            +{file.additions}
                                          </span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}>
                                            {" "}
                                            -{file.deletions}
                                          </span>
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
                            <DialogMessage messageID={message.id} sessionID={route.sessionID} />
                          ))
                        }}
                        message={message as UserMessage}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={index() === messages().length - 1}
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
  const text = createMemo(
    () => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0],
  )
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : theme.secondary))

  return (
    <Show when={text()}>
      <box
        id={props.message.id}
        onMouseOver={() => {
          setHover(true)
        }}
        onMouseOut={() => {
          setHover(false)
        }}
        onMouseUp={props.onMouseUp}
        border={["left"]}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        marginTop={props.index === 0 ? 0 : 1}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={color()}
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
                    <span style={{ bg: bg(), fg: theme.background }}>
                      {" "}
                      {MIME_BADGE[file.mime] ?? file.mime}{" "}
                    </span>
                    <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}>
                      {" "}
                      {file.filename}{" "}
                    </span>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {sync.data.config.username ?? "You"}{" "}
          <Show
            when={queued()}
            fallback={
              <span style={{ fg: theme.textMuted }}>
                ({Locale.time(props.message.time.created)})
              </span>
            }
          >
            <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}>
              {" "}
              QUEUED{" "}
            </span>
          </Show>
        </text>
      </box>
    </Show>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  return (
    <>
      <For each={props.parts}>
        {(part) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic component={component()} part={part as any} message={props.message} />
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
      <Show
        when={
          !props.message.time.completed ||
          (props.last &&
            props.parts.some((item) => item.type === "step-finish" && item.reason === "tool-calls"))
        }
      >
        <box
          paddingLeft={2}
          marginTop={1}
          flexDirection="row"
          gap={1}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.backgroundElement}
        >
          <text fg={local.agent.color(props.message.mode)}>
            {Locale.titlecase(props.message.mode)}
          </text>
          <Shimmer text={`${props.message.modelID}`} color={theme.text} />
        </box>
      </Show>
      <Show
        when={
          props.message.time.completed &&
          props.parts.some((item) => item.type === "step-finish" && item.reason !== "tool-calls")
        }
      >
        <box paddingLeft={3}>
          <text marginTop={1}>
            <span style={{ fg: local.agent.color(props.message.mode) }}>
              {Locale.titlecase(props.message.mode)}
            </span>{" "}
            <span style={{ fg: theme.textMuted }}>{props.message.modelID}</span>
          </text>
        </box>
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box
        id={"text-" + props.part.id}
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
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.text}>{props.part.text.trim()}</text>
        </box>
      </box>
    </Show>
  )
}

function TextPart(props: { part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          syntaxStyle={syntax()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
        />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { part: ToolPart; message: AssistantMessage }) {
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
    const output = createMemo(() => props.metadata.output?.trim() ?? "")
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
    const lines = createMemo(() => {
      return props.input.content?.split("\n") ?? []
    })
    const code = createMemo(() => {
      if (!props.input.content) return ""
      const text = props.input.content
      return text
    })

    const numbers = createMemo(() => {
      const pad = lines().length.toString().length
      return lines()
        .map((_, index) => index + 1)
        .map((x) => x.toString().padStart(pad, " "))
    })

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing write..." when={props.input.filePath}>
          Wrote {props.input.filePath}
        </ToolTitle>
        <box flexDirection="row">
          <box flexShrink={0}>
            <For each={numbers()}>
              {(value) => <text style={{ fg: theme.textMuted }}>{value}</text>}
            </For>
          </box>
          <box paddingLeft={1} flexGrow={1}>
            <code
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </box>
        </box>
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
          Glob "{props.input.pattern}"{" "}
          <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
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
        Grep "{props.input.pattern}"{" "}
        <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
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
        <ToolTitle
          icon="%"
          fallback="Delegating..."
          when={props.input.subagent_type ?? props.input.description}
        >
          Task [{props.input.subagent_type ?? "unknown"}] {props.input.description}
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task) => (
                <text style={{ fg: theme.textMuted }}>
                  ∟ {task.tool} {task.state.status === "completed" ? task.state.title : ""}
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

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()

    const style = createMemo(() => (ctx.width > 120 ? "split" : "stacked"))

    const diff = createMemo(() => {
      const diff = props.metadata.diff ?? props.permission["diff"]
      if (!diff) return null

      try {
        const patches = parsePatch(diff)
        if (patches.length === 0) return null

        const patch = patches[0]
        const oldLines: string[] = []
        const newLines: string[] = []

        for (const hunk of patch.hunks) {
          let i = 0
          while (i < hunk.lines.length) {
            const line = hunk.lines[i]

            if (line.startsWith("-")) {
              const removedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("-")) {
                removedLines.push("- " + hunk.lines[i].slice(1))
                i++
              }

              const addedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
                addedLines.push("+ " + hunk.lines[i].slice(1))
                i++
              }

              const maxLen = Math.max(removedLines.length, addedLines.length)
              for (let j = 0; j < maxLen; j++) {
                oldLines.push(removedLines[j] ?? "")
                newLines.push(addedLines[j] ?? "")
              }
            } else if (line.startsWith("+")) {
              const addedLines: string[] = []
              while (i < hunk.lines.length && hunk.lines[i].startsWith("+")) {
                addedLines.push("+ " + hunk.lines[i].slice(1))
                i++
              }

              for (const added of addedLines) {
                oldLines.push("")
                newLines.push(added)
              }
            } else {
              oldLines.push("  " + line.slice(1))
              newLines.push("  " + line.slice(1))
              i++
            }
          }
        }

        return {
          oldContent: oldLines.join("\n"),
          newContent: newLines.join("\n"),
        }
      } catch (error) {
        return null
      }
    })

    const code = createMemo(() => {
      if (!props.metadata.diff) return ""
      const text = props.metadata.diff.split("\n").slice(5).join("\n")
      return text.trim()
    })

    const ft = createMemo(() => filetype(props.input.filePath))

    return (
      <>
        <ToolTitle icon="←" fallback="Preparing edit..." when={props.input.filePath}>
          Edit {normalizePath(props.input.filePath!)}{" "}
          {input({
            replaceAll: props.input.replaceAll,
          })}
        </ToolTitle>
        <Switch>
          <Match when={props.permission["diff"]}>
            <text fg={theme.text}>{props.permission["diff"]?.trim()}</text>
          </Match>
          <Match when={diff() && style() === "split"}>
            <box paddingLeft={1} flexDirection="row" gap={2}>
              <box flexGrow={1} flexBasis={0}>
                <code filetype={ft()} syntaxStyle={syntax()} content={diff()!.oldContent} />
              </box>
              <box flexGrow={1} flexBasis={0}>
                <code filetype={ft()} syntaxStyle={syntax()} content={diff()!.newContent} />
              </box>
            </box>
          </Match>
          <Match when={code()}>
            <box paddingLeft={1}>
              <code filetype={ft()} syntaxStyle={syntax()} content={code()} />
            </box>
          </Match>
        </Switch>
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
      <box>
        <For each={props.input.todos ?? []}>
          {(todo) => (
            <text style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}>
              [{todo.status === "completed" ? "✓" : " "}] {todo.content}
            </text>
          )}
        </For>
      </box>
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
