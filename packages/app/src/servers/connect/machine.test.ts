import { describe, expect, test } from "bun:test"
import {
  CAMERA_PROBE_TIMEOUT_MS,
  formatServerConnectError,
  selectServerConnectView,
  SERVER_CONNECT_TIMEOUT_MS,
  startServerConnect,
  transitionServerConnect,
  type ServerConnectEffect,
  type ServerConnectErrorContext,
  type ServerConnectEvent,
  type ServerConnectState,
  type ServerConnectTarget,
  type ServerOriginal,
} from "./machine"

const original = (input: Partial<ServerOriginal> = {}): ServerOriginal => ({
  url: "http://old:4096",
  displayName: undefined,
  password: undefined,
  unauthorized: false,
  ...input,
})

const edit = (input: Partial<ServerOriginal> = {}): ServerConnectTarget => ({ kind: "edit", original: original(input) })

function replay(
  target: ServerConnectTarget,
  events: readonly ServerConnectEvent[],
  from: ServerConnectState = startServerConnect(target).state,
) {
  return events.reduce<{ state: ServerConnectState; effects: ServerConnectEffect[] }>(
    (result, event) => {
      const next = transitionServerConnect(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

/** The web app's form once its camera check found a camera. */
const withCamera = (target: ServerConnectTarget) =>
  transitionServerConnect(startServerConnect(target, "probe").state, {
    type: "camera.settled",
    attempt: 1,
    available: true,
  }).state

const field = (name: "link" | "url" | "name" | "password", value: string): ServerConnectEvent => ({
  type: "field.changed",
  field: name,
  value,
})

const password: ServerConnectEvent = { type: "method.changed", method: "password" }

const submitted: ServerConnectEvent = { type: "submitted" }

const succeeded = (attempt: number, url: string, secret?: string): ServerConnectEvent => ({
  type: "submit.succeeded",
  attempt,
  http: secret ? { url, password: secret } : { url },
})

const context: ServerConnectErrorContext = { surface: "dialog", pageHref: undefined, t: (key) => key }

const closes = (effects: readonly ServerConnectEffect[]) => effects.filter((effect) => effect.type === "close")

describe("server connect form", () => {
  test.each([
    { name: "an empty address in a new server", target: { kind: "add" } as const, events: [password] },
    { name: "a cleared address in an edited server", target: edit(), events: [field("url", "")] },
    {
      name: "an address with another scheme",
      target: { kind: "add" } as const,
      events: [password, field("url", "ftp://host")],
    },
    {
      name: "an address with credentials",
      target: { kind: "add" } as const,
      events: [password, field("url", "http://u:p@host")],
    },
  ])("$name keeps the dialog open and explains the address", (input) => {
    const result = replay(input.target, [...input.events, submitted])

    expect(result.state).toMatchObject({ status: "editing", error: { type: "address-invalid" } })
    expect(result.effects).toEqual([])
    expect(selectServerConnectView(result.state, context).error).toBe("server.connect.address.invalid")
  })

  test.each([
    {
      name: "adding",
      target: { kind: "add" } as const,
      action: { type: "add", connection: { type: "http", displayName: "Remote", http: { url: "http://new:4096" } } },
    },
    {
      name: "moving an edited server",
      target: edit(),
      action: {
        type: "replace",
        originalUrl: "http://old:4096",
        connection: { type: "http", displayName: "Remote", http: { url: "http://new:4096" } },
      },
    },
  ])("a save by $name closes the dialog once", (input) => {
    const saved = replay(input.target, [
      password,
      field("url", "new:4096"),
      field("name", " Remote "),
      submitted,
      succeeded(1, "http://new:4096"),
    ])

    expect(saved.state.status).toBe("closed")
    expect(saved.effects.slice(2)).toEqual([
      { type: "timer.stop" },
      { type: "save", action: input.action },
      { type: "close", saved: input.action.connection },
    ])

    // The replacement removes the original from the registry, then the dialog unmounts.
    const after = [{ type: "original.synced", original: undefined }, { type: "disposed" }] as const
    after.forEach((event) =>
      expect(transitionServerConnect(saved.state, event)).toEqual({ state: saved.state, effects: [] }),
    )
  })

  test("a scan cannot start or land while a submit runs", () => {
    const submitting = replay({ kind: "add" }, [field("link", "http://192.168.1.2:4096/auth/connect/abc"), submitted])
    expect(submitting.state.status).toBe("submitting")

    const overlapping: ServerConnectEvent[] = [
      { type: "scan.started" },
      { type: "scan.completed", link: "http://10.0.0.2:4096/auth/connect/xyz" },
      submitted,
      field("link", "other"),
    ]

    overlapping.forEach((event) =>
      expect(transitionServerConnect(submitting.state, event)).toEqual({ state: submitting.state, effects: [] }),
    )
  })

  test("a scanned link submits once", () => {
    const scanned = replay(
      { kind: "add" },
      [{ type: "scan.started" }, { type: "scan.completed", link: "http://192.168.1.2:4096/auth/connect/abc" }],
      withCamera({ kind: "add" }),
    )

    expect(scanned.state).toMatchObject({ status: "submitting", attempt: 1 })
    expect(scanned.effects).toEqual([
      {
        type: "connect.link",
        attempt: 1,
        link: "http://192.168.1.2:4096/auth/connect/abc",
        preferredUrl: undefined,
        fallbackUrl: "http://192.168.1.2:4096",
      },
      { type: "timer.start", attempt: 1, timeoutMs: SERVER_CONNECT_TIMEOUT_MS },
    ])
    expect(
      transitionServerConnect(scanned.state, {
        type: "scan.completed",
        link: "http://192.168.1.2:4096/auth/connect/abc",
      }).state,
    ).toBe(scanned.state)
  })

  test("a cancelled scan returns to the form with its values and checks the camera again", () => {
    const result = replay(
      { kind: "add" },
      [field("name", "Remote"), { type: "scan.started" }, { type: "scan.cancelled" }],
      withCamera({ kind: "add" }),
    )

    expect(result.state).toMatchObject({ status: "editing", draft: { name: "Remote" } })
    expect(result.effects).toEqual([{ type: "camera.probe", attempt: 2, timeoutMs: CAMERA_PROBE_TIMEOUT_MS }])
  })

  test("a camera check that never answers gives way to the hint", () => {
    const start = startServerConnect({ kind: "add" }, "probe")

    expect(start.effects).toEqual([{ type: "camera.probe", attempt: 1, timeoutMs: CAMERA_PROBE_TIMEOUT_MS }])
    expect(selectServerConnectView(start.state, context)).toMatchObject({
      showScan: true,
      canScan: false,
      cameraHint: undefined,
    })

    const timedOut = transitionServerConnect(start.state, { type: "camera.timed-out", attempt: 1 })

    expect(timedOut.effects).toEqual([{ type: "camera.timer.stop" }])
    expect(selectServerConnectView(timedOut.state, context)).toMatchObject({
      showScan: false,
      canScan: false,
      cameraHint: "server.connect.camera.unavailable",
    })
  })

  test("after a cancelled scan, Scan waits for the new camera check and follows its answer", () => {
    const cancelled = replay({ kind: "add" }, [{ type: "scan.started" }, { type: "scan.cancelled" }], withCamera({ kind: "add" }))

    expect(selectServerConnectView(cancelled.state, context).canScan).toBe(false)
    expect(transitionServerConnect(cancelled.state, { type: "scan.started" }).state).toBe(cancelled.state)

    // The answer of the first check is stale.
    expect(
      transitionServerConnect(cancelled.state, { type: "camera.settled", attempt: 1, available: true }).state,
    ).toBe(cancelled.state)

    const denied = transitionServerConnect(cancelled.state, { type: "camera.settled", attempt: 2, available: false })

    expect(selectServerConnectView(denied.state, context)).toMatchObject({
      canScan: false,
      cameraHint: "server.connect.camera.unavailable",
    })
  })

  test.each([
    { support: "insecure", showScan: false, cameraHint: "server.connect.camera.native" },
    { support: "unavailable", showScan: false, cameraHint: "server.connect.camera.unavailable" },
    { support: "none", showScan: false, cameraHint: undefined },
  ] as const)("a $support camera shows its hint at once, with no check", (input) => {
    const start = startServerConnect({ kind: "add" }, input.support)

    expect(start.effects).toEqual([])
    expect(selectServerConnectView(start.state, context)).toMatchObject({
      showScan: input.showScan,
      cameraHint: input.cameraHint,
    })
    expect(transitionServerConnect(start.state, { type: "scan.started" }).state).toBe(start.state)
  })

  test("closing during a camera check stops its timer and ignores its answer", () => {
    const closed = transitionServerConnect(startServerConnect({ kind: "add" }, "probe").state, { type: "disposed" })

    expect(closed.effects).toEqual([{ type: "camera.timer.stop" }])
    expect(transitionServerConnect(closed.state, { type: "camera.settled", attempt: 1, available: true }).state).toBe(
      closed.state,
    )
  })

  test("a result after the dialog unmounts saves nothing", () => {
    const disposed = replay(edit(), [password, field("url", "new:4096"), submitted, { type: "disposed" }])

    expect(disposed.state.status).toBe("closed")
    expect(disposed.effects.at(-1)).toEqual({ type: "timer.stop" })
    expect(transitionServerConnect(disposed.state, succeeded(1, "http://new:4096"))).toEqual({
      state: disposed.state,
      effects: [],
    })
  })

  test("a server address in the link field moves to the password form", () => {
    const result = replay({ kind: "add" }, [field("link", "192.168.1.2:4096"), submitted])

    expect(result.state).toMatchObject({
      status: "editing",
      error: undefined,
      draft: { method: "password", link: "", url: "http://192.168.1.2:4096" },
    })
    expect(result.effects).toEqual([])
  })

  test("a pairing link in the address field still pairs, at the edited address first", () => {
    const result = replay(edit(), [field("url", "http://192.168.1.2:4096/auth/connect/abc_123"), submitted])

    expect(result.state.status).toBe("submitting")
    expect(result.effects[0]).toEqual({
      type: "connect.link",
      attempt: 1,
      link: "http://192.168.1.2:4096/auth/connect/abc_123",
      preferredUrl: "http://old:4096",
      fallbackUrl: "http://old:4096",
    })
  })

  test.each([
    { name: "link", events: [field("link", "http://host:4096/connect#secret")] },
    { name: "address", events: [password, field("url", "http://host:4096/connect#secret")] },
  ])("a legacy link in the $name field asks for a new one", (input) => {
    const result = replay({ kind: "add" }, [...input.events, submitted])

    expect(result.state).toMatchObject({ status: "editing", error: { type: "link-legacy" } })
    expect(result.effects).toEqual([])
  })

  test("an invalid link explains itself, and editing clears the error", () => {
    const invalid = replay({ kind: "add" }, [field("link", "not a link"), submitted])
    expect(invalid.state).toMatchObject({ status: "editing", error: { type: "link-invalid" } })

    expect(transitionServerConnect(invalid.state, field("link", "not a link")).state).toMatchObject({
      error: undefined,
    })
    expect(transitionServerConnect(invalid.state, password).state).toMatchObject({ error: undefined })

    const clean = replay({ kind: "add" }, [field("link", "x")]).state
    expect(transitionServerConnect(clean, field("link", "x")).state).toBe(clean)
  })

  test("an unchanged edit closes without saving", () => {
    const result = replay(edit({ displayName: "Remote", password: "secret" }), [field("name", " Remote "), submitted])

    expect(result.state.status).toBe("closed")
    expect(result.effects).toEqual([{ type: "close" }])
  })

  test("an unchanged edit of a signed-out server checks the credentials again", () => {
    const result = replay(edit({ password: "secret", unauthorized: true }), [password, submitted])

    expect(result.effects[0]).toEqual({
      type: "connect.http",
      attempt: 1,
      http: { url: "http://old:4096", password: "secret" },
    })

    const saved = transitionServerConnect(result.state, succeeded(1, "http://old:4096", "secret"))

    const connection = {
      type: "http",
      displayName: undefined,
      http: { url: "http://old:4096", password: "secret" },
    } as const

    expect(saved.effects).toEqual([
      { type: "timer.stop" },
      { type: "save", action: { type: "add", connection } },
      { type: "close", saved: connection },
    ])
  })

  test("a retry ignores every result of the attempt before it", () => {
    const failed = replay({ kind: "add" }, [
      password,
      field("url", "new:4096"),
      submitted,
      { type: "submit.failed", attempt: 1, error: { type: "connection-failed", url: "http://new:4096" } },
    ])

    expect(failed.state).toMatchObject({ status: "editing", error: { type: "connection-failed" } })
    expect(failed.effects.at(-1)).toEqual({ type: "timer.stop" })

    const retried = transitionServerConnect(failed.state, submitted).state
    expect(retried).toMatchObject({ status: "submitting", attempt: 2 })

    const stale: ServerConnectEvent[] = [
      succeeded(1, "http://new:4096"),
      { type: "submit.failed", attempt: 1, error: { type: "link-invalid" } },
      { type: "submit.timed-out", attempt: 1 },
    ]

    stale.forEach((event) => expect(transitionServerConnect(retried, event)).toEqual({ state: retried, effects: [] }))
  })

  test("a submit that never answers times out as a failed connection", () => {
    const result = replay({ kind: "add" }, [
      password,
      field("url", "new:4096"),
      submitted,
      { type: "submit.timed-out", attempt: 1 },
    ])

    expect(result.state).toMatchObject({
      status: "editing",
      error: { type: "connection-failed", url: "http://new:4096" },
    })
    expect(result.effects.at(-1)).toEqual({ type: "timer.stop" })
  })

  test("an edited server removed while it saves closes the dialog", () => {
    const result = replay(edit(), [
      password,
      field("url", "new:4096"),
      submitted,
      { type: "original.synced", original: undefined },
    ])

    expect(result.state.status).toBe("closed")
    expect(result.effects.slice(-2)).toEqual([{ type: "timer.stop" }, { type: "close" }])
    expect(transitionServerConnect(result.state, succeeded(1, "http://new:4096")).effects).toEqual([])
  })

  test("an edited server that signs out shows it without losing what was typed", () => {
    const typing = replay(edit(), [password, field("url", "new:4096"), submitted])

    const signedOut = transitionServerConnect(typing.state, {
      type: "original.synced",
      original: original({ unauthorized: true }),
    })

    expect(signedOut.effects).toEqual([])
    expect(signedOut.state).toMatchObject({ status: "submitting", attempt: 1, draft: { url: "new:4096" } })
    expect(selectServerConnectView(signedOut.state, context).signedOut).toBe(true)
    expect(
      transitionServerConnect(signedOut.state, { type: "original.synced", original: original({ unauthorized: true }) })
        .state,
    ).toBe(signedOut.state)
  })

  test("signing in on the connect screen saves and stays on the form", () => {
    const result = replay({ kind: "connect", url: "http://localhost:4096" }, [
      field("link", "http://127.0.0.1:4096/auth/connect/abc"),
      submitted,
    ])

    expect(result.effects[0]).toMatchObject({ type: "connect.link", preferredUrl: "http://localhost:4096" })

    const saved = transitionServerConnect(result.state, succeeded(1, "http://localhost:4096", "token"))
    expect(saved.state.status).toBe("editing")
    expect(closes(saved.effects)).toEqual([])
    expect(saved.effects).toContainEqual({
      type: "save",
      action: { type: "connect", http: { url: "http://localhost:4096", password: "token" } },
    })
  })

  test("an edit starts from the server, on a pairing link when it signed out", () => {
    const view = (target: ServerConnectTarget) => selectServerConnectView(startServerConnect(target).state, context)

    expect(view(edit({ displayName: "Remote", password: "secret" })).draft).toEqual({
      method: "password",
      link: "",
      url: "http://old:4096",
      name: "Remote",
      password: "secret",
    })
    expect(view(edit({ unauthorized: true })).draft.method).toBe("link")
    expect(view({ kind: "connect", url: "http://localhost:4096" }).draft.url).toBe("http://localhost:4096")
  })

  test.each([
    {
      name: "a remote HTTP address from an HTTPS page",
      url: "http://192.168.1.2:4096",
      surface: "dialog",
      key: "server.connect.mixedContent",
    },
    {
      name: "a loopback address on the dialog",
      url: "http://127.0.0.1:4096",
      surface: "dialog",
      key: "dialog.server.add.error",
    },
    {
      name: "a loopback address on the screen",
      url: "http://127.0.0.1:4096",
      surface: "screen",
      key: "server.connect.failed",
    },
  ] as const)("a failed connection to $name explains why", (input) => {
    expect(
      formatServerConnectError(
        { type: "connection-failed", url: input.url },
        { surface: input.surface, pageHref: "https://app.opencode.ai/", t: (key) => key },
      ),
    ).toBe(input.key)
  })

  test("a failed connection off the web never blames mixed content", () => {
    expect(formatServerConnectError({ type: "connection-failed", url: "http://192.168.1.2:4096" }, context)).toBe(
      "dialog.server.add.error",
    )
  })
})
