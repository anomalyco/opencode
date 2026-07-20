import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Portal, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme } from "../../context/theme"
import type { PermissionV2Request } from "@opencode-ai/client"
import { useClient } from "../../context/client"
import { SplitBorder } from "../../ui/border"
import { useData } from "../../context/data"
import { filetype } from "../../util/filetype"
import { permissionAlwaysLines, permissionOptionLabel, permissionPresentation } from "../../util/permission"
import { getScrollAcceleration } from "../../util/scroll"
import { useConfig } from "../../config"
import { Keymap } from "../../context/keymap"
import { usePathFormatter } from "../../context/path-format"
import { SimulationSemantics } from "../../simulation/semantics"

type PermissionStage = "permission" | "always" | "reject"

function EditBody(props: { file?: string; diff?: string; patch?: string }) {
  const themeState = useTheme()
  const themeV2 = themeState.themeV2
  const syntax = themeState.syntax
  const config = useConfig().data
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => props.file ?? "")
  const diff = createMemo(() => props.diff ?? "")

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

export function PermissionPrompt(props: { request: PermissionV2Request; directory?: string }) {
  const client = useClient()
  const data = useData()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
  })
  const pathFormatter = usePathFormatter()
  const session = createMemo(() => data.session.get(props.request.sessionID))

  const source = createMemo(() => {
    const tool = props.request.source
    if (!tool) return { input: undefined, structured: undefined }
    const message = data.session.message.get(props.request.sessionID, tool.messageID)
    if (message?.type !== "assistant") return { input: undefined, structured: undefined }
    const part = message.content.find((part) => part.type === "tool" && part.id === tool.callID)
    if (part?.type === "tool" && part.state.status !== "streaming") {
      return { input: part.state.input, structured: part.state.structured }
    }
    return { input: undefined, structured: undefined }
  })

  const { themeV2 } = useTheme()

  return (
    <Switch>
      <Match when={store.stage === "always"}>
        <Prompt
          title="Always allow"
          semanticLabel={`Always allow ${props.request.action}`}
          instance={props.request.id}
          body={
            <box paddingLeft={1} gap={1}>
              <For each={permissionAlwaysLines(props.request)}>
                {(line, index) => <text fg={index() === 0 ? themeV2.text.subdued() : themeV2.text()}>{line}</text>}
              </For>
            </box>
          }
          options={{ confirm: permissionOptionLabel("confirm"), cancel: permissionOptionLabel("cancel") }}
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
          action={props.request.action}
          instance={props.request.id}
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
          const current = permissionPresentation(
            {
              action: props.request.action,
              resources: props.request.resources,
              metadata: props.request.metadata,
              input: source().input,
              structured: source().structured,
            },
            pathFormatter.format,
          )
          const presentationBody =
            props.request.action === "edit" ? (
              <EditBody file={current.file} diff={current.diff} patch={current.patch} />
            ) : props.request.action === "external_directory" ? (
              <Show when={current.lines.length > 0}>
                <box paddingLeft={1} gap={1}>
                  <text fg={themeV2.text.subdued()}>Patterns</text>
                  <box>
                    <For each={current.lines}>{(line) => <text fg={themeV2.text()}>{line}</text>}</For>
                  </box>
                </box>
              </Show>
            ) : (
              <box paddingLeft={1}>
                <For each={current.lines}>
                  {(line) => (
                    <text
                      fg={
                        props.request.action === "shell" ||
                        props.request.action === "subagent" ||
                        props.request.action === "task"
                          ? themeV2.text()
                          : themeV2.text.subdued()
                      }
                    >
                      {line}
                    </text>
                  )}
                </For>
              </box>
            )

          const header = () => (
            <box flexDirection="column" gap={0}>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={themeV2.text.feedback.warning()}>{"△"}</text>
                <text fg={themeV2.text()}>Permission required</text>
              </box>
              <Show when={props.request.action !== "shell" && current.title}>
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
              semanticLabel={permissionSemanticLabel(props.request.action, current.title)}
              instance={props.request.id}
              header={header()}
              body={presentationBody}
              options={
                props.request.save?.length
                  ? {
                      once: permissionOptionLabel("once"),
                      always: permissionOptionLabel("always"),
                      reject: permissionOptionLabel("reject"),
                    }
                  : { once: permissionOptionLabel("once"), reject: permissionOptionLabel("reject") }
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

export function permissionSemanticLabel(action: string, title?: string) {
  return `Permission required: ${title ?? action}`
}

function RejectPrompt(props: {
  action: string
  instance: string
  onConfirm: (message: string) => void
  onCancel: () => void
}) {
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
      id="session.permission.reject"
      ref={SimulationSemantics.bind(() => ({
        instance: props.instance,
        role: "dialog",
        label: `Reject permission: ${props.action}`,
      }))}
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
        backgroundColor={themeV2.raise(themeV2.background())}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          id="session.permission.reject.message"
          ref={(val: TextareaRenderable) => {
            input = val
            SimulationSemantics.bind(() => ({
              instance: props.instance,
              role: "textbox",
              label: "Rejection reason",
              focused: val.focused,
              disabled: false,
            }))(val)
            val.traits = { status: "REJECT" }
          }}
          focused
          textColor={themeV2.text()}
          focusedTextColor={themeV2.text()}
          cursorColor={themeV2.text()}
        />
        <box
          id="session.permission.reject.actions"
          ref={SimulationSemantics.bind(() => ({
            instance: props.instance,
            role: "group",
            label: "Rejection actions",
          }))}
          flexDirection="row"
          gap={2}
          flexShrink={0}
        >
          <box
            id="session.permission.reject.confirm"
            ref={SimulationSemantics.bind(() => ({
              instance: props.instance,
              role: "button",
              label: "Confirm rejection",
              disabled: false,
            }))}
            onMouseUp={() => props.onConfirm(input.plainText)}
          >
            <text fg={themeV2.text()}>
              enter <span style={{ fg: themeV2.text.subdued() }}>confirm</span>
            </text>
          </box>
          <box
            id="session.permission.reject.cancel"
            ref={SimulationSemantics.bind(() => ({
              instance: props.instance,
              role: "button",
              label: "Cancel rejection",
              disabled: false,
            }))}
            onMouseUp={props.onCancel}
          >
            <text fg={themeV2.text()}>
              esc <span style={{ fg: themeV2.text.subdued() }}>cancel</span>
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  semanticLabel?: string
  instance: string
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
    bindings: [...(props.escapeKey ? ["app.exit"] : []), ...(props.fullscreen ? ["permission.prompt.fullscreen"] : [])],
  }))

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))
  useRenderer()

  const content = () => (
    <box
      id="session.permission"
      ref={SimulationSemantics.bind(() => ({
        instance: props.instance,
        role: "dialog",
        label: props.semanticLabel ?? props.title,
        expanded: store.expanded,
      }))}
      backgroundColor={themeV2.background()}
      border={["left"]}
      borderColor={themeV2.background.action("focused")}
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
        backgroundColor={themeV2.raise(themeV2.background())}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box
          id="session.permission.actions"
          ref={SimulationSemantics.bind(() => ({
            instance: props.instance,
            role: "listbox",
            label: "Permission choices",
          }))}
          flexDirection="row"
          gap={1}
          flexShrink={0}
        >
          <For each={keys}>
            {(option) => (
              <box
                id={`session.permission.action.${String(option)}`}
                ref={SimulationSemantics.bind(() => ({
                  instance: props.instance,
                  role: "option",
                  label: props.options[option],
                  focused: option === store.selected,
                  selected: option === store.selected,
                  disabled: false,
                }))}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={themeV2.background.action(option === store.selected ? "focused" : "default")}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text fg={themeV2.text.action(option === store.selected ? "focused" : "default")}>
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={themeV2.text()}>
              {shortcuts.get("permission.prompt.fullscreen")}{" "}
              <span style={{ fg: themeV2.text.subdued() }}>{hint()}</span>
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
