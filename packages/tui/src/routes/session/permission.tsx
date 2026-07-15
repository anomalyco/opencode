import { createStore } from "solid-js/store"
import { dirname } from "node:path"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Portal, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme } from "../../context/theme"
import type { PermissionV2Request } from "@opencode-ai/client"
import { useClient } from "../../context/client"
import { SplitBorder } from "../../ui/border"
import { useData } from "../../context/data"
import { filetype } from "../../util/filetype"
import { Locale } from "../../util/locale"
import { webSearchProviderLabel } from "../../util/tool-display"
import { getScrollAcceleration } from "../../util/scroll"
import { useConfig } from "../../config"
import { Keymap } from "../../context/keymap"
import { usePathFormatter } from "../../context/path-format"

type PermissionStage = "permission" | "always" | "reject"

function EditBody(props: { request: PermissionV2Request; patch?: string }) {
  const themeState = useTheme()
  const themeV2 = themeState.themeV2
  const syntax = themeState.syntax
  const config = useConfig().data
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => {
    return props.request.resources[0] ?? ""
  })
  const diff = createMemo(() => {
    const value = props.request.metadata?.diff
    return typeof value === "string" ? value : ""
  })

  const view = createMemo(() => {
    const diffView = config.diffs?.view
    if (diffView === "unified") return "unified"
    if (diffView === "split") return "split"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(filepath()))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <box flexDirection="column" gap={1}>
      <Show when={diff()}>
        <scrollbox
          height="100%"
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: themeV2.background(),
              foregroundColor: themeV2.scrollbar(),
            },
          }}
        >
          <diff
            diff={diff()}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={themeV2.text()}
            addedBg={themeV2.diff.background.added()}
            removedBg={themeV2.diff.background.removed()}
            contextBg={themeV2.diff.background.context()}
            addedSignColor={themeV2.diff.highlight.added()}
            removedSignColor={themeV2.diff.highlight.removed()}
            lineNumberFg={themeV2.diff.lineNumber.text()}
            lineNumberBg={themeV2.diff.background.context()}
            addedLineNumberBg={themeV2.diff.lineNumber.background.added()}
            removedLineNumberBg={themeV2.diff.lineNumber.background.removed()}
          />
        </scrollbox>
      </Show>
      <Show when={!diff()}>
        <Show
          when={props.patch}
          fallback={
            <box paddingLeft={1}>
              <text fg={themeV2.text.subdued()}>No diff provided</text>
            </box>
          }
        >
          {(patch) => (
            <scrollbox
              height="100%"
              scrollAcceleration={scrollAcceleration()}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: themeV2.background(),
                  foregroundColor: themeV2.scrollbar(),
                },
              }}
            >
              <code
                filetype="diff"
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={syntax()}
                content={patch()}
                fg={themeV2.text.subdued()}
              />
            </scrollbox>
          )}
        </Show>
      </Show>
    </box>
  )
}

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { themeV2 } = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={themeV2.text.subdued()} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={themeV2.text.subdued()}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={themeV2.text()}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

export function PermissionPrompt(props: { request: PermissionV2Request; directory?: string }) {
  const client = useClient()
  const data = useData()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
  })
  const pathFormatter = usePathFormatter()
  const session = createMemo(() => data.session.get(props.request.sessionID))

  const input = createMemo(() => {
    const tool = props.request.source
    if (!tool) return {}
    const message = data.session.message.get(props.request.sessionID, tool.messageID)
    if (message?.type !== "assistant") return {}
    const part = message.content.find((part) => part.type === "tool" && part.id === tool.callID)
    if (part?.type === "tool" && part.state.status !== "streaming") return part.state.input
    return {}
  })

  const { themeV2 } = useTheme()

  return (
    <Switch>
      <Match when={store.stage === "always"}>
        <Prompt
          title="Always allow"
          body={
            <Switch>
              <Match when={props.request.save?.length === 1 && props.request.save[0] === "*"}>
                <TextBody title={"This will allow " + props.request.action + " until OpenCode is restarted."} />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={themeV2.text.subdued()}>This will allow the following patterns until OpenCode is restarted</text>
                  <box>
                    <For each={props.request.save ?? []}>
                      {(pattern) => (
                        <text fg={themeV2.text()}>
                          {"- "}
                          {pattern}
                        </text>
                      )}
                    </For>
                  </box>
                </box>
              </Match>
            </Switch>
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("stage", "permission")
            if (option === "cancel") return
            void client.api.permission.reply({
              sessionID: props.request.sessionID,
              reply: "always",
              requestID: props.request.id,
            })
          }}
        />
      </Match>
      <Match when={store.stage === "reject"}>
        <RejectPrompt
          onConfirm={(message) => {
            void client.api.permission.reply({
              sessionID: props.request.sessionID,
              reply: "reject",
              requestID: props.request.id,
              message: message || undefined,
            })
          }}
          onCancel={() => {
            setStore("stage", "permission")
          }}
        />
      </Match>
      <Match when={store.stage === "permission"}>
        {(() => {
          const info = () => {
            const permission = props.request.action
            const data = input()

            if (permission === "edit") {
              const filepath = props.request.resources[0] ?? ""
              const patch = typeof data.patchText === "string" ? data.patchText : undefined
              return {
                icon: "→",
                title: `Edit ${pathFormatter.format(filepath)}`,
                body: <EditBody request={props.request} patch={patch} />,
              }
            }

            if (permission === "read") {
              const raw = data.path
              const filePath = typeof raw === "string" ? raw : ""
              return {
                icon: "→",
                title: `Read ${pathFormatter.format(filePath)}`,
                body: (
                  <Show when={filePath}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"Path: " + pathFormatter.format(filePath)}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "glob") {
              const pattern = typeof data.pattern === "string" ? data.pattern : ""
              return {
                icon: "✱",
                title: `Glob "${pattern}"`,
                body: (
                  <Show when={pattern}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"Pattern: " + pattern}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "grep") {
              const pattern = typeof data.pattern === "string" ? data.pattern : ""
              return {
                icon: "✱",
                title: `Grep "${pattern}"`,
                body: (
                  <Show when={pattern}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"Pattern: " + pattern}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "list") {
              const raw = data.path
              const dir = typeof raw === "string" ? raw : ""
              return {
                icon: "→",
                title: `List ${pathFormatter.format(dir)}`,
                body: (
                  <Show when={dir}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"Path: " + pathFormatter.format(dir)}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "shell") {
              const command = typeof data.command === "string" ? data.command : ""
              return {
                body: (
                  <Show when={command}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text()}>{"$ " + command}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "subagent" || permission === "task") {
              const agent =
                typeof data.agent === "string"
                  ? data.agent
                  : typeof data.subagent_type === "string"
                    ? data.subagent_type
                    : "Unknown"
              const desc = typeof data.description === "string" ? data.description : ""
              return {
                icon: "#",
                title: `${Locale.titlecase(agent)} Subagent`,
                body: (
                  <Show when={desc}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text()}>{"◉ " + desc}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "webfetch") {
              const url = typeof data.url === "string" ? data.url : ""
              return {
                icon: "%",
                title: `WebFetch ${url}`,
                body: (
                  <Show when={url}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"URL: " + url}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "websearch") {
              const query = typeof data.query === "string" ? data.query : ""
              return {
                icon: "◈",
                title: `${webSearchProviderLabel(data.provider)} "${query}"`,
                body: (
                  <Show when={query}>
                    <box paddingLeft={1}>
                      <text fg={themeV2.text.subdued()}>{"Query: " + query}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "external_directory") {
              const meta = props.request.metadata ?? {}
              const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined
              const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined
              const pattern = props.request.resources[0]
              const derived =
                typeof pattern === "string" ? (pattern.includes("*") ? dirname(pattern) : pattern) : undefined

              const raw = parent ?? filepath ?? derived
              const dir = pathFormatter.format(raw)
              const patterns = props.request.resources.filter((p): p is string => typeof p === "string")

              return {
                icon: "←",
                title: `Access external directory ${dir}`,
                body: (
                  <Show when={patterns.length > 0}>
                    <box paddingLeft={1} gap={1}>
                      <text fg={themeV2.text.subdued()}>Patterns</text>
                      <box>
                        <For each={patterns}>{(p) => <text fg={themeV2.text()}>{"- " + p}</text>}</For>
                      </box>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "doom_loop") {
              return {
                icon: "⟳",
                title: "Continue after repeated failures",
                body: (
                  <box paddingLeft={1}>
                    <text fg={themeV2.text.subdued()}>This keeps the session running despite repeated failures.</text>
                  </box>
                ),
              }
            }

            return {
              icon: "⚙",
              title: `Call tool ${permission}`,
              body: (
                <box paddingLeft={1}>
                  <text fg={themeV2.text.subdued()}>{"Tool: " + permission}</text>
                </box>
              ),
            }
          }

          const current = info()

          const header = () => (
            <box flexDirection="column" gap={0}>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={themeV2.text.feedback.warning()}>{"△"}</text>
                <text fg={themeV2.text()}>Permission required</text>
              </box>
              <Show when={current.title}>
                <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
                  <text fg={themeV2.text.subdued()} flexShrink={0}>
                    {current.icon}
                  </text>
                  <text fg={themeV2.text()}>{current.title}</text>
                </box>
              </Show>
            </box>
          )

          const body = (
            <Prompt
              title="Permission required"
              header={header()}
              body={current.body}
              options={
                props.request.save?.length
                  ? { once: "Allow once", always: "Allow always", reject: "Reject" }
                  : { once: "Allow once", reject: "Reject" }
              }
              escapeKey="reject"
              fullscreen
              onSelect={(option) => {
                if (option === "always") {
                  setStore("stage", "always")
                  return
                }
                if (option === "reject") {
                  if (session()?.parentID) {
                    setStore("stage", "reject")
                    return
                  }
                  void client.api.permission.reply({
                    sessionID: props.request.sessionID,
                    reply: "reject",
                    requestID: props.request.id,
                  })
                  return
                }
                void client.api.permission.reply({
                  sessionID: props.request.sessionID,
                  reply: "once",
                  requestID: props.request.id,
                })
              }}
            />
          )

          return body
        })()}
      </Match>
    </Switch>
  )
}

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const { themeV2 } = useTheme().contextual("elevated")
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  Keymap.createLayer(() => ({
    mode: "base",
    commands: [
      {
        id: "app.exit",
        title: "Cancel permission rejection",
        group: "Permission",
        run() {
          props.onCancel()
        },
      },
      { bind: "escape", title: "Cancel permission rejection", group: "Permission", run: () => props.onCancel() },
      {
        bind: "return",
        title: "Confirm permission rejection",
        group: "Permission",
        run: () => props.onConfirm(input.plainText),
      },
    ],
  }))

  return (
    <box
      backgroundColor={themeV2.background()}
      border={["left"]}
      borderColor={themeV2.text.feedback.error()}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={themeV2.text.feedback.error()}>{"△"}</text>
          <text fg={themeV2.text()}>Reject permission</text>
        </box>
        <box paddingLeft={1}>
          <text fg={themeV2.text.subdued()}>Tell OpenCode what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={themeV2.background.action.secondary("focused")}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(val: TextareaRenderable) => {
            input = val
            val.traits = { status: "REJECT" }
          }}
          focused
          textColor={themeV2.text()}
          focusedTextColor={themeV2.text()}
          cursorColor={themeV2.text()}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={themeV2.text()}>
            enter <span style={{ fg: themeV2.text.subdued() }}>confirm</span>
          </text>
          <text fg={themeV2.text()}>
            esc <span style={{ fg: themeV2.text.subdued() }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  header?: JSX.Element
  body: JSX.Element
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const { themeV2 } = useTheme().contextual("elevated")
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
    expanded: false,
  })
  const narrow = createMemo(() => dimensions().width < 80)
  const shortcuts = Keymap.useShortcuts()

  Keymap.createLayer(() => ({
    mode: "base",
    commands: [
      {
        id: "app.exit",
        title: "Reject permission",
        group: "Permission",
        bind: false,
        run() {
          if (!props.escapeKey) return
          props.onSelect(props.escapeKey)
        },
      },
      {
        id: "permission.prompt.fullscreen",
        title: "Toggle permission fullscreen",
        group: "Permission",
        bind: false,
        run() {
          if (!props.fullscreen) return
          setStore("expanded", (v) => !v)
        },
      },
      {
        bind: "left",
        title: "Previous permission option",
        group: "Permission",
        run: () => {
          const idx = keys.indexOf(store.selected)
          const next = keys[(idx - 1 + keys.length) % keys.length]
          setStore("selected", next)
        },
      },
      {
        bind: "h",
        title: "Previous permission option",
        group: "Permission",
        run: () => {
          const idx = keys.indexOf(store.selected)
          const next = keys[(idx - 1 + keys.length) % keys.length]
          setStore("selected", next)
        },
      },
      {
        bind: "right",
        title: "Next permission option",
        group: "Permission",
        run: () => {
          const idx = keys.indexOf(store.selected)
          const next = keys[(idx + 1) % keys.length]
          setStore("selected", next)
        },
      },
      {
        bind: "l",
        title: "Next permission option",
        group: "Permission",
        run: () => {
          const idx = keys.indexOf(store.selected)
          const next = keys[(idx + 1) % keys.length]
          setStore("selected", next)
        },
      },
      {
        bind: "return",
        title: "Select permission option",
        group: "Permission",
        run: () => props.onSelect(store.selected),
      },
      ...(props.escapeKey
        ? [
            {
              bind: "escape",
              title: "Reject permission",
              group: "Permission",
              run: () => props.onSelect(props.escapeKey!),
            },
          ]
        : []),
    ],
    bindings: [
      ...(props.escapeKey ? ["app.exit"] : []),
      ...(props.fullscreen ? ["permission.prompt.fullscreen"] : []),
    ],
  }))

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))
  useRenderer()

  const content = () => (
    <box
      backgroundColor={themeV2.background()}
      border={["left"]}
      borderColor={themeV2.text.feedback.warning()}
      customBorderChars={SplitBorder.customBorderChars}
      {...(store.expanded
        ? { top: dimensions().height * -1 + 1, bottom: 1, left: 2, right: 2, position: "absolute" }
        : {
            top: 0,
            maxHeight: 15,
            bottom: 0,
            left: 0,
            right: 0,
            position: "relative",
          })}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <Show
          when={props.header}
          fallback={
            <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
              <text fg={themeV2.text.feedback.warning()}>{"△"}</text>
              <text fg={themeV2.text()}>{props.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {props.header}
          </box>
        </Show>
        {props.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={themeV2.background.action.secondary("focused")}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={themeV2.background.action.primary(
                  option === store.selected ? "focused" : "default",
                )}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text
                  fg={themeV2.text.action.primary(
                    option === store.selected ? "focused" : "default",
                  )}
                >
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={themeV2.text()}>
              {shortcuts.get("permission.prompt.fullscreen")} <span style={{ fg: themeV2.text.subdued() }}>{hint()}</span>
            </text>
          </Show>
          <text fg={themeV2.text()}>
            {"⇆"} <span style={{ fg: themeV2.text.subdued() }}>select</span>
          </text>
          <text fg={themeV2.text()}>
            enter <span style={{ fg: themeV2.text.subdued() }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )

  return (
    <Show when={!store.expanded} fallback={<Portal>{content()}</Portal>}>
      {content()}
    </Show>
  )
}
