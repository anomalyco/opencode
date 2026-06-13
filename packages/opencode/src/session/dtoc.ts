import { Context, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionID } from "./schema"

/**
 * Dynamic Tool Output Compression (DTOC) state management.
 *
 * Tracks per-session:
 * - Whether DTOC mode is enabled
 * - Which tool_keys are currently hidden (disabled)
 * - A monotonic counter for generating tool_keys
 */

export type ToolKeyEntry = {
  tool_key: string
  toolName: string
  callID: string
  estimatedTokens: number
  timestamp: number
  visible: boolean
}

type SessionState = {
  enabled: boolean
  counter: number
  entries: Map<string, ToolKeyEntry>
  callIDIndex: Map<string, string> // callID -> tool_key
  tokensSaved: number // cumulative tokens saved by hiding outputs
}

export interface Interface {
  readonly isEnabled: (sessionID: SessionID) => boolean
  readonly setDefault: (sessionID: SessionID, enabled: boolean) => void
  readonly enable: (sessionID: SessionID) => void
  readonly disable: (sessionID: SessionID) => void
  readonly registerOrGet: (sessionID: SessionID, entry: Omit<ToolKeyEntry, "tool_key" | "visible">) => string
  readonly setVisibility: (sessionID: SessionID, toolKeys: string[], visible: boolean) => string[]
  readonly getEntry: (sessionID: SessionID, toolKey: string) => ToolKeyEntry | undefined
  readonly getByCallID: (sessionID: SessionID, callID: string) => ToolKeyEntry | undefined
  readonly listEntries: (sessionID: SessionID) => ToolKeyEntry[]
  readonly getTokensSaved: (sessionID: SessionID) => number
}

export class Service extends Context.Service<Service, Interface>()("@opencode/DTOC") {}

function getOrCreate(store: Map<string, SessionState>, sessionID: SessionID): SessionState {
  let state = store.get(sessionID)
  if (!state) {
    state = { enabled: false, counter: 0, entries: new Map(), callIDIndex: new Map(), tokensSaved: 0 }
    store.set(sessionID, state)
  }
  return state
}

export const layer = Layer.succeed(
  Service,
  (() => {
    const store = new Map<string, SessionState>()

    const isEnabled: Interface["isEnabled"] = (sessionID) => {
      return store.get(sessionID)?.enabled ?? false
    }

    const setDefault: Interface["setDefault"] = (sessionID, enabled) => {
      if (store.has(sessionID)) return
      store.set(sessionID, { enabled, counter: 0, entries: new Map(), callIDIndex: new Map(), tokensSaved: 0 })
    }

    const enable: Interface["enable"] = (sessionID) => {
      getOrCreate(store, sessionID).enabled = true
    }

    const disable: Interface["disable"] = (sessionID) => {
      getOrCreate(store, sessionID).enabled = false
    }

    const registerOrGet: Interface["registerOrGet"] = (sessionID, entry) => {
      const state = getOrCreate(store, sessionID)
      const existing = state.callIDIndex.get(entry.callID)
      if (existing) return existing
      state.counter++
      const tool_key = `tk_${String(state.counter).padStart(3, "0")}`
      const full: ToolKeyEntry = { ...entry, tool_key, visible: true }
      state.entries.set(tool_key, full)
      state.callIDIndex.set(entry.callID, tool_key)
      return tool_key
    }

    const setVisibility: Interface["setVisibility"] = (sessionID, toolKeys, visible) => {
      const state = store.get(sessionID)
      if (!state) return []
      const modified: string[] = []
      for (const key of toolKeys) {
        const entry = state.entries.get(key)
        if (entry && entry.visible !== visible) {
          entry.visible = visible
          modified.push(key)
          // Track tokens saved when hiding, subtract when re-enabling
          if (!visible) state.tokensSaved += entry.estimatedTokens
          else state.tokensSaved -= entry.estimatedTokens
        }
      }
      return modified
    }

    const getEntry: Interface["getEntry"] = (sessionID, toolKey) => {
      return store.get(sessionID)?.entries.get(toolKey)
    }

    const getByCallID: Interface["getByCallID"] = (sessionID, callID) => {
      const state = store.get(sessionID)
      if (!state) return undefined
      const key = state.callIDIndex.get(callID)
      if (!key) return undefined
      return state.entries.get(key)
    }

    const listEntries: Interface["listEntries"] = (sessionID) => {
      const state = store.get(sessionID)
      if (!state) return []
      return [...state.entries.values()]
    }

    const getTokensSaved: Interface["getTokensSaved"] = (sessionID) => {
      return store.get(sessionID)?.tokensSaved ?? 0
    }

    return Service.of({
      isEnabled,
      setDefault,
      enable,
      disable,
      registerOrGet,
      setVisibility,
      getEntry,
      getByCallID,
      listEntries,
      getTokensSaved,
    })
  })(),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as DTOC from "./dtoc"
