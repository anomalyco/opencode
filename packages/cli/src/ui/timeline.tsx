/** @jsxImportSource @opentui/solid */
import { createCliRenderer, RGBA, type CliRenderer, type ColorInput, type ScrollbackWriter } from "@opentui/core"
import { createScrollbackWriter, render, useKeyboard } from "@opentui/solid"
import { registerOpencodeSpinner } from "@opencode-ai/tui/component/register-spinner"
import { Show, createSignal } from "solid-js"

registerOpencodeSpinner()

export type TimelineHost = {
  readonly signal: AbortSignal
  intro(text: string): Promise<void>
  item(text: string): Promise<void>
  pending(text: string): Promise<void>
  success(text: string): Promise<void>
  failure(text: string): Promise<void>
  outro(text: string): Promise<void>
  close(): Promise<void>
}

type RowKind = "intro" | "item" | "success" | "failure" | "outro"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const IDLE_TIMEOUT = 1_000
const COLORS = {
  accent: RGBA.fromIndex(6),
  error: RGBA.fromIndex(1),
  foreground: RGBA.defaultForeground(),
  muted: RGBA.fromIndex(8),
  success: RGBA.fromIndex(2),
}
const ROWS: Record<RowKind, { marker: string; color: ColorInput; connector: boolean }> = {
  intro: { marker: "┌", color: COLORS.muted, connector: true },
  item: { marker: "●", color: COLORS.accent, connector: true },
  success: { marker: "◇", color: COLORS.success, connector: true },
  failure: { marker: "■", color: COLORS.error, connector: false },
  outro: { marker: "└", color: COLORS.muted, connector: false },
}

function row(kind: RowKind, value: string): ScrollbackWriter {
  const style = ROWS[kind]
  return createScrollbackWriter(
    () => (
      <box width="100%" minHeight={1} flexDirection="column">
        <box width="100%" minHeight={1} flexDirection="row" gap={1}>
          <text fg={style.color} flexShrink={0}>
            {style.marker}
          </text>
          <text fg={COLORS.foreground} wrapMode="word">
            {value}
          </text>
        </box>
        <Show when={style.connector}>
          <text fg={COLORS.muted}>│</text>
        </Show>
      </box>
    ),
    { startOnNewLine: true, trailingNewline: !style.connector },
  )
}

function TimelineFooter(props: { pending: () => string | undefined; cancel: () => void }) {
  useKeyboard((event) => {
    if (event.name !== "escape" && !(event.ctrl && event.name === "c")) return
    event.preventDefault()
    props.cancel()
  })

  return (
    <box width="100%" height={1} flexDirection="row" gap={1}>
      <Show when={props.pending()}>
        {(text) => (
          <>
            <spinner frames={SPINNER_FRAMES} interval={80} color={COLORS.accent} />
            <text fg={COLORS.foreground} wrapMode="none" truncate>
              {text()}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

function bounded(task: Promise<unknown>) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, IDLE_TIMEOUT)
    timer.unref()
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    void task.then(finish, finish)
  })
}

async function shutdown(renderer: CliRenderer): Promise<void> {
  await bounded(renderer.idle())
  try {
    renderer.externalOutputMode = "passthrough"
  } finally {
    try {
      renderer.screenMode = "main-screen"
    } finally {
      if (!renderer.isDestroyed) renderer.destroy()
    }
  }
}

export async function createTimelineHost(): Promise<TimelineHost> {
  const stdout = process.stdout
  const controller = new AbortController()
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGHUP", "SIGQUIT"]
  const cancel = () => {
    if (!controller.signal.aborted) controller.abort()
  }
  signals.forEach((signal) => process.on(signal, cancel))

  if (!stdout.isTTY || !process.stdin.isTTY) {
    let closed = false
    let writing = false
    let active: Promise<void> | undefined
    let closeTask: Promise<void> | undefined
    const write = async (kind: RowKind | "pending", text: string) => {
      if (closed) throw new Error("timeline closed")
      if (writing) throw new Error("timeline write already in progress")
      writing = true
      try {
        const style = kind === "pending" ? undefined : ROWS[kind]
        const marker = kind === "pending" ? "." : ROWS[kind].marker
        const connector = style?.connector ? "│\n" : ""
        active = new Promise<void>((resolve, reject) => {
          stdout.write(`${marker} ${text}\n${connector}`, (error) => (error ? reject(error) : resolve()))
        })
        await active
      } finally {
        writing = false
        active = undefined
      }
    }
    const close = () => {
      if (closeTask) return closeTask
      closed = true
      closeTask = (async () => {
        await active?.catch(() => { })
        signals.forEach((signal) => process.off(signal, cancel))
      })()
      return closeTask
    }
    return {
      signal: controller.signal,
      intro: (text) => write("intro", text),
      item: (text) => write("item", text),
      pending: (text) => write("pending", text),
      success: (text) => write("success", text),
      failure: (text) => write("failure", text),
      outro: (text) => write("outro", text),
      close,
    }
  }

  let renderer: CliRenderer | undefined

  try {
    // Start on a fresh row so delayed SSH cursor reports cannot make
    // split-footer overwrite the shell command.
    process.stdout.write("\n")
    renderer = await createCliRenderer({
      stdin: process.stdin,
      useMouse: false,
      autoFocus: false,
      openConsoleOnError: false,
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: "split-footer",
      footerHeight: 1,
      externalOutputMode: "capture-stdout",
      consoleMode: "disabled",
      clearOnShutdown: false,
    })
    const activeRenderer = renderer
    const [pending, setPending] = createSignal<string>()
    const renderTask = render(() => <TimelineFooter pending={pending} cancel={cancel} />, activeRenderer)
    void renderTask.catch(cancel)
    await bounded(activeRenderer.idle())

    let closed = false
    let writing = false
    let active: Promise<void> | undefined
    let closeTask: Promise<void> | undefined
    const write = (kind: RowKind | "pending", text: string) => {
      if (closed) return Promise.reject(new Error("timeline closed"))
      if (writing) return Promise.reject(new Error("timeline write already in progress"))
      writing = true
      active = (async () => {
        if (kind === "pending") {
          setPending(text)
          activeRenderer.requestRender()
        } else {
          if (kind === "success" || kind === "failure" || kind === "outro") setPending(undefined)
          activeRenderer.writeToScrollback(row(kind, text))
          activeRenderer.requestRender()
        }
        await bounded(activeRenderer.idle())
      })().finally(() => {
        writing = false
        active = undefined
      })
      return active
    }
    const close = () => {
      if (closeTask) return closeTask
      closed = true
      closeTask = (async () => {
        await active?.catch(() => { })
        try {
          await shutdown(activeRenderer)
          await bounded(renderTask)
        } finally {
          signals.forEach((signal) => process.off(signal, cancel))
        }
      })()
      return closeTask
    }
    return {
      signal: controller.signal,
      intro: (text) => write("intro", text),
      item: (text) => write("item", text),
      pending: (text) => write("pending", text),
      success: (text) => write("success", text),
      failure: (text) => write("failure", text),
      outro: (text) => write("outro", text),
      close,
    }
  } catch (error) {
    try {
      if (renderer) await shutdown(renderer)
    } finally {
      signals.forEach((signal) => process.off(signal, cancel))
    }
    throw error
  }
}
