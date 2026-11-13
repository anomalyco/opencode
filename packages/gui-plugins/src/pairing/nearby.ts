import { randomUUID } from "node:crypto"
import type { Socket } from "node:net"
import { Notification, type BrowserWindow } from "electron"
import { Schema } from "effect"
import { ConfigFlag } from "@opencode/schema/config/flag"
import type { Plugin } from "@opencode/plugin/gui/main"
import type { NearbyPrompt } from "./contract"
import { advertise, computerName } from "./discovery"
import { initiate, type Payload } from "./exchange"
import { createGate } from "./gate"

/**
 * The announcement while discoverable, the phone being paired keyed by its network address, the prompt the windows
 * show for it, and when the last system notification showed.
 */
type NearbyState = {
  running?: Promise<{ stop: () => Promise<void> } | undefined>
  active?: { id: string; device: string; since: number; approve: () => void; cancel: () => void }
  prompt?: typeof NearbyPrompt.Type
  notified: number
}

/** System notifications for requests show at most this often; the toast in the app shows every request. */
const NOTIFY_INTERVAL = 30_000

/** How long a pairing waits for the remote access tunnel when the server is not reachable on this network. */
const TUNNEL_TIMEOUT = 180_000

const ServerInfo = Schema.fromJsonString(Schema.Struct({ urls: Schema.Array(Schema.String) }))

const PairCode = Schema.fromJsonString(Schema.Struct({ code: Schema.String, expires_in: Schema.Number }))

/**
 * Nearby pairing (flag `nearby_pairing`): while this machine is discoverable it announces itself over mDNS, and a
 * phone that taps it in its list runs the code exchange. Every window shows the request as a toast from state; the
 * pairing code itself is made only once the user confirmed on both devices. `gate.ts` decides which requests reach
 * the user.
 */
export function createNearby(
  ctx: Parameters<Plugin.MainSetup>[0],
  input: {
    /** Turns remote access on, the way the settings switch does. */
    enableRemote: () => Promise<void>
    changed: () => void
    paired: (result: { device: string; paired: boolean }) => void
  },
) {
  const enabled = flagEnabled(ctx.app.channel)
  const log = ctx.log
  const discoverable = ctx.storage.store("discoverable", { schema: Schema.Boolean, initial: true })
  // Lets a phone tell this install apart from another machine with the same name.
  const install = ctx.storage.store("installID", { schema: Schema.String, initial: "" })
  const gate = createGate()

  const state: NearbyState = { notified: Number.NEGATIVE_INFINITY }

  if (enabled && !install.value) install.set(randomUUID())

  const stop = async () => {
    const running = state.running
    state.running = undefined
    state.active?.cancel()
    await (await running)?.stop()
  }

  const setDiscoverable = (on: boolean) => {
    if (!enabled) return
    discoverable.set(on)

    if (!on) return void stop()
    gate.clear()

    if (state.running) return
    state.running = advertise({
      id: install.value,
      version: ctx.app.version,
      onConnection: (socket) => pair(socket),
      onError: (error) => log.write("warn", "pairing discovery error", { error: error.message }),
      onFallback: (backend, error) =>
        log.write("info", "pairing discovery backend unavailable", { backend, error: error.message }),
    }).then(
      (running) => {
        log.write("info", "pairing discovery started", { backend: running.backend })

        return running
      },
      (error: Error) => {
        log.write("error", "pairing discovery failed to start", { error: error.message })
        state.running = undefined

        return undefined
      },
    )
  }

  const pair = (socket: Socket) => {
    const device = socket.remoteAddress ?? "unknown"
    const admission = gate.admit(device, state.active)

    if (admission === "refuse") {
      socket.destroy()

      return void refreshOffers()
    }

    if (admission === "replace") state.active?.cancel()

    const id = randomUUID()

    const exchange = initiate(socket, { name: computerName(), id: install.value, payload: () => pairingPayload() })

    const approve = () => {
      if (state.prompt?.id !== id) return
      state.prompt = { ...state.prompt, approved: true }
      input.changed()
      exchange.approve()
    }

    state.active = { id, device, since: Date.now(), approve, cancel: exchange.cancel }
    const phone = { name: ctx.t("nearby.unnamed") }

    exchange.code.then(
      (shown) => {
        if (shown.device) phone.name = shown.device
        state.prompt = { id, device: phone.name, code: shown.code, approved: false, offers: gate.offers(device) }
        input.changed()

        if (ctx.windows.list().some((window) => window.isFocused())) return

        if (Date.now() - state.notified < NOTIFY_INTERVAL) return
        state.notified = Date.now()
        notify(ctx.t("nearby.notify.title"), ctx.t("nearby.notify.body", { device: phone.name, code: shown.code }))
      },
      () => undefined,
    )
    exchange.done
      .then(() => input.paired({ device: phone.name, paired: true }))
      .catch((error: Error) => {
        log.write("info", "nearby pairing ended", { error: error.message })

        // Only a pairing the user agreed to reports how it ended; a declined or replaced one just goes away.
        if (state.prompt?.id === id && state.prompt.approved) input.paired({ device: phone.name, paired: false })
      })
      .finally(() => {
        if (state.active?.id !== id) return
        state.active = undefined
        state.prompt = undefined
        input.changed()
      })
  }

  // A refused request still counts: the toast showing now may need to offer a snooze.
  const refreshOffers = () => {
    const prompt = state.prompt
    const active = state.active

    if (!prompt || !active) return
    const offers = gate.offers(active.device)

    if (offers.device === prompt.offers.device && offers.all === prompt.offers.all) return
    state.prompt = { ...prompt, offers }
    input.changed()
  }

  const notify = (title: string, body: string) => {
    const notification = new Notification({ title, body })
    notification.on("click", () => {
      const window = ctx.windows.focused() ?? ctx.windows.list()[0]

      if (window && !window.isDestroyed()) reveal(window)
    })
    notification.show()
  }

  const sidecar = async (path: string, init?: RequestInit) => {
    const server = ctx.serverEndpoints.get("sidecar")

    if (!server) throw new Error("The local server is not running")
    const response = await fetch(new URL(path, server.url), { ...init, headers: server.headers })

    if (!response.ok) throw new Error(`${path} answered ${response.status}`)

    return response.text()
  }

  const reachableUrls = async (deadline?: number): Promise<readonly string[]> => {
    const urls = Schema.decodeUnknownSync(ServerInfo)(await sidecar("/api/info")).urls.filter(
      (url) => !isLoopback(new URL(url).hostname),
    )

    if (urls.length) return urls

    if (deadline === undefined) {
      // Bound to this machine alone with remote access off: the tunnel is the only way in, as the QR dialog does.
      await input.enableRemote()

      return reachableUrls(Date.now() + TUNNEL_TIMEOUT)
    }

    if (Date.now() > deadline) throw new Error("The remote access tunnel did not connect")
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return reachableUrls(deadline)
  }

  // Addresses first: turning on remote access restarts the server, which forgets codes made before it.
  const pairingPayload = async (): Promise<Payload> => {
    const urls = await reachableUrls()
    const code = Schema.decodeUnknownSync(PairCode)(await sidecar("/api/pair", { method: "POST" }))

    return { code: code.code, expires_in: code.expires_in, urls }
  }

  ctx.onCleanup(stop)

  if (enabled && discoverable.value) setDiscoverable(true)

  return {
    prompt: () => state.prompt ?? null,
    /** Whether this machine is discoverable, or null while the flag is off. */
    discoverable: () => (enabled ? discoverable.value : null),
    setDiscoverable,
    approve: (id: string) => {
      if (state.active?.id === id) state.active.approve()
    },
    cancel: (id: string) => {
      if (state.active?.id === id) state.active.cancel()
    },
    snooze: (id: string, scope: "device" | "all") => {
      if (state.active?.id !== id) return
      gate.snooze(scope, state.active.device)
      state.active.cancel()
    },
  }
}

/**
 * The `nearby_pairing` flag as Core resolves it, from what main can see: `OPENCODE_FLAGS`, then on for local and dev
 * builds. Main has no Location config, so `experimental.nearby_pairing` in config does not reach it.
 */
function flagEnabled(channel: string) {
  const overrides = new Map(
    (process.env.OPENCODE_FLAGS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item): [string, boolean] => (item.startsWith("-") ? [item.slice(1), false] : [item, true])),
  )

  return (
    overrides.get("nearby_pairing") ??
    (overrides.get(ConfigFlag.wildcard) === true ? true : channel === "local" || channel === "dev")
  )
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
}

function reveal(window: BrowserWindow) {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
