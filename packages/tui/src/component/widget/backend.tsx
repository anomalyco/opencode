import type { SessionMessageInfo } from "@opencode/client"
import { builtins, program } from "@opencode/widget"
import { createContext, useContext, type ParentProps } from "solid-js"
import { useClient } from "../../context/client"

/**
 * Local mirror of `Session.Message.Widget` until the regenerated client exposes it as `SessionMessageWidget`.
 * This file is the one place to swap for the real client.
 */
export type WidgetMessageInfo = {
  id: string
  type: "widget"
  time: { created: number; responded?: number }
  metadata?: Record<string, unknown>
  title?: string
  template: { name: string; version: string }
  data: unknown
  tool?: { messageID: string; callID: string }
  status: "open" | "submitted" | "dismissed"
  response?: unknown
}

export type WidgetResponse = { value: unknown } | { dismiss: true }

export type WidgetBackend = {
  /** The runnable program (prelude + source) of an immutable template version. */
  program: (template: { name: string; version: string }) => Promise<string>
  respond: (input: { sessionID: string; messageID: string; response: WidgetResponse }) => Promise<void>
}

export function widgetMessage(message: SessionMessageInfo | undefined): WidgetMessageInfo | undefined {
  const value: { type: string } | undefined = message
  if (value?.type !== "widget") return
  return value as WidgetMessageInfo
}

/** A respond call the server rejected because the widget already has a response. */
export class WidgetConflict extends Error {}

const BackendContext = createContext<WidgetBackend>()

/** Overrides the server backend, for stories and tests that keep templates and responses local. */
export function WidgetBackendProvider(props: ParentProps<{ backend: WidgetBackend }>) {
  return <BackendContext.Provider value={props.backend}>{props.children}</BackendContext.Provider>
}

export function useWidgetBackend(): WidgetBackend {
  const provided = useContext(BackendContext)
  if (provided) return provided
  const client = useClient()
  return {
    program: (template) =>
      cached(template, async () => {
        const response = await request(`/api/widget/template/${template.name}/${template.version}`, { method: "GET" })
        const body: { program?: unknown } = await response.json()
        if (typeof body.program !== "string") throw new Error("Template response has no program")
        return body.program
      }),
    async respond(input) {
      const response = await request(`/api/session/${input.sessionID}/widget/${input.messageID}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.response),
      })
      if (response.status === 409) throw new WidgetConflict("This widget already has a response")
    },
  }

  async function request(path: string, init: RequestInit) {
    if (!client.url) throw new Error("Widget endpoints need a server URL")
    const response = await fetch(new URL(path, client.url), {
      ...init,
      headers: { ...client.headers, ...(init.headers as Record<string, string> | undefined) },
    })
    if (!response.ok && response.status !== 409) throw new Error(`Widget request failed: ${response.status}`)
    return response
  }
}

// Versions are content addresses and never change, so programs stay cached for the whole process.
const programs = new Map<string, Promise<string>>()

/** Serves built-in templates locally when the version matches and caches every other program by name@version. */
export function cached(template: { name: string; version: string }, load: () => Promise<string>) {
  const key = `${template.name}@${template.version}`
  const existing = programs.get(key)
  if (existing) return existing
  const builtin = builtins.find((item) => item.name === template.name && item.version === template.version)
  const pending = builtin ? Promise.resolve(program(builtin.source)) : load()
  programs.set(key, pending)
  // A failed fetch must not stick, so the next mount retries.
  pending.catch(() => {
    if (programs.get(key) === pending) programs.delete(key)
  })
  return pending
}
