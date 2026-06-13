import { Button } from "@cedric/ui/button"
import { Icon } from "@cedric/ui/icon"
import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { Terminal } from "@/components/terminal"
import { useLanguage } from "@/context/language"
import { type LocalPTY, useTerminal } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"

export function TerminalTab(props: {
  active?: boolean
  ptyId?: string
  onPtyChange?: (id: string) => void
  onTitleChange?: (title: string) => void
}) {
  const language = useLanguage()
  const terminal = useTerminal()
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string>()
  let lastTitle: string | undefined

  const pty = createMemo(() => terminal.all().find((item) => item.id === props.ptyId))

  const titleFor = (pty: LocalPTY) =>
    terminalTabLabel({
      title: pty.title,
      titleNumber: pty.titleNumber,
      t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
    })

  const emitTitle = (pty: LocalPTY) => {
    const title = titleFor(pty)
    if (title === lastTitle) return
    lastTitle = title
    props.onTitleChange?.(title)
  }

  const startTerminal = () => {
    if (creating()) return
    setError(undefined)
    setCreating(true)
    void terminal
      .create()
      .then((next) => {
        if (!next) {
          setError("Could not create a terminal session.")
          setCreating(false)
          return
        }
        props.onPtyChange?.(next.id)
        emitTitle(next)
        setCreating(false)
      })
      .catch((err: unknown) => {
        setCreating(false)
        setError(err instanceof Error ? err.message : "Could not create a terminal session.")
      })
  }

  const recoverTerminal = (id: string, err: unknown) => {
    setError(err instanceof Error ? err.message : "Terminal connection was lost.")
    void terminal.clone(id).then((next) => {
      if (!next) return
      setError(undefined)
      props.onPtyChange?.(next.id)
      emitTitle(next)
    })
  }

  createEffect(() => {
    if (!props.active) return
    if (!terminal.ready()) return
    if (pty()) return
    if (creating() || error()) return
    startTerminal()
  })

  createEffect(() => {
    const current = pty()
    if (!current) return
    emitTitle(current)
  })

  return (
    <div class="size-full bg-background-stronger">
      <Show
        when={terminal.ready() && pty()}
        keyed
        fallback={
          <div class="size-full flex items-center justify-center p-6 bg-background-base">
            <div class="flex flex-col items-center text-center max-w-sm gap-4">
              <div class="w-16 h-16 rounded-2xl bg-background-stronger flex items-center justify-center">
                <Icon name="terminal" class="w-8 h-8 text-text-weak" />
              </div>
              <div class="space-y-1">
                <div class="text-18-semibold text-text-base">{language.t("terminal.title")}</div>
                <div class="text-14-regular text-text-weak">
                  {error() ?? (creating() ? language.t("terminal.loading") : language.t("common.loading"))}
                </div>
              </div>
              <Show when={error()}>
                <Button size="small" variant="secondary" icon="reset" onClick={startTerminal}>
                  Retry
                </Button>
              </Show>
            </div>
          </div>
        }
      >
        {(current) => (
          <Show when={props.active} fallback={<div class="size-full bg-background-stronger" />}>
            <Terminal
              pty={current}
              autoFocus={props.active}
              onCleanup={(next) => terminal.update(next)}
              onConnect={() => terminal.trim(current.id)}
              onConnectError={(err) => recoverTerminal(current.id, err)}
            />
          </Show>
        )}
      </Show>
    </div>
  )
}
