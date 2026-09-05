import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Portal, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme, useThemes } from "../../context/theme"
import type { PermissionReply, PermissionRequest } from "@opencode-ai/client"
import { SplitBorder } from "../../ui/border"
import { useData } from "../../context/data"
import { filetype } from "../../util/filetype"
import { permissionAlwaysLines, permissionOptionLabel, permissionPresentation } from "../../util/permission"
import { getScrollAcceleration } from "../../util/scroll"
import { useConfig } from "../../config"
import { Keymap } from "../../context/keymap"
import { useInteractivity } from "../../context/interactivity"
import { usePathFormatter } from "../../context/path-format"
import { SimulationSemantics } from "../../simulation/semantics"
import { PatchDiff } from "../../component/patch-diff"
import { useToast } from "../../ui/toast"

type PermissionStage = "permission" | "reject"

function EditBody(props: { file?: string; diff?: string; patch?: string }) {
  const theme = useTheme()
  const themes = useThemes()
  const syntax = themes.currentSyntax
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
              backgroundColor: theme.background.default,
              foregroundColor: theme.scrollbar.default,
            },
          }}
        >
          <PatchDiff
            diff={diff()}
            hunkFg={theme.diff.text.hunkHeader}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={theme.text.default}
            addedBg={theme.diff.background.added}
            removedBg={theme.diff.background.removed}
            contextBg={theme.diff.background.context}
            addedSignColor={theme.diff.highlight.added}
            removedSignColor={theme.diff.highlight.removed}
            lineNumberFg={theme.diff.lineNumber.text}
            lineNumberBg={theme.diff.background.context}
            addedLineNumberBg={theme.diff.lineNumber.background.added}
            removedLineNumberBg={theme.diff.lineNumber.background.removed}
          />
        </scrollbox>
      </Show>
      <Show when={!diff()}>
        <Show
          when={props.patch}
          fallback={
            <box paddingLeft={1}>
              <text fg={theme.text.subdued}>No diff provided</text>
            </box>
          }
        >
          {(patch) => (
            <scrollbox
              height="100%"
              scrollAcceleration={scrollAcceleration()}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: theme.background.default,
                  foregroundColor: theme.scrollbar.default,
                },
              }}
            >
              <code
                filetype="diff"
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={syntax()}
                content={patch()}
                fg={theme.text.subdued}
              />
            </scrollbox>
          )}
        </Show>
      </Show>
    </box>
  )
}

export function PermissionPrompt(props: { request: PermissionRequest; directory?: string }) {
  const data = useData()
  const toast = useToast()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
  })
  const pathFormatter = usePathFormatter()
  const session = createMemo(() => data.session.get(props.request.sessionID))

  const source = createMemo(() => {
    const tool = props.request.source
    if (!tool) return { input: undefined, metadata: undefined }
    const message = data.session.message.get(props.request.sessionID, tool.messageID)
    if (message?.type !== "assistant") return { input: undefined, metadata: undefined }
    const part = message.content.find((part) => part.type === "tool" && part.id === tool.id)
    if (part?.type === "tool" && part.state.status !== "streaming") {
      return { input: part.state.input, metadata: part.state.metadata }
    }
    return { input: undefined, metadata: undefined }
  })

  const theme = useTheme()

  function reply(value: PermissionReply, message?: string) {
    void data.session.permission
      .reply({ sessionID: props.request.sessionID, requestID: props.request.id, reply: value, message })
      .catch((error: unknown) => toast.error(error))
  }

  return (
    <Switch>
      <Match when={store.stage === "reject"}>
        <RejectPrompt
          action={props.request.action}
          instance={props.request.id}
          onConfirm={(message) => {
            reply("reject", message || undefined)
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
              toolMetadata: source().metadata,
            },
            pathFormatter.format,
          )
          const presentationBody = () =>
            props.request.action === "edit" ? (
              <EditBody file={current.file} diff={current.diff} patch={current.patch} />
            ) : props.request.action === "external_directory" ? (
              <Show when={current.lines.length > 0}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.text.subdued}>Patterns</text>
                  <box>
                    <For each={current.lines}>{(line) => <text fg={theme.text.default}>{line}</text>}</For>
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
                          ? theme.text.default
                          : theme.text.subdued
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
                <text fg={theme.text.feedback.warning.default}>{"△"}</text>
                <text fg={theme.text.default}>Permission required</text>
              </box>
              <Show when={props.request.action !== "shell" && current.title}>
                <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
                  <text fg={theme.text.subdued} flexShrink={0}>
                    {current.icon}
                  </text>
                  <text fg={theme.text.default}>{current.title}</text>
                </box>
              </Show>
            </box>
          )

          const body = (
            <SessionQuestion
              title="Permission required"
              semanticLabel={permissionSemanticLabel(props.request.action, current.title)}
              instance={props.request.id}
              header={header()}
              body={(option) => (
                <Show when={option === "always"} fallback={presentationBody()}>
                  <box paddingLeft={1} gap={1}>
                    <For each={permissionAlwaysLines(props.request)}>
                      {(line, index) => <text fg={index() === 0 ? theme.text.subdued : theme.text.default}>{line}</text>}
                    </For>
                  </box>
                </Show>
              )}
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
                  reply("always")
                  return
                }
                if (option === "reject") {
                  if (session()?.parentID) {
                    setStore("stage", "reject")
                    return
                  }
                  reply("reject")
                  return
                }
                reply("once")
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
  const enabled = useInteractivity()
  const theme = useTheme("elevated")
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  Keymap.createLayer(() => ({
    mode: "base",
    commands: [
      {
        id: "app.exit",
        title: "Cancel permission rejection",
        group: "Permission",
        run(_input, event) {
          if (event?.ctrl && event.name === "c" && input.plainText) {
            input.setText("")
            return
          }
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
      backgroundColor={theme.background.default}
      border={["left"]}
      borderColor={theme.text.feedback.error.default}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.text.feedback.error.default}>{"△"}</text>
          <text fg={theme.text.default}>Reject permission</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.text.subdued}>Tell OpenCode what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.raise(theme.background.default)}
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
          focused={enabled()}
          textColor={theme.text.default}
          focusedTextColor={theme.text.default}
          cursorColor={theme.text.default}
          cursorStyle={config.cursor}
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
            <text fg={theme.text.default}>
              enter <span style={{ fg: theme.text.subdued }}>confirm</span>
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
            <text fg={theme.text.default}>
              esc <span style={{ fg: theme.text.subdued }}>cancel</span>
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

export function SessionQuestion<const T extends Record<string, string>>(props: {
  title: string
  semanticLabel?: string
  instance: string
  id?: string
  group?: string
  choicesLabel?: string
  header?: JSX.Element
  body: JSX.Element | ((option: keyof T) => JSX.Element)
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const theme = useTheme("elevated")
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
    expanded: false,
  })
  const narrow = createMemo(() => dimensions().width < 80)
  const shortcuts = Keymap.useShortcuts()
  const id = () => props.id ?? "session.permission"
  const group = () => props.group ?? "Permission"
  const dismiss = () => {
    if (store.expanded) {
      setStore("expanded", false)
      return
    }
    if (props.escapeKey) props.onSelect(props.escapeKey)
  }

  Keymap.createLayer(() => ({
    mode: "base",
    commands: [
      ...(props.escapeKey
        ? [
            {
              id: "app.exit",
              title: "Reject permission",
              group: group(),
              bind: false as const,
              run: dismiss,
            },
          ]
        : []),
      ...(props.fullscreen
        ? [
            {
              id: "permission.prompt.fullscreen",
              title: "Toggle permission fullscreen",
              group: group(),
              bind: false as const,
              run: () => setStore("expanded", (value) => !value),
            },
          ]
        : []),
      ...(keys.length > 1
        ? [
            {
              bind: "left,h",
              title: "Previous option",
              group: group(),
              run: () => {
                const index = keys.indexOf(store.selected)
                setStore("selected", keys[(index - 1 + keys.length) % keys.length])
              },
            },
            {
              bind: "right,l",
              title: "Next option",
              group: group(),
              run: () => {
                const index = keys.indexOf(store.selected)
                setStore("selected", keys[(index + 1) % keys.length])
              },
            },
          ]
        : []),
      {
        bind: "return",
        title: "Select option",
        group: group(),
        run: () => props.onSelect(store.selected),
      },
      ...(props.escapeKey ? [{ bind: "escape", title: "Reject permission", group: group(), run: dismiss }] : []),
    ],
    bindings: [...(props.escapeKey ? ["app.exit"] : []), ...(props.fullscreen ? ["permission.prompt.fullscreen"] : [])],
  }))

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))
  useRenderer()

  const content = () => (
    <box
      id={id()}
      ref={SimulationSemantics.bind(() => ({
        instance: props.instance,
        role: "dialog",
        label: props.semanticLabel ?? props.title,
        expanded: store.expanded,
      }))}
      backgroundColor={theme.background.default}
      border={["left"]}
      borderColor={theme.background.action.primary.focused}
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
              <text fg={theme.text.feedback.warning.default}>{"△"}</text>
              <text fg={theme.text.default}>{props.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {props.header}
          </box>
        </Show>
        {typeof props.body === "function" ? props.body(store.selected) : props.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.raise(theme.background.default)}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box
          id={`${id()}.actions`}
          ref={SimulationSemantics.bind(() => ({
            instance: props.instance,
            role: "listbox",
            label: props.choicesLabel ?? "Permission choices",
          }))}
          flexDirection="row"
          gap={1}
          flexShrink={0}
        >
          <For each={keys}>
            {(option) => (
              <box
                id={`${id()}.action.${String(option)}`}
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
                backgroundColor={
                  option === store.selected
                    ? theme.background.action.primary.focused
                    : theme.background.action.primary.default
                }
                onMouseMove={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text
                  fg={option === store.selected ? theme.text.action.primary.focused : theme.text.action.primary.default}
                >
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={theme.text.default}>
              {shortcuts.get("permission.prompt.fullscreen")} <span style={{ fg: theme.text.subdued }}>{hint()}</span>
            </text>
          </Show>
          <Show when={keys.length > 1}>
            <text fg={theme.text.default}>
              {"⇆"} <span style={{ fg: theme.text.subdued }}>select</span>
            </text>
          </Show>
          <text fg={theme.text.default}>
            enter <span style={{ fg: theme.text.subdued }}>confirm</span>
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
