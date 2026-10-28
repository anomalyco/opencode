import type { Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { truncateMiddle } from "@opencode/util/path"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { openFileAtLocation } from "../../editor"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import {
  applyPathLinkMarkers,
  detectPathLinks,
  matchPathLinkDigit,
  type DetectedPathLink,
  type PathLinkDetection,
  type PathLinkPart,
} from "../../util/file-links"

const AMBIGUOUS_DELAY_MS = 600
const MODE = "path-links"

type PathLinkState = {
  links: readonly DetectedPathLink[]
  detection: PathLinkDetection
  digits: string
  notice?: string
}

/**
 * Numbers paths in the last completed assistant response and lets the reader
 * open one by typing its number. Detection happens once on activation so the
 * markers cannot shift while the reader is typing.
 */
export function createPathLinks(input: {
  messages: () => readonly SessionMessageInfo[]
  base: () => string | undefined
}) {
  const renderer = useRenderer()
  const toast = useToast()
  const keymap = Keymap.use()
  const [state, setState] = createSignal<PathLinkState>()
  const active = createMemo(() => state() !== undefined)
  let restoreFocus: Renderable | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  createEffect(() => {
    if (!active()) return
    onCleanup(keymap.mode.push(MODE))
  })
  onCleanup(clearTimer)

  function activate() {
    if (state()) {
      close()
      return
    }
    const parts = collectParts(input.messages())
    if (!parts) {
      toast.show({ message: "No completed response to scan for paths", variant: "info", duration: 2500 })
      return
    }
    const base = input.base()
    if (!base) {
      toast.show({ message: "No working directory for this session", variant: "warning", duration: 3000 })
      return
    }
    const detection = detectPathLinks(parts, { base })
    if (!detection.links.length) {
      toast.show({ message: "No paths in the last response", variant: "info", duration: 2500 })
      return
    }
    const focused = renderer.currentFocusedEditor
    if (focused) {
      restoreFocus = focused
      focused.blur()
    }
    setState({ links: detection.links, detection, digits: "" })
  }

  function close() {
    clearTimer()
    const focus = restoreFocus
    restoreFocus = undefined
    setState(undefined)
    if (focus && !focus.isDestroyed) focus.focus()
  }

  function press(digit: string) {
    const current = state()
    if (!current) return
    clearTimer()
    const result = matchPathLinkDigit(current.links, current.digits, digit)
    if (result.invalid) {
      setState({ ...current, digits: "", notice: `No path ${result.attempted}` })
      return
    }
    if (result.exact && result.matches.length === 1) {
      void open(result.exact)
      return
    }
    setState({ ...current, digits: result.digits, notice: undefined })
    // A complete number that is also a prefix (1 of 1x) waits briefly so a
    // reader typing 12 does not pick 1 by accident.
    if (result.exact) {
      const target = result.exact
      timer = setTimeout(() => {
        timer = undefined
        void open(target)
      }, AMBIGUOUS_DELAY_MS)
    }
  }

  function backspace() {
    const current = state()
    if (!current) return
    clearTimer()
    setState({ ...current, digits: current.digits.slice(0, -1), notice: undefined })
  }

  function enter() {
    const current = state()
    if (!current) return
    clearTimer()
    if (!current.digits) return close()
    const exact = current.links.find((link) => String(link.index) === current.digits)
    if (exact) return open(exact)
    setState({ ...current, digits: "", notice: `No path ${current.digits}` })
  }

  async function open(link: DetectedPathLink) {
    clearTimer()
    close()
    if (!link.exists) {
      toast.show({ message: `Path not found: ${link.path}`, variant: "warning", duration: 4000 })
      return
    }
    toast.show({ message: `Opening ${locationLabel(link)}`, variant: "info", duration: 2000 })
    await openFileAtLocation({
      path: link.path,
      line: link.line,
      column: link.column,
      renderer,
    }).catch((error) => toast.show({ message: errorMessage(error), variant: "error", duration: 5000 }))
  }

  Keymap.createLayer(() => ({
    mode: MODE,
    enabled: () => state() !== undefined,
    commands: [
      ..."0123456789".split("").map((digit) => ({
        bind: digit,
        title: `Choose path ${digit}`,
        group: "Paths",
        run: () => press(digit),
      })),
      { bind: "backspace", title: "Edit path number", group: "Paths", run: backspace },
      { bind: "return", title: "Open numbered path", group: "Paths", run: enter },
      { bind: "escape", title: "Close path picker", group: "Paths", run: close },
    ],
  }))

  return {
    state,
    activate,
    close,
    /** Returns the part text with markers, or undefined to leave it unchanged. */
    mark(partID: string, text: string) {
      const current = state()
      if (!current) return
      const part = current.detection.parts.get(partID)
      if (!part || part.text !== text) return
      return applyPathLinkMarkers(text, part.markers)
    },
  }
}

function collectParts(messages: readonly SessionMessageInfo[]) {
  const message = messages.findLast(
    (item): item is SessionMessageAssistant => item.type === "assistant" && item.time.completed !== undefined,
  )
  if (!message) return
  const parts: PathLinkPart[] = []
  let ordinal = 0
  for (const part of message.content) {
    if (part.type !== "text") continue
    const id = `text:${ordinal++}`
    if (!part.text.trim()) continue
    parts.push({ id, text: part.text.trim() })
  }
  return parts.length ? parts : undefined
}

function locationLabel(link: DetectedPathLink) {
  const suffix = link.line ? `${link.line}${link.column ? `:${link.column}` : ""}` : undefined
  return suffix ? `${link.path}:${suffix}` : link.path
}

export function PathLinksBar(props: { state: PathLinkState | undefined }) {
  const theme = useTheme()
  return (
    <Show when={props.state}>
      {(state) => {
        const exact = createMemo(() => state().links.find((link) => String(link.index) === state().digits))
        const counter = createMemo(() => (state().digits ? `#${state().digits}` : `${state().links.length}`))
        const hints = createMemo(() =>
          exact() || state().digits
            ? [
                { key: "enter", label: "open" },
                { key: "backspace", label: "edit" },
                { key: "esc", label: "close" },
              ]
            : [
                { key: "type", label: "a number" },
                { key: "esc", label: "close" },
              ],
        )
        return (
          <box
            height={1}
            flexShrink={0}
            flexDirection="row"
            gap={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={theme.background.raised.base}
          >
            <text fg={theme.text.formfield.selected} wrapMode="none" flexShrink={0}>
              ●
            </text>
            <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
              Paths
            </text>
            <text fg={state().digits ? theme.text.formfield.selected : theme.text.muted} wrapMode="none" flexShrink={0}>
              {counter()}
            </text>
            <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
              ·
            </text>
            <Show
              when={state().notice}
              fallback={
                <Show when={exact()} fallback={<Hints hints={hints()} />}>
                  {(link) => (
                    <>
                      <text fg={theme.text.base} wrapMode="none" flexShrink={1} truncate>
                        {truncateMiddle(link().display, 56)}
                      </text>
                      <Hints hints={hints()} />
                    </>
                  )}
                </Show>
              }
            >
              {(notice) => (
                <text fg={theme.text.feedback.warning.base} wrapMode="none" flexShrink={0}>
                  {notice()}
                </text>
              )}
            </Show>
          </box>
        )
      }}
    </Show>
  )
}

function Hints(props: { hints: readonly { key: string; label: string }[] }) {
  const theme = useTheme()
  return (
    <text fg={theme.text.muted} wrapMode="none" flexShrink={1} truncate>
      {props.hints.map((hint, position) => (
        <>
          {position > 0 ? <span style={{ fg: theme.text.muted }}> · </span> : undefined}
          <span style={{ fg: theme.text.base }}>{hint.key}</span>
          <span style={{ fg: theme.text.muted }}> {hint.label}</span>
        </>
      ))}
    </text>
  )
}
