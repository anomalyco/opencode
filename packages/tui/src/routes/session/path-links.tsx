import type { Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { generateSyntax } from "@opencode/theme/tui"
import os from "node:os"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { openFileAtLocation, openFilesAtLocation } from "../../editor"
import { Keymap } from "../../context/keymap"
import { createSyntaxStyleMemo, useTheme, useThemes } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import {
  applyPathLinkMarkers,
  detectPathLinks,
  matchPathLinkDigit,
  pathLinkSelectionTag,
  pathLinkTag,
  togglePathLinkSelection,
  type DetectedPathLink,
  type PathLinkDetection,
  type PathLinkPart,
} from "../../util/file-links"
import { truncateMiddle } from "@opencode/util/path"

const AMBIGUOUS_DELAY_MS = 600
const MAX_SELECTION = 10
const MODE = "path-links"

type PathLinkState = {
  links: readonly DetectedPathLink[]
  detection: PathLinkDetection
  digits: string
  notice?: string
  multi: boolean
  selected: ReadonlySet<number>
}

/**
 * Numbers paths in the last completed assistant response and lets the reader
 * open one by typing its number, or check several with `m`/`a` and open them
 * together. Detection happens once on activation so the markers cannot shift
 * while the reader is typing.
 */
export function createPathLinks(input: {
  messages: () => readonly SessionMessageInfo[]
  base: () => string | undefined
}) {
  const renderer = useRenderer()
  const toast = useToast()
  const keymap = Keymap.use()
  const theme = useTheme()
  const themes = useThemes()
  const [state, setState] = createSignal<PathLinkState>()
  const active = createMemo(() => state() !== undefined)
  // The tags ride inside the Markdown source, so recolor the one inline scope
  // they use for as long as the picker is open.
  const markerSyntax = createSyntaxStyleMemo(() =>
    generateSyntax(themes.currentTokens(), renderer.nativeScene, {
      "markup.strikethrough": theme.text.feedback.error.base,
    }),
  )
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
    const detection = detectPathLinks(parts, { base, home: os.homedir() })
    if (!detection.links.length) {
      toast.show({ message: "No paths in the last response", variant: "info", duration: 2500 })
      return
    }
    const focused = renderer.currentFocusedEditor
    if (focused) {
      restoreFocus = focused
      focused.blur()
    }
    setState({ links: detection.links, detection, digits: "", multi: false, selected: new Set<number>() })
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
      commit(result.exact)
      return
    }
    setState({ ...current, digits: result.digits, notice: undefined })
    // A complete number that is also a prefix (1 of 1x) waits briefly so a
    // reader typing 12 does not pick 1 by accident.
    if (result.exact) {
      const target = result.exact
      timer = setTimeout(() => {
        timer = undefined
        commit(target)
      }, AMBIGUOUS_DELAY_MS)
    }
  }

  function commit(link: DetectedPathLink) {
    if (state()?.multi) return toggle(link.index)
    void open(link)
  }

  function toggle(index: number) {
    const current = state()
    if (!current) return
    clearTimer()
    const result = togglePathLinkSelection(current.selected, index, MAX_SELECTION)
    if (result.capped) {
      setState({ ...current, digits: "", notice: `Select up to ${MAX_SELECTION} paths` })
      return
    }
    setState({ ...current, digits: "", notice: undefined, selected: result.selected })
  }

  function toggleMulti() {
    const current = state()
    if (!current) return
    clearTimer()
    setState({ ...current, multi: !current.multi, digits: "", notice: undefined, selected: new Set<number>() })
  }

  function selectAll() {
    const current = state()
    if (!current) return
    clearTimer()
    if (current.multi && current.selected.size) {
      setState({ ...current, digits: "", notice: undefined, selected: new Set<number>() })
      return
    }
    const selected = new Set(current.links.slice(0, MAX_SELECTION).map((link) => link.index))
    setState({
      ...current,
      multi: true,
      digits: "",
      selected,
      notice:
        current.links.length > MAX_SELECTION ? `Selected first ${MAX_SELECTION} of ${current.links.length}` : undefined,
    })
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
    if (current.multi) {
      if (!current.selected.size) {
        setState({ ...current, digits: "", notice: "No paths selected" })
        return
      }
      void openSelected(current)
      return
    }
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

  async function openSelected(current: PathLinkState) {
    const links = current.links.filter((link) => current.selected.has(link.index))
    clearTimer()
    close()
    const present = links.filter((link) => link.exists)
    const missing = links.length - present.length
    if (!present.length) {
      toast.show({ message: "No selected paths exist", variant: "warning", duration: 4000 })
      return
    }
    toast.show({ message: `Opening ${present.length} paths`, variant: "info", duration: 2000 })
    const result = await openFilesAtLocation({
      files: present.map((link) => ({ path: link.path, line: link.line, column: link.column })),
      renderer,
    }).catch((error) => {
      toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
      return
    })
    if (!result) return
    const reasons = [...(missing ? [`${missing} missing`] : []), ...result.failures.map((failure) => failure.message)]
    if (!reasons.length) {
      toast.show({ message: `Opened ${result.opened} paths`, variant: "info", duration: 2500 })
      return
    }
    const detail = `${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`
    toast.show({
      message: result.opened ? `Opened ${result.opened} · ${detail}` : detail,
      variant: result.opened ? "warning" : "error",
      duration: 5000,
    })
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
      { bind: "m", title: "Select multiple paths", group: "Paths", run: toggleMulti },
      { bind: "a", title: "Select all paths", group: "Paths", run: selectAll },
      { bind: "escape", title: "Close path picker", group: "Paths", run: close },
    ],
  }))

  return {
    active,
    state,
    activate,
    close,
    /** Returns the part text with markers, or undefined to leave it unchanged. */
    mark(partID: string, text: string) {
      const current = state()
      if (!current) return
      const part = current.detection.parts.get(partID)
      if (!part || part.text !== text) return
      return applyPathLinkMarkers(
        text,
        part.markers,
        current.multi ? (index) => pathLinkSelectionTag(index, current.selected.has(index)) : pathLinkTag,
      )
    },
    /** The red tag syntax for a part that currently shows markers. */
    syntax(partID: string) {
      const current = state()
      if (!current || !current.detection.parts.has(partID)) return
      return markerSyntax()
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
        const exact = createMemo(() =>
          state().multi ? undefined : state().links.find((link) => String(link.index) === state().digits),
        )
        const counter = createMemo(() => {
          if (state().digits) return `#${state().digits}`
          if (state().multi) return `${state().selected.size}/${state().links.length}`
          return `${state().links.length}`
        })
        const hints = createMemo(() => {
          if (exact())
            return [
              { key: "enter", label: "open" },
              { key: "esc", label: "close" },
            ]
          if (state().digits)
            return [
              { key: "enter", label: "open" },
              { key: "backspace", label: "edit" },
              { key: "esc", label: "close" },
            ]
          if (state().multi)
            return [
              { key: "●○", label: "toggle" },
              { key: "a", label: "all" },
              { key: "enter", label: "open" },
              { key: "m", label: "single" },
              { key: "esc", label: "close" },
            ]
          return [
            { key: "type", label: "a number" },
            { key: "m", label: "multi" },
            { key: "a", label: "all" },
            { key: "esc", label: "close" },
          ]
        })
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
            <text
              fg={state().digits || state().multi ? theme.text.formfield.selected : theme.text.muted}
              wrapMode="none"
              flexShrink={0}
            >
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
