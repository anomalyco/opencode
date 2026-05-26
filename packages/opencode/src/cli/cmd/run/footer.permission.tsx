// Permission UI body for the direct-mode footer.
//
// Renders inside the footer when the reducer pushes a FooterView of type
// "permission". Uses a three-stage state machine (permission.shared.ts):
//
//   permission → shows the request with Allow once / Always / Reject buttons
//   always     → confirmation step before granting permanent access
//   reject     → text field for the rejection message
//
// Keyboard: left/right to select, enter to confirm, esc to reject.
// The diff view (when available) uses the same diff component as scrollback
// tool snapshots.
/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import {
  createPermissionBodyState,
  permissionAlwaysLines,
  permissionCancel,
  permissionEscape,
  permissionHover,
  permissionInfo,
  permissionLabel,
  permissionOptions,
  permissionReject,
  permissionRun,
  permissionShift,
  type PermissionOption,
} from "./permission.shared"
import { toolFiletype } from "./tool"
import { transparent, type RunBlockTheme, type RunFooterTheme } from "./theme"
import type { PermissionReply, RunDiffStyle } from "./types"

function buttons(
  list: PermissionOption[],
  selected: PermissionOption,
  theme: RunFooterTheme,
  disabled: boolean,
  onHover: (option: PermissionOption) => void,
  onSelect: (option: PermissionOption) => void,
) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <For each={list}>
        {(option) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={option === selected ? theme.highlight : transparent}
            onMouseOver={() => {
              if (!disabled) onHover(option)
            }}
            onMouseUp={() => {
              if (!disabled) onSelect(option)
            }}
          >
            <text fg={option === selected ? theme.surface : theme.muted}>{permissionLabel(option)}</text>
          </box>
        )}
      </For>
    </box>
  )
}

function RejectField(props: {
  theme: RunFooterTheme
  text: string
  disabled: boolean
  onChange: (text: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  let area: TextareaRenderable | undefined

  createEffect(() => {
    if (!area || area.isDestroyed) {
      return
    }

    if (area.plainText !== props.text) {
      area.setText(props.text)
      area.cursorOffset = props.text.length
    }

    queueMicrotask(() => {
      if (!area || area.isDestroyed || props.disabled) {
        return
      }
      area.focus()
    })
  })

  return (
    <textarea
      id="run-direct-footer-permission-reject"
      width="100%"
      minHeight={1}
      maxHeight={3}
      wrapMode="word"
      placeholder="Tell OpenCode what to do differently"
      placeholderColor={props.theme.muted}
      textColor={props.theme.text}
      focusedTextColor={props.theme.text}
      backgroundColor={props.theme.surface}
      focusedBackgroundColor={props.theme.surface}
      cursorColor={props.theme.text}
      focused={!props.disabled}
      onContentChange={() => {
        if (!area || area.isDestroyed) {
          return
        }
        props.onChange(area.plainText)
      }}
      onKeyDown={(event) => {
        if (event.name === "escape") {
          event.preventDefault()
          props.onCancel()
          return
        }

        if (event.name === "return" && !event.meta && !event.ctrl && !event.shift) {
          event.preventDefault()
          props.onConfirm()
        }
      }}
      ref={(item) => {
        area = item
      }}
    />
  )
}

export function RunPermissionBody(props: {
  request: PermissionRequest
  theme: RunFooterTheme
  block: RunBlockTheme
  diffStyle?: RunDiffStyle
  onReply: (input: PermissionReply) => void | Promise<void>
}) {
  const dims = useTerminalDimensions()
  const [state, setState] = createSignal(createPermissionBodyState(props.request.id))
  const info = createMemo(() => permissionInfo(props.request))
  const ft = createMemo(() => toolFiletype(info().file))
  const narrow = createMemo(() => dims().width < 80)
  const opts = createMemo(() => permissionOptions(state().stage))
  const busy = createMemo(() => state().submitting)
  const title = createMemo(() => {
    if (state().stage === "always") {
      return "Always allow"
    }

    if (state().stage === "reject") {
      return "Reject permission"
    }

    return "Permission required"
  })

  createEffect(() => {
    const id = props.request.id
    if (state().requestID === id) {
      return
    }

    setState(createPermissionBodyState(id))
  })

  const shift = (dir: -1 | 1) => {
    setState((prev) => permissionShift(prev, dir))
  }

  const submit = async (next: PermissionReply) => {
    setState((prev) => ({
      ...prev,
      submitting: true,
    }))

    try {
      await props.onReply(next)
    } catch {
      setState((prev) => ({
        ...prev,
        submitting: false,
      }))
    }
  }

  const run = (option: PermissionOption) => {
    const cur = state()
    const next = permissionRun(cur, props.request.id, option)
    if (next.state !== cur) {
      setState(next.state)
    }

    if (!next.reply) {
      return
    }

    void submit(next.reply)
  }

  const reject = () => {
    const next = permissionReject(state(), props.request.id)
    if (!next) {
      return
    }

    void submit(next)
  }

  const cancelReject = () => {
    setState((prev) => permissionCancel(prev))
  }

  useKeyboard((event) => {
    const cur = state()
    if (cur.stage === "reject") {
      return
    }

    if (cur.submitting) {
      if (["left", "right", "h", "l", "tab", "return", "escape"].includes(event.name)) {
        event.preventDefault()
      }
      return
    }

    if (event.name === "tab") {
      shift(event.shift ? -1 : 1)
      event.preventDefault()
      return
    }

    if (event.name === "left" || event.name === "h") {
      shift(-1)
      event.preventDefault()
      return
    }

    if (event.name === "right" || event.name === "l") {
      shift(1)
      event.preventDefault()
      return
    }

    if (event.name === "return") {
      run(state().selected)
      event.preventDefault()
      return
    }

    if (event.name !== "escape") {
      return
    }

    setState((prev) => permissionEscape(prev))
    event.preventDefault()
  })

  return (
    <box id="run-direct-footer-permission-body" width="100%" height="100%" flexDirection="column">
      <box
        id="run-direct-footer-permission-head"
        flexDirection="column"
        gap={1}
        paddingLeft={1}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
      >
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={state().stage === "reject" ? props.theme.error : props.theme.warning}>△</text>
          <text fg={props.theme.text}>{title()}</text>
        </box>
        <Switch>
          <Match when={state().stage === "permission"}>
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={props.theme.muted} flexShrink={0}>
                {info().icon}
              </text>
              <text fg={props.theme.text} wrapMode="word">
                {info().title}
              </text>
            </box>
          </Match>
          <Match when={state().stage === "reject"}>
            <box paddingLeft={1}>
              <text fg={props.theme.muted}>Tell OpenCode what to do differently</text>
            </box>
          </Match>
        </Switch>
      </box>

      <Show
        when={state().stage !== "reject"}
        fallback={
          <box width="100%" flexGrow={1} flexShrink={1} justifyContent="flex-end">
            <box
              id="run-direct-footer-permission-reject-bar"
              flexDirection={narrow() ? "column" : "row"}
              flexShrink={0}
              backgroundColor={props.theme.line}
              paddingTop={1}
              paddingLeft={2}
              paddingRight={3}
              paddingBottom={1}
              justifyContent={narrow() ? "flex-start" : "space-between"}
              alignItems={narrow() ? "flex-start" : "center"}
              gap={1}
            >
              <box width={narrow() ? "100%" : undefined} flexGrow={1} flexShrink={1}>
                <RejectField
                  theme={props.theme}
                  text={state().message}
                  disabled={busy()}
                  onChange={(text) => {
                    setState((prev) => ({
                      ...prev,
                      message: text,
                    }))
                  }}
                  onConfirm={reject}
                  onCancel={cancelReject}
                />
              </box>
              <Show
                when={!busy()}
                fallback={
                  <text fg={props.theme.muted} wrapMode="word" flexShrink={0}>
                    Waiting for permission event...
                  </text>
                }
              >
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text fg={props.theme.text}>
                    enter <span style={{ fg: props.theme.muted }}>confirm</span>
                  </text>
                  <text fg={props.theme.text}>
                    esc <span style={{ fg: props.theme.muted }}>cancel</span>
                  </text>
                </box>
              </Show>
            </box>
          </box>
        }
      >
        <box width="100%" flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={3} paddingBottom={1}>
          <Switch>
            <Match when={state().stage === "permission"}>
              <scrollbox
                width="100%"
                height="100%"
                verticalScrollbarOptions={{
                  trackOptions: {
                    backgroundColor: props.theme.surface,
                    foregroundColor: props.theme.line,
                  },
                }}
              >
                <box width="100%" flexDirection="column" gap={1}>
                  <Show
                    when={info().diff}
                    fallback={
                      <box width="100%" flexDirection="column" gap={1} paddingLeft={1}>
                        <For each={info().lines}>
                          {(line) => (
                            <text fg={props.theme.text} wrapMode="word">
                              {line}
                            </text>
                          )}
                        </For>
                      </box>
                    }
                  >
                    <diff
                      diff={info().diff!}
                      view="unified"
                      filetype={ft()}
                      syntaxStyle={props.block.syntax}
                      showLineNumbers={true}
                      width="100%"
                      wrapMode="word"
                      fg={props.theme.text}
                      addedBg={props.block.diffAddedBg}
                      removedBg={props.block.diffRemovedBg}
                      contextBg={props.block.diffContextBg}
                      addedSignColor={props.block.diffHighlightAdded}
                      removedSignColor={props.block.diffHighlightRemoved}
                      lineNumberFg={props.block.diffLineNumber}
                      lineNumberBg={props.block.diffContextBg}
                      addedLineNumberBg={props.block.diffAddedLineNumberBg}
                      removedLineNumberBg={props.block.diffRemovedLineNumberBg}
                    />
                  </Show>
                  <Show when={!info().diff && info().lines.length === 0}>
                    <box paddingLeft={1}>
                      <text fg={props.theme.muted}>No diff provided</text>
                    </box>
                  </Show>
                </box>
              </scrollbox>
            </Match>
            <Match when={true}>
              <scrollbox
                width="100%"
                height="100%"
                verticalScrollbarOptions={{
                  trackOptions: {
                    backgroundColor: props.theme.surface,
                    foregroundColor: props.theme.line,
                  },
                }}
              >
                <box width="100%" flexDirection="column" gap={1} paddingLeft={1}>
                  <For each={permissionAlwaysLines(props.request)}>
                    {(line) => (
                      <text fg={props.theme.text} wrapMode="word">
                        {line}
                      </text>
                    )}
                  </For>
                </box>
              </scrollbox>
            </Match>
          </Switch>
        </box>

        <box
          id="run-direct-footer-permission-actions"
          flexDirection={narrow() ? "column" : "row"}
          flexShrink={0}
          backgroundColor={props.theme.pane}
          gap={1}
          paddingTop={1}
          paddingLeft={2}
          paddingRight={3}
          paddingBottom={1}
          justifyContent={narrow() ? "flex-start" : "space-between"}
          alignItems={narrow() ? "flex-start" : "center"}
        >
          {buttons(
            opts(),
            state().selected,
            props.theme,
            busy(),
            (option) => {
              setState((prev) => permissionHover(prev, option))
            },
            run,
          )}
          <Show
            when={!busy()}
            fallback={
              <text fg={props.theme.muted} wrapMode="word" flexShrink={0}>
                Waiting for permission event...
              </text>
            }
          >
            <box flexDirection="row" gap={2} flexShrink={0}>
              <text fg={props.theme.text}>
                {"⇆"} <span style={{ fg: props.theme.muted }}>select</span>
              </text>
              <text fg={props.theme.text}>
                enter <span style={{ fg: props.theme.muted }}>confirm</span>
              </text>
              <text fg={props.theme.text}>
                esc <span style={{ fg: props.theme.muted }}>{state().stage === "always" ? "cancel" : "reject"}</span>
              </text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
