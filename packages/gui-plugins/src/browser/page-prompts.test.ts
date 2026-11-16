import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { WebContents } from "electron"
import type { Storage } from "@opencode/plugin/gui/main"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { PromptView } from "./ipc"
import { AGENT_PROMPT_WAIT_MS, createPagePrompts, takeDialogs } from "./page-prompts"
import { createSitePermissions } from "./site-permissions"
import type { DeviceAccess, MediaDevice } from "./system-media"

beforeEach(() => jest.useFakeTimers())

afterEach(() => jest.useRealTimers())

describe("a tab's sign-in", () => {
  test("ends with the navigation that asked when it stops without committing, and is not asked again from there", () => {
    const tab = page("https://bank.example")
    tab.navigate("https://phish.example/download")
    const first = tab.challenge("https://phish.example/download", { navigation: true })
    expect(tab.shown()?.ask.kind).toBe("auth")

    // A 204, a download, a failure or Stop: the tab stays on bank.example.
    tab.contents.emit("did-stop-loading")
    expect(first.answers).toEqual([[]])
    expect(tab.shown()).toBeNull()

    const embedded = tab.challenge("https://phish.example/frame")
    expect(embedded.prevented).toBe(false)
    expect(tab.shown()).toBeNull()
  })

  test("follows the navigation's redirects to the site that asks", () => {
    const tab = page("https://start.example")
    tab.navigate("https://intranet.example/")
    tab.contents.emit("did-redirect-navigation", { url: "https://sso.intranet.example/login", isMainFrame: true })

    expect(tab.challenge("https://sso.intranet.example/login", { navigation: true }).prevented).toBe(true)
    expect(tab.shown()?.ask).toMatchObject({ kind: "auth", host: "sso.intranet.example" })
  })

  test("stops an agent command other than a navigation at once while a sign-in waits", async () => {
    const tab = page("https://intranet.example")
    tab.challenge("https://intranet.example/api")

    const click = tab.prompts.agentWait(false)
    const navigation = tab.prompts.agentWait(true)
    const outcome = await Promise.race([navigation.promise.catch(() => "rejected"), Promise.resolve("waiting")])

    await expect(click.promise).rejects.toMatchObject({ code: Browser.FailureCode.signInRequired })
    expect(outcome).toBe("waiting")
    navigation.stop()
  })
})

describe("a tab's permission requests", () => {
  test("tell a script the agent caused no after the agent wait, and keep nothing", () => {
    const tab = page("https://maps.example", { agent: true })
    const answers: boolean[] = []
    tab.prompts.permissions.request("notifications", { isMainFrame: true, requestingUrl: "https://maps.example/" }, (granted) => answers.push(granted))
    expect(tab.shown()?.ask.kind).toBe("permission")

    jest.advanceTimersByTime(AGENT_PROMPT_WAIT_MS - 1)
    expect(answers).toEqual([])

    jest.advanceTimersByTime(1)
    expect(answers).toEqual([false])
    expect(tab.shown()).toBeNull()
    expect(tab.sites.list()).toEqual([])
  })

  test("follow a block kept in Settings over this visit's Allow", async () => {
    const tab = page("https://maps.example")
    const details = { isMainFrame: true, requestingUrl: "https://maps.example/" }
    const answers: boolean[] = []
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))
    const shown = tab.shown()
    await tab.prompts.answer(shown?.id ?? 0, { kind: "permission", allow: true, remember: false })
    expect(answers).toEqual([true])
    expect(tab.prompts.permissions.check("notifications", "https://maps.example/", details)).toBe(true)

    tab.sites.keep({ kind: "profile" }, { origin: "https://maps.example", permission: "notifications", setting: "block" })
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))

    expect(answers).toEqual([true, false])
    expect(tab.prompts.permissions.check("notifications", "https://maps.example/", details)).toBe(false)
    expect(tab.shown()).toBeNull()
  })
})

describe("what the user allowed a site, in a tab the agent drives", () => {
  const details = { isMainFrame: true, requestingUrl: "https://meet.example/" }

  test("is asked again, says the agent works there, and offers nothing to keep", async () => {
    const tab = page("https://meet.example", { agent: true })
    tab.sites.keep({ kind: "profile" }, { origin: "https://meet.example", permission: "notifications", setting: "allow" })
    const answers: boolean[] = []
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))

    expect(answers).toEqual([])
    expect(tab.shown()?.ask).toMatchObject({ kind: "permission", remember: "none", agent: true })
    expect(tab.prompts.permissions.check("notifications", "https://meet.example/", details)).toBe(false)

    // Allow this time is for that request alone, whatever the answer claims to keep.
    await tab.prompts.answer(tab.shown()?.id ?? 0, { kind: "permission", allow: true, remember: true })
    expect(answers).toEqual([true])
    tab.prompts.permissions.request("geolocation", details, (granted) => answers.push(granted))
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))
    expect(answers).toEqual([true])
    expect(tab.shown()?.waiting).toBe(1)
    expect(tab.sites.list()).toEqual([{ origin: "https://meet.example", permission: "notifications", setting: "allow" }])
  })

  test("still blocks silently what the user blocked", () => {
    const tab = page("https://meet.example", { agent: true })
    tab.sites.keep({ kind: "profile" }, { origin: "https://meet.example", permission: "notifications", setting: "block" })
    const answers: boolean[] = []
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))

    expect(answers).toEqual([false])
    expect(tab.shown()).toBeNull()
  })

  test("is granted without asking in a tab the user drives", () => {
    const tab = page("https://meet.example")
    tab.sites.keep({ kind: "profile" }, { origin: "https://meet.example", permission: "notifications", setting: "allow" })
    const answers: boolean[] = []
    tab.prompts.permissions.request("notifications", details, (granted) => answers.push(granted))

    expect(answers).toEqual([true])
    expect(tab.shown()).toBeNull()
  })
})

describe("a page's camera and microphone, before the system", () => {
  const ask = { origin: "https://meet.example", mainFrame: true, kinds: ["microphone"] as const }
  const details = { isMainFrame: true, requestingUrl: "https://meet.example/", mediaTypes: ["audio"] }

  test("holds the page's call and asks the user first while macOS has not asked; Block never reaches the system", async () => {
    const tab = page("https://meet.example", { system: { microphone: "ask" } })
    const gate = tab.prompts.gate(ask)

    expect(tab.shown()?.ask).toMatchObject({ kind: "permission", permissions: ["microphone"], system: true })
    await tab.prompts.answer(tab.shown()?.id ?? 0, { kind: "permission", allow: false, remember: false })

    expect(await gate).toBe(false)
    expect(tab.asked()).toEqual([])
  })

  test("asks the system only after the user's Allow, then lets the page's own request through without a second bar", async () => {
    const tab = page("https://meet.example", { system: { microphone: "ask" } })
    const gate = tab.prompts.gate(ask)
    expect(tab.asked()).toEqual([])

    await tab.prompts.answer(tab.shown()?.id ?? 0, { kind: "permission", allow: true, remember: false })
    expect(await gate).toBe(true)
    expect(tab.asked()).toEqual(["ask microphone"])

    const answers: boolean[] = []
    tab.prompts.permissions.request("media", details, (granted) => answers.push(granted))
    expect(answers).toEqual([true])
    expect(tab.shown()).toBeNull()
  })

  test("asks the user even for a site allowed before, while macOS has not asked yet", () => {
    const tab = page("https://meet.example", { system: { microphone: "ask" } })
    tab.sites.keep({ kind: "profile" }, { origin: "https://meet.example", permission: "microphone", setting: "allow" })
    void tab.prompts.gate(ask)

    expect(tab.shown()?.ask).toMatchObject({ kind: "permission", system: true })
    expect(tab.prompts.permissions.check("media", "https://meet.example/", { ...details, mediaType: "audio" })).toBe(false)
    expect(tab.asked()).toEqual([])
  })

  test("refuses a device the system refuses with its notice, asking neither the system nor the user", async () => {
    const tab = page("https://meet.example", { system: { camera: "denied" } })

    expect(await tab.prompts.gate({ ...ask, kinds: ["camera"] })).toBe(false)
    expect(tab.shown()?.ask).toEqual({ kind: "system", device: "camera", platform: expect.any(String) })
    expect(tab.asked()).toEqual([])
  })

  test("lets the call through at once once the system decided, so the site's own request asks as before", async () => {
    const tab = page("https://meet.example")

    expect(await tab.prompts.gate(ask)).toBe(true)
    expect(tab.shown()).toBeNull()
    tab.prompts.permissions.request("media", details, () => {})
    expect(tab.shown()?.ask).toMatchObject({ kind: "permission", system: false })
  })
})

describe("a prompt the page asks for again", () => {
  test("shows anew, so its input protection starts over", () => {
    const tab = page("https://meet.example")
    const details = { isMainFrame: true, requestingUrl: "https://meet.example/" }
    tab.prompts.permissions.request("clipboard-read", details, () => {})
    const first = tab.shown()
    tab.prompts.permissions.request("clipboard-read", details, () => {})

    expect(tab.shown()?.id).toBe(first?.id)
    expect(first?.asked).toBe(1)
    expect(tab.shown()?.asked).toBe(2)
  })
})

describe("where a prompt puts the keyboard", () => {
  test("a dialog takes it in the tab in front from anywhere in the window; a bar only from its page", () => {
    const composer = page("https://intranet.example", { focused: false })
    composer.challenge("https://intranet.example/api")
    expect(composer.shown()).toMatchObject({ focus: true, page: false })

    const behind = page("https://intranet.example", { focused: false, front: false })
    behind.challenge("https://intranet.example/api")
    expect(behind.shown()?.focus).toBe(false)

    const agent = page("https://intranet.example", { focused: false, agent: true })
    agent.challenge("https://intranet.example/api")
    expect(agent.shown()?.focus).toBe(false)

    const bar = page("https://intranet.example", { focused: false })
    bar.prompts.permissions.request("notifications", { isMainFrame: true, requestingUrl: "https://intranet.example/" }, () => {})
    expect(bar.shown()?.focus).toBe(false)
  })

  test("goes back to the page only if the page had it", async () => {
    const held = page("https://intranet.example")
    held.challenge("https://intranet.example/api")
    held.state.focused = false
    await held.prompts.answer(held.shown()?.id ?? 0, { kind: "dismiss" })
    expect(held.refocused()).toBe(1)

    const elsewhere = page("https://intranet.example", { focused: false })
    elsewhere.challenge("https://intranet.example/api")
    await elsewhere.prompts.answer(elsewhere.shown()?.id ?? 0, { kind: "dismiss" })
    expect(elsewhere.refocused()).toBe(0)
  })
})

describe("the takeover of a page's dialogs", () => {
  test("fails safe and says so once when Electron's internal dialog events are not what it expects", () => {
    // An Electron without the internal listener, which then calls it with no callback.
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    const warnings: string[] = []

    // SAFETY: the takeover reads only the events and `isDestroyed` of a page's contents.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const dialogs = takeDialogs(contents as unknown as WebContents, {
      suppressed: () => false,
      opened: () => false,
      framed: () => {},
      warn: (message) => warnings.push(message),
    })

    expect(() => contents.emit("-run-dialog", { dialogType: "alert" })).not.toThrow()
    expect(warnings).toHaveLength(2)
    expect(dialogs.frame()).toBeUndefined()
  })

  test("answers a dialog nobody can see, so the page never waits on it", () => {
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    contents.on("-run-dialog", () => {})
    const answers: unknown[][] = []
    // SAFETY: as above.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    takeDialogs(contents as unknown as WebContents, { suppressed: () => false, opened: () => false, framed: () => {}, warn: () => {} })

    contents.emit("-run-dialog", { dialogType: "confirm" }, (...args: unknown[]) => answers.push(args))
    expect(answers).toEqual([])
    jest.advanceTimersByTime(2_000)
    expect(answers).toEqual([[false, ""]])
  })
})

/** A tab on `origin`, with an in-memory store and the prompt views it reported. */
function page(
  origin: string,
  options: {
    agent?: boolean
    /** The system's access per device; granted when not named. */
    system?: Partial<Record<MediaDevice, DeviceAccess>>
    /** The tab is in front of a focused window. */
    front?: boolean
    /** The page holds the keyboard. */
    focused?: boolean
  } = {},
) {
  const state = { focused: options.focused ?? true }

  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { origin, url: `${origin}/`, framesInSubtree: [] },
    isDestroyed: () => false,
    isFocused: () => state.focused,
  })

  // Every call the pane makes to the system, in order: only reads of the setting may come before the user's Allow.
  const system: string[] = []
  const access = { ...options.system }
  let refocused = 0

  const views: (PromptView | null)[] = []
  const sites = createSitePermissions(memoryStorage(), () => {})

  const prompts = createPagePrompts({
    // SAFETY: the prompts read only the members above of a page's contents, and its events.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    contents: contents as unknown as WebContents,
    scope: { kind: "profile" },
    sites,
    agentDriven: () => !!options.agent,
    top: () => contents.mainFrame.url,
    dialog: () => null,
    dialogFrame: () => undefined,
    answerDialog: async () => {},
    redo: async () => {},
    close: () => {},
    focusPage: () => refocused++,
    front: () => options.front ?? true,
    returning: () => false,
    quiet: () => {},
    report: (view) => views.push(view),
    system: {
      access: (device) => {
        system.push(`access ${device}`)

        return access[device] ?? "granted"
      },
      ask: async (device) => {
        system.push(`ask ${device}`)
        access[device] = "granted"

        return true
      },
    },
  })

  return {
    contents,
    prompts,
    sites,
    state,
    /** The system calls other than reads of its setting. */
    asked: () => system.filter((call) => !call.startsWith("access")),
    refocused: () => refocused,
    shown: () => views.at(-1) ?? null,
    navigate: (url: string) => contents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false }),
    /** A 401 from `url`; returns whether the pane took it and what it answered. */
    challenge(url: string, input: { navigation?: boolean } = {}) {
      const answers: unknown[][] = []
      const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) }
      contents.emit(
        "login",
        event,
        { url, firstAuthAttempt: true, isRequestForNavigation: !!input.navigation },
        { isProxy: false, scheme: "basic", realm: "Staff", host: new URL(url).hostname, port: 443 },
        (...args: unknown[]) => answers.push(args),
      )

      return {
        answers,
        get prevented() {
          return event.defaultPrevented
        },
      }
    },
  }
}

function memoryStorage() {
  const values = new Map<string, unknown>()

  // SAFETY: the site permissions read only `store` and its `value` and `set`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
      set: (next: unknown) => values.set(key, next),
    }),
  } as unknown as Storage
}
