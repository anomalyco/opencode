import type { FooterApi, FooterEvent, RunPrompt, StreamCommit } from "../../../src/mini/types"

export function createFooterApiFixture(input: { events?: FooterEvent[]; commits?: StreamCommit[] } = {}) {
  const prompts = new Set<(input: RunPrompt) => void>()
  const closes = new Set<() => void>()
  let ready!: () => void
  const promptReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  const events = input.events ?? []
  const commits = input.commits ?? []
  const calls: Array<{ type: "event"; value: FooterEvent } | { type: "commit"; value: StreamCommit }> = []
  let closed = false

  const api: FooterApi = {
    get isClosed() {
      return closed
    },
    onPrompt(fn) {
      prompts.add(fn)
      ready()
      return () => prompts.delete(fn)
    },
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }
      closes.add(fn)
      return () => closes.delete(fn)
    },
    event(next) {
      events.push(next)
      calls.push({ type: "event", value: next })
    },
    append(next) {
      commits.push(next)
      calls.push({ type: "commit", value: next })
    },
    idle: () => Promise.resolve(),
    close() {
      if (closed) return
      closed = true
      for (const fn of [...closes]) fn()
    },
    destroy() {
      api.close()
      prompts.clear()
      closes.clear()
    },
  }

  return {
    api,
    events,
    commits,
    calls,
    promptReady,
    submit(text: string, mode?: RunPrompt["mode"]) {
      if (prompts.size === 0) return false
      const prompt: RunPrompt = mode ? { text, parts: [], mode } : { text, parts: [] }
      for (const fn of [...prompts]) fn(prompt)
      return true
    },
  }
}
