import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { SshConfig, SshItem, SshPlatform } from "./types"
import { isSshConnecting } from "./status"

export function createSshController(input: {
  items: () => readonly SshItem[]
  api: Pick<SshPlatform, "start" | "respond" | "cancel" | "disconnect" | "forget"> | undefined
  refresh: () => Promise<unknown>
  error: () => void
}) {
  const [attempts, setAttempts] = createStore<
    Record<
      string,
      | {
          active: boolean
          submitting: boolean
          prompted: boolean
          answered?: string
          error: boolean
          onConnected?: () => void
        }
      | undefined
    >
  >({})
  // One in-flight request per server; cancelling settles it immediately and ignores its outcome.
  const tasks = new Map<string, { cancelled: boolean }>()
  const item = (id: string) => input.items().find((item) => item.config.id === id)
  const settle = (id: string) => {
    const attempt = attempts[id]
    if (!attempt?.active) return
    const onConnected = attempt.onConnected
    setAttempts(id, { active: false, onConnected: undefined })
    if (item(id)?.stage === "ready" && onConnected) queueMicrotask(onConnected)
  }
  const finish = (id: string, task: { cancelled: boolean }) => {
    if (task.cancelled) return
    task.cancelled = true
    if (tasks.get(id) === task) tasks.delete(id)
    setAttempts(id, "submitting", false)
  }
  const interrupt = (id: string) => {
    const task = tasks.get(id)
    if (task) finish(id, task)
  }
  const run = (id: string, work: () => Promise<unknown>) => {
    setAttempts(id, { submitting: true, error: false })
    const task = { cancelled: false }
    tasks.set(id, task)
    work().then(
      () => finish(id, task),
      () => {
        if (task.cancelled) return
        setAttempts(id, "error", true)
        if (!attempts[id]?.prompted) input.error()
        finish(id, task)
      },
    )
  }
  onCleanup(() => {
    for (const id of [...tasks.keys()]) interrupt(id)
  })
  createEffect(() => {
    for (const item of input.items()) {
      const attempt = attempts[item.config.id]
      if (!attempt?.active || attempt.submitting) continue
      if (
        item.stage === "ready" ||
        item.stage === "failed" ||
        item.stage === "disconnected" ||
        item.authenticatingElsewhere ||
        (attempt.prompted && item.stage === "authentication" && !item.prompt)
      ) {
        settle(item.config.id)
      }
    }
  })
  return {
    item,
    submitting: (id: string) => !!attempts[id]?.submitting,
    error: (id: string) => !!attempts[id]?.error,
    answered: (id: string) =>
      !!item(id)?.prompt && !attempts[id]?.error && attempts[id]?.answered === item(id)?.prompt?.id,
    pending: (id: string) =>
      !!attempts[id]?.submitting ||
      !!item(id)?.authenticatingElsewhere ||
      isSshConnecting(item(id)?.stage ?? "disconnected"),
    dialog: {
      next: () =>
        input.items().find((item) => {
          const attempt = attempts[item.config.id]
          return (
            attempt?.active &&
            !attempt.submitting &&
            !attempt.prompted &&
            !attempt.error &&
            (item.prompt || item.stage === "incompatible")
          )
        }),
      opened: (id: string) => setAttempts(id, "prompted", true),
    },
    connect: (config: SshConfig, options?: { dialog?: boolean; replace?: boolean; onConnected?: () => void }) => {
      const api = input.api
      if (!api || item(config.id)?.authenticatingElsewhere) return
      if (
        attempts[config.id]?.submitting ||
        (attempts[config.id]?.active && !attempts[config.id]?.error && !options?.replace)
      )
        return
      setAttempts(config.id, {
        active: true,
        submitting: true,
        prompted: !!options?.dialog,
        answered: undefined,
        error: false,
        onConnected: options?.onConnected ?? (options?.replace ? attempts[config.id]?.onConnected : undefined),
      })
      run(config.id, async () => {
        await api.start({ ...config, replace: options?.replace })
        // Observe admission before treating an older disconnected snapshot as cancellation.
        await input.refresh()
      })
    },
    respond: (id: string, prompt: string, value: string) => {
      const api = input.api
      if (!api || item(id)?.prompt?.id !== prompt || attempts[id]?.submitting) return
      if (attempts[id]?.answered === prompt && !attempts[id]?.error) return
      setAttempts(id, "answered", prompt)
      run(id, () => api.respond(id, prompt, value))
    },
    cancel: (id: string) => {
      const api = input.api
      interrupt(id)
      setAttempts(id, undefined)
      if (!api) return
      void api
        .cancel(id)
        .then(() => (item(id)?.saved ? undefined : api.forget(id)))
        .catch(() => undefined)
    },
    restore: (config: SshConfig) => input.api?.start({ ...config, background: true }),
    disconnect: (id: string) => input.api?.disconnect(id),
    forget: (id: string) => input.api?.forget(id),
  }
}

