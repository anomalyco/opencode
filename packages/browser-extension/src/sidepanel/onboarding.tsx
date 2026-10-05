// Setup pieces shared by the welcome tab and the side panel: the install command, re-checking the opencode
// service while the user sets it up, how to allow user scripts, and how to fix Browser Control.
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, createEffect, createSignal, onCleanup } from "solid-js"
import type { RelayStatus, ServiceState } from "../shared/protocol"

/** Works with any opencode release; the helper ships as an npm package (packages/browser-extension/cli). */
export const INSTALL_COMMAND = "npx opencode-browser-cli install"

/** An error message that reads as a sentence before more text follows it. */
export function sentence(message: string) {
  const text = message.trim()
  return /[.!?]$/.test(text) ? text : `${text}.`
}

type ServiceError = Extract<ServiceState, { status: "error" }>

/**
 * The service state to show while the user fixes setup. A re-check keeps showing the last error instead of
 * flashing a spinner, and an error re-checks itself so running the install command is enough to connect.
 */
export function createServiceWatch(input: { state: () => ServiceState; refresh: () => void }) {
  const [held, setHeld] = createSignal<ServiceError>()
  // Only a re-check the user asked for shows progress; automatic ones stay quiet.
  const [manual, setManual] = createSignal(false)
  createEffect(() => {
    const state = input.state()
    if (state.status === "error") setHeld(state)
    if (state.status === "ready") setHeld(undefined)
    if (state.status !== "loading") setManual(false)
  })
  createEffect(() => {
    const error = held()
    if (!error) return
    const check = () => {
      if (document.visibilityState === "visible" && input.state().status === "error") input.refresh()
    }
    // The helper fails fast while it is missing; a running but unreachable server is checked less often.
    const timer = setInterval(check, error.hostMissing ? 3_000 : 10_000)
    document.addEventListener("visibilitychange", check)
    onCleanup(() => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
    })
  })
  return {
    state: (): ServiceState => {
      const state = input.state()
      return state.status === "loading" ? (held() ?? state) : state
    },
    checking: () => manual() && input.state().status === "loading",
    retry() {
      setManual(true)
      input.refresh()
    },
  }
}

/** A terminal command with a copy button. */
export function CommandBlock(props: { command: string; class?: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = () => {
    void navigator.clipboard.writeText(props.command).then(() => {
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), 1_500)
    })
  }
  return (
    <div
      data-component="command-block"
      class={`flex h-9 min-w-0 items-center gap-2 rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-01 ps-3 pe-1 ${props.class ?? ""}`}
    >
      <span aria-hidden="true" class="shrink-0 font-mono text-12-regular text-v2-text-text-faint select-none">
        $
      </span>
      <code class="min-w-0 flex-1 truncate font-mono text-12-regular text-v2-text-text-base select-all">
        {props.command}
      </code>
      <Tooltip placement="top" value={copied() ? "Copied" : "Copy"}>
        <IconButton
          variant="ghost-muted"
          size="normal"
          class="shrink-0"
          icon={<Icon name={copied() ? "check-small" : "copy"} size="small" />}
          aria-label={copied() ? "Copied" : `Copy ${props.command}`}
          onClick={copy}
        />
      </Tooltip>
    </div>
  )
}

export function openExtensionsPage(details = true) {
  void chrome.tabs.create({ url: details ? `chrome://extensions/?id=${chrome.runtime.id}` : "chrome://extensions/" })
}

/** How to allow user scripts, which Chromium keeps off per extension until the user turns it on. */
export function UserScriptsSteps(props: { onCheck: () => void; class?: string }) {
  return (
    <div class={`flex flex-col gap-2.5 ${props.class ?? ""}`}>
      <p class="text-12-regular leading-[18px] text-v2-text-text-muted">
        On OpenCode Browser's details page, turn on{" "}
        <span class="font-[530] text-v2-text-text-base">Allow user scripts</span>. Some browsers ask for{" "}
        <span class="font-[530] text-v2-text-text-base">Developer mode</span> first, at the top of the extensions
        page.
      </p>
      <div class="flex flex-wrap items-center gap-1">
        <Button variant="neutral" size="small" onClick={() => openExtensionsPage()}>
          Open details page
          <Icon name="square-arrow-top-right" size="small" />
        </Button>
        <Button variant="ghost" size="small" onClick={() => props.onCheck()}>
          Check again
        </Button>
      </div>
    </div>
  )
}

export type RelayProblem = Extract<RelayStatus, "conflict" | "rejected" | "incompatible">

export function relayProblem(status: RelayStatus): RelayProblem | undefined {
  return status === "conflict" || status === "rejected" || status === "incompatible" ? status : undefined
}

const problems: Record<RelayProblem, { title: string; short: string; body: string; command?: string }> = {
  conflict: {
    title: "The Browser Control extension is also installed",
    short: "Browser Control extension conflict",
    body: "It holds Browser Control's connection, so agents can't reach OpenCode Browser. Turn it off or remove it, then reconnect.",
  },
  rejected: {
    title: "Browser Control refused to connect",
    short: "Browser Control refused to connect",
    body: "Its relay is older than OpenCode Browser. Restart it, and update Browser Control if this keeps happening:",
    command: "browser-control relay restart",
  },
  incompatible: {
    title: "Browser Control needs an update",
    short: "Browser Control needs an update",
    body: "Browser Control and OpenCode Browser speak different versions. Update Browser Control, then restart its relay:",
    command: "browser-control relay restart",
  },
}

export function relayProblemTitle(problem: RelayProblem, short = false) {
  return short ? problems[problem].short : problems[problem].title
}

/** What went wrong with Browser Control and how to fix it. */
export function RelayProblemFix(props: { problem: RelayProblem; onReconnect: () => void; hideTitle?: boolean }) {
  const info = () => problems[props.problem]
  return (
    <div class="flex min-w-0 flex-col gap-2.5">
      <div class="flex min-w-0 flex-col gap-0.5">
        {props.hideTitle ? null : (
          <span class="text-12-medium leading-[18px] text-v2-text-text-base">{info().title}</span>
        )}
        <p class="text-12-regular leading-[18px] text-v2-text-text-muted">{info().body}</p>
      </div>
      {info().command ? <CommandBlock command={info().command!} /> : null}
      <div class="flex flex-wrap items-center gap-1">
        {props.problem === "conflict" ? (
          <Button variant="neutral" size="small" onClick={() => openExtensionsPage(false)}>
            Open extensions
            <Icon name="square-arrow-top-right" size="small" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="small"
          classList={{ "-ms-2": props.problem !== "conflict" }}
          onClick={() => props.onReconnect()}
        >
          Reconnect
        </Button>
      </div>
    </div>
  )
}

/** The toolbar shortcut that opens the panel, as key caps; empty when the user removed it. */
export function createShortcut() {
  const [keys, setKeys] = createSignal<string[]>([])
  const read = () =>
    void chrome.commands.getAll().then((commands) => {
      const shortcut = commands.find((command) => command.name === "_execute_action")?.shortcut ?? ""
      setKeys(splitShortcut(shortcut))
    })
  read()
  // The user may change it on the shortcuts page and come back.
  window.addEventListener("focus", read)
  onCleanup(() => window.removeEventListener("focus", read))
  return keys
}

function splitShortcut(shortcut: string) {
  if (!shortcut) return []
  if (shortcut.includes("+")) return shortcut.split("+").map((key) => (key === "Period" ? "." : key))
  // macOS reports symbols without separators ("⇧⌘."); show them in the usual ⌘⇧ order.
  const order = ["⌃", "⌥", "⌘", "⇧"]
  const chars = Array.from(shortcut)
  const modifiers = chars.filter((char) => order.includes(char)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const rest = chars.filter((char) => !order.includes(char)).join("")
  return [...modifiers, rest]
}

export function KeyCaps(props: { keys: string[] }) {
  return (
    <span class="inline-flex items-center gap-1 align-middle">
      <For each={props.keys}>
        {(key) => (
          <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-1 font-(family-name:--font-family-text) text-12-medium leading-none text-v2-text-text-muted shadow-[0_1px_0_var(--v2-border-border-muted)]">
            {key}
          </kbd>
        )}
      </For>
    </span>
  )
}

/** A live "still checking" line with a manual re-check. */
export function Waiting(props: { checking: boolean; onRetry: () => void; children: string }) {
  return (
    <div class="mt-2 flex min-h-7 items-center gap-3">
      <span class="flex min-w-0 flex-1 items-start gap-2 text-12-regular leading-[18px] text-v2-text-text-faint">
        <span class="relative mt-[5px] flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
          <span class="absolute size-2 animate-ping rounded-full bg-v2-icon-icon-faint opacity-40" />
          <span class="size-1.5 rounded-full bg-v2-icon-icon-muted" />
        </span>
        <span class="min-w-0">{props.children}</span>
      </span>
      <Button
        variant="ghost-muted"
        size="small"
        class="-me-2 shrink-0"
        disabled={props.checking}
        onClick={() => props.onRetry()}
      >
        {props.checking ? "Checking…" : "Check now"}
      </Button>
    </div>
  )
}
