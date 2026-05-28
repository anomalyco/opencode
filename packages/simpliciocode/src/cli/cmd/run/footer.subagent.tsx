/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import "opentui-spinner/solid"
import { Show, createMemo, indexArray } from "solid-js"
import { SPINNER_FRAMES } from "../tui/component/spinner"
import { RunEntryContent, separatorRows } from "./scrollback.writer"
import type { FooterSubagentDetail, FooterSubagentTab, RunDiffStyle } from "./types"
import type { RunFooterTheme, RunTheme } from "./theme"

export const SUBAGENT_INSPECTOR_ROWS = 14

function statusColor(theme: RunFooterTheme, status: FooterSubagentTab["status"]) {
  if (status === "completed") {
    return theme.highlight
  }

  if (status === "error") {
    return theme.error
  }

  return theme.highlight
}

function statusIcon(status: FooterSubagentTab["status"]) {
  if (status === "completed") {
    return "●"
  }

  if (status === "error") {
    return "◍"
  }

  return "◔"
}

export function RunFooterSubagentBody(props: {
  active: () => boolean
  theme: () => RunTheme
  tab: () => FooterSubagentTab | undefined
  index: () => number
  total: () => number
  detail: () => FooterSubagentDetail | undefined
  width: () => number
  diffStyle?: RunDiffStyle
  onCycle: (dir: -1 | 1) => void
  onClose: () => void
}) {
  const theme = createMemo(() => props.theme())
  const footer = createMemo(() => theme().footer)
  const tab = createMemo(() => props.tab())
  const commits = createMemo(() => props.detail()?.commits ?? [])
  const opts = createMemo(() => ({ diffStyle: props.diffStyle }))
  const scrollbar = createMemo(() => ({
    trackOptions: {
      backgroundColor: footer().surface,
      foregroundColor: footer().line,
    },
  }))
  const title = createMemo(() => {
    const current = tab()
    if (!current) {
      return ""
    }

    return current.description || current.title || current.label
  })
  const subtitle = createMemo(() => {
    const current = tab()
    if (!current || title() === current.label) {
      return ""
    }

    return current.label
  })
  const rows = indexArray(commits, (commit, index) => (
    <box flexDirection="column" gap={0} flexShrink={0}>
      {index > 0 && separatorRows(commits()[index - 1], commit()) > 0 ? <box height={1} flexShrink={0} /> : null}
      <RunEntryContent commit={commit()} theme={theme()} opts={opts()} width={props.width()} />
    </box>
  ))
  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((event) => {
    if (!props.active()) {
      return
    }

    if (event.name === "escape") {
      event.preventDefault()
      props.onClose()
      return
    }

    if (event.name === "tab" && !event.shift) {
      event.preventDefault()
      props.onCycle(1)
      return
    }

    if (event.name === "up" || event.name === "k") {
      event.preventDefault()
      scroll?.scrollBy(-1)
      return
    }

    if (event.name === "down" || event.name === "j") {
      event.preventDefault()
      scroll?.scrollBy(1)
    }
  })

  return (
    <box
      id="run-direct-footer-subagent"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={footer().surface}
    >
      <box paddingTop={1} paddingLeft={1} paddingRight={3} paddingBottom={1} flexDirection="column" flexGrow={1}>
        <Show when={tab()}>
          {(current) => (
            <box width="100%" flexDirection="row" gap={1} paddingBottom={1} flexShrink={0}>
              {current().status === "running" ? (
                <box flexShrink={0}>
                  <spinner frames={SPINNER_FRAMES} interval={80} color={statusColor(footer(), current().status)} />
                </box>
              ) : (
                <text fg={statusColor(footer(), current().status)} wrapMode="none" truncate flexShrink={0}>
                  {statusIcon(current().status)}
                </text>
              )}
              <text fg={footer().text} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                {title()}
                <Show when={subtitle().length > 0}>
                  <span style={{ fg: footer().muted }}>{"  " + subtitle()}</span>
                </Show>
              </text>
              <Show when={props.total() > 1 && props.index() > 0}>
                <text fg={footer().muted} wrapMode="none" truncate flexShrink={0}>
                  {props.index()} of {props.total()}
                </text>
              </Show>
            </box>
          )}
        </Show>
        <scrollbox
          width="100%"
          height="100%"
          stickyScroll={true}
          stickyStart="bottom"
          verticalScrollbarOptions={scrollbar()}
          ref={(item) => {
            scroll = item
          }}
        >
          <box width="100%" flexDirection="column" gap={0}>
            {commits().length > 0 ? (
              rows()
            ) : (
              <text fg={footer().muted} wrapMode="word">
                No subagent activity yet
              </text>
            )}
          </box>
        </scrollbox>
      </box>
    </box>
  )
}
