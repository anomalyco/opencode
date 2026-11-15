import { createEffect, onCleanup, type Accessor } from "solid-js"
import type { Session } from "@opencode/schema/session"

type PresenceApi = {
  experimental: {
    session: {
      presence: (body: { client: string; sessions: Session.ID[] }) => Promise<unknown>
    }
  }
}

/**
 * The presence reporting logic, free of any reactive runtime: reports the open set on change, resets on
 * disconnect so a reconnect re-reports, and refreshes leases on a heartbeat. Best-effort — failures never
 * surface to the user, and older servers without the endpoint must not break the client.
 */
export function createPresenceReporter(input: {
  client: string
  api: () => PresenceApi
  connected: () => boolean
  sessions: () => readonly string[]
  interval?: number
}) {
  let reported: string | undefined
  const send = () => {
    const sessions = [...new Set(input.sessions())].sort()
    reported = sessions.join("\n")
    // SAFETY: Session.ID is a compile-time brand over string; the server validates IDs and ignores unknown ones.
    const body = { client: input.client, sessions: sessions as Session.ID[] }
    void input.api().experimental.session.presence(body).catch(() => {})
  }
  /** Reactive entry point: report only when the open set changed. */
  const update = () => {
    if (!input.connected()) {
      // A reconnect must re-report even an unchanged set: the server may have restarted.
      reported = undefined
      return
    }
    const signature = [...new Set(input.sessions())].sort().join("\n")
    if (signature === reported) return
    send()
  }
  /** Heartbeat entry point: refresh the leases even when the set is unchanged. */
  const refresh = () => {
    if (!input.connected()) {
      reported = undefined
      return
    }
    send()
  }
  const timer = setInterval(refresh, input.interval ?? 60_000)
  return { update, refresh, dispose: () => clearInterval(timer) }
}

/** Solid wiring for {@link createPresenceReporter}: re-report on reactive set/connection changes. */
export function createPresence(input: {
  client: string
  api: Accessor<PresenceApi>
  connected: Accessor<boolean>
  sessions: Accessor<readonly string[]>
  interval?: number
}) {
  const reporter = createPresenceReporter(input)
  createEffect(() => {
    input.connected()
    input.sessions()
    reporter.update()
  })
  onCleanup(reporter.dispose)
}
