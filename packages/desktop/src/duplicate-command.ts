import { base64Encode } from "@opencode-ai/util/encode"

type Fork = { data?: { id: string } | null }

export type State = {
  current(): unknown
  cursor(): number | undefined
  set(value: unknown, cursor?: number, scope?: unknown): void
}

export type SDK = {
  directory: string
  client: {
    session: {
      fork: (opts: { sessionID: string }) => Promise<Fork>
    }
  }
}

export function duplicateSession(opts: {
  id?: string
  t: (key: string) => string
  prompt: State
  sdk: SDK
  navigate: (href: string) => void
  toast: (opts: { title: string; description?: string }) => void
  frame: (cb: FrameRequestCallback) => void
}) {
  if (!opts.id) return Promise.resolve()

  const value = opts.prompt.current()
  const cursor = opts.prompt.cursor()
  const dir = base64Encode(opts.sdk.directory)

  return opts.sdk.client.session
    .fork({ sessionID: opts.id })
    .then((result: Fork) => {
      if (!result.data) {
        opts.toast({ title: opts.t("common.requestFailed") })
        return
      }

      opts.navigate(`/${dir}/session/${result.data.id}`)
      opts.frame(() => {
        opts.prompt.set(value, cursor)
      })
    })
    .catch((err: unknown) => {
      opts.toast({
        title: opts.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
}

export function duplicateCommand(opts: {
  id?: string
  t: (key: string) => string
  prompt: State
  sdk: SDK
  navigate: (href: string) => void
  toast: (opts: { title: string; description?: string }) => void
  frame: (cb: FrameRequestCallback) => void
}) {
  return {
    id: "desktop.session.duplicate",
    title: opts.t("command.session.duplicate"),
    description: opts.t("command.session.duplicate.description"),
    slash: "duplicate",
    disabled: !opts.id,
    onSelect: () => duplicateSession(opts),
  }
}
