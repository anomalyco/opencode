import type { FooterApi, FooterEvent, RunPrompt, StreamCommit } from "../../../src/mini/types"

export function createFooterApiFixture(input: { events?: FooterEvent[]; commits?: StreamCommit[] } = {}) {
  const prompts = new Set<(input: RunPrompt) => void>()
  const queuedRemoves = new Set<(messageID: string) => boolean | Promise<boolean>>()
  const closes = new Set<() => void>()
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
      return () => prompts.delete(fn)
    },
    onQueuedRemove(fn) {
      queuedRemoves.add(fn)
      return () => queuedRemoves.delete(fn)
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
      queuedRemoves.clear()
      closes.clear()
    },
  }

  return {
    api,
    events,
    commits,
    calls,
    submit(text: string, mode?: RunPrompt["mode"]) {
      const prompt: RunPrompt = mode ? { text, parts: [], mode } : { text, parts: [] }
      for (const fn of [...prompts]) fn(prompt)
    },
    removeQueued(messageID: string) {
      for (const fn of [...queuedRemoves]) void fn(messageID)
    },
  }
}
