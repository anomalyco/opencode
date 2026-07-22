// Lightweight structured logger for @opencode-ai/core.
// Logs formatted as `key=value message` via console methods,
// suitable for both TUI output and debug tracing.
// Context propagation uses AsyncLocalStorage (node:async_hooks).
//
// Usage:
//   import * as Log from "@opencode-ai/core/util/log"
//   const log = Log.create({ service: "config" })
//   log.info("loaded", { file: "..." })

import { AsyncLocalStorage } from "node:async_hooks"

const storage = new AsyncLocalStorage<Record<string, any>>()

function getTags() {
  try {
    return storage.getStore() ?? {}
  } catch {
    return {}
  }
}

export type Logger = ReturnType<typeof create>

export function create(tags?: Record<string, any>) {
  const base = { ...tags }

  const fmt = (extra?: Record<string, any>) =>
    Object.entries({ ...getTags(), ...base, ...extra })
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ")

  const result = {
    info(message?: any, extra?: Record<string, any>) {
      console.log(fmt(extra), message)
      return result
    },
    warn(message?: any, extra?: Record<string, any>) {
      console.warn(fmt({ ...extra, level: "warn" }), message)
      return result
    },
    error(message?: any, extra?: Record<string, any>) {
      console.error(fmt({ ...extra, level: "error" }), message)
      return result
    },
    debug(message?: any, extra?: Record<string, any>) {
      console.debug(fmt({ ...extra, level: "debug" }), message)
      return result
    },
    tag(key: string, value: string) {
      base[key] = value
      return result
    },
    clone(overrides?: Record<string, any>) {
      return create({ ...base, ...overrides })
    },
    provide<R>(fn: () => R): R {
      return storage.run({ ...getTags(), ...base }, fn)
    },
  }

  return result
}
