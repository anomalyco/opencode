import { onCleanup } from "solid-js"

export type VoiceConfigPatch = {
  url?: string
  apiKey?: string
  model?: string
}

// Voice ships unconfigured, so empty fields are omitted and an all-empty
// input clears the stored config (null) instead of writing blank strings.
export function voiceConfigPatch(input: VoiceConfigPatch): VoiceConfigPatch | null {
  const voice: VoiceConfigPatch = {}

  if (input.url?.trim()) voice.url = input.url.trim()

  if (input.apiKey?.trim()) voice.apiKey = input.apiKey.trim()

  if (input.model?.trim()) voice.model = input.model.trim()

  return Object.keys(voice).length > 0 ? voice : null
}

export type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

export type ShellSelectOption = {
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

export function createSoundPreviewController(player: (id: string | undefined) => Promise<(() => void) | undefined>) {
  let cleanup: (() => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let run = 0

  const stop = () => {
    run += 1
    cleanup?.()
    clearTimeout(timeout)
    cleanup = undefined
    timeout = undefined
  }

  const play = (id: string | undefined) => {
    stop()

    if (!id) return
    const current = ++run
    timeout = setTimeout(() => {
      timeout = undefined
      void player(id).then((next) => {
        if (run === current) {
          cleanup = next

          return
        }

        next?.()
      })
    }, 100)
  }

  onCleanup(stop)

  return { play, stop }
}
