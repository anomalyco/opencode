import { onCleanup } from "solid-js"
import type { ConfigEntry } from "@opencode/client/promise"
import {
  createSoundPreviewState,
  transitionSoundPreview,
  type SoundPreviewEffect,
  type SoundPreviewEvent,
} from "./sound-preview-machine"

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  name: string
  terminalOnly: boolean
}

export function createShellOptions(input: { shells: ShellOption[]; current: string | undefined }) {
  const counts = input.shells.reduce((result, shell) => {
    result.set(shell.name, (result.get(shell.name) ?? 0) + 1)

    return result
  }, new Map<string, number>())

  const options: ShellSelectOption[] = [
    { id: "auto", value: "", name: "", terminalOnly: false },
    ...input.shells.map((shell) => {
      const ambiguous = (counts.get(shell.name) ?? 0) > 1
      const name = ambiguous ? shell.path : shell.name

      return {
        id: shell.path,
        value: ambiguous ? shell.path : shell.name,
        name,
        terminalOnly: !shell.acceptable,
      }
    }),
  ]

  if (input.current && !options.some((option) => option.value === input.current)) {
    options.push({ id: input.current, value: input.current, name: input.current, terminalOnly: false })
  }

  return options
}

/**
 * Whether a server's global config leaves OpenCode Console's task list on: `console_tasks` is on unless one of its config
 * files sets it to false. Console's own document, which has no file, never decides it.
 */
export function consoleTasksEnabled(entries: readonly ConfigEntry[]) {
  const boundary = entries.findIndex((entry) => entry.type === "directory")

  return (
    (boundary === -1 ? entries : entries.slice(0, boundary))
      .flatMap((entry) =>
        entry.type === "document" && entry.path !== undefined && entry.info.console_tasks !== undefined
          ? [entry.info.console_tasks]
          : [],
      )
      .at(-1) !== false
  )
}

export function createSoundPreviewController(player: (id: string | undefined) => Promise<(() => void) | undefined>) {
  let state = createSoundPreviewState()
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: SoundPreviewEvent) => {
    const next = transitionSoundPreview(state, event)
    state = next.state
    next.effects.forEach(run)
  }

  const run = (effect: SoundPreviewEffect) => {
    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(
        () =>
          dispatch(
            effect.kind === "debounce"
              ? { type: "debounce.elapsed", attempt: effect.attempt }
              : { type: "load.timed-out", attempt: effect.attempt },
          ),
        effect.delayMs,
      )

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "audio.load") {
      void Promise.try(() => player(effect.id)).then(
        (active) => dispatch({ type: "load.succeeded", attempt: effect.attempt, active }),
        () => dispatch({ type: "load.failed", attempt: effect.attempt }),
      )

      return
    }

    effect.active()
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    play: (id: string | undefined) => dispatch({ type: "play.requested", id }),
    stop: () => dispatch({ type: "stop.requested" }),
  }
}
