import {
  isWidgetAlreadyRespondedError,
  type JsonValue,
  type SessionMessageInfo,
  type SessionMessageWidget,
} from "@opencode/client"
import { builtins, program } from "@opencode/widget"
import { createContext, useContext, type ParentProps } from "solid-js"
import { useClient } from "../../context/client"

export type WidgetMessageInfo = SessionMessageWidget

export type WidgetResponse = { value: JsonValue } | { dismiss: true }

export type WidgetBackend = {
  /** The runnable program (prelude + source) of an immutable template version. */
  program: (template: { name: string; version: string }) => Promise<string>
  respond: (input: { sessionID: string; messageID: string; response: WidgetResponse }) => Promise<void>
}

export function widgetMessage(message: SessionMessageInfo | undefined) {
  return message?.type === "widget" ? message : undefined
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
      cached(template, () => client.api.experimental.widget.template.get(template).then((result) => result.program)),
    respond: (input) =>
      client.api.experimental.session.widget
        .respond({ sessionID: input.sessionID, messageID: input.messageID, payload: input.response })
        .catch((error) => {
          if (isWidgetAlreadyRespondedError(error)) throw new WidgetConflict("This widget already has a response")
          throw error
        }),
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
