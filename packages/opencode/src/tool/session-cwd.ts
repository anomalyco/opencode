// Per-session working directory, set by the change_directory tool.
//
// opencode tools normally resolve relative paths against the instance
// directory. This module lets a session override that base (like `cd` in a
// terminal) without rewiring InstanceState: tools call `SessionCwd.get(id, fallback)`
// and get the session's override or the fallback when none is set. Backward
// compatible — an unset session always resolves to the fallback (instance dir).
const store = new Map<string, string>()

export function get(sessionID: string, fallback: string): string {
  return store.get(sessionID) ?? fallback
}

export function set(sessionID: string, dir: string): void {
  store.set(sessionID, dir)
}

export function clear(sessionID: string): void {
  store.delete(sessionID)
}

export * as SessionCwd from "./session-cwd"
