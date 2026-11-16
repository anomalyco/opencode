import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { WebContents } from "electron"
import type { Storage } from "@opencode/plugin/gui/main"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { PromptView } from "./ipc"
import { AGENT_PROMPT_WAIT_MS, createPagePrompts, takeDialogs } from "./page-prompts"
import { createSitePermissions } from "./site-permissions"

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

describe("the takeover of a page's dialogs", () => {
  test("fails safe and says so once when Electron's internal dialog events are not what it expects", () => {
    // An Electron without the internal listener, which then calls it with no callback.
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    const warnings: string[] = []
    // SAFETY: the takeover reads only the events and `isDestroyed` of a page's contents.
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
    takeDialogs(contents as unknown as WebContents, { suppressed: () => false, opened: () => false, framed: () => {}, warn: () => {} })

    contents.emit("-run-dialog", { dialogType: "confirm" }, (...args: unknown[]) => answers.push(args))
    expect(answers).toEqual([])
    jest.advanceTimersByTime(2_000)
    expect(answers).toEqual([[false, ""]])
  })
})

/** A tab on `origin`, with an in-memory store and the prompt views it reported. */
function page(origin: string, options: { agent?: boolean } = {}) {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { origin, url: `${origin}/`, framesInSubtree: [] },
    isDestroyed: () => false,
    isFocused: () => true,
  })
  const views: (PromptView | null)[] = []
  const sites = createSitePermissions(memoryStorage(), () => {})

  const prompts = createPagePrompts({
    // SAFETY: the prompts read only the members above of a page's contents, and its events.
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
    focusPage: () => {},
    quiet: () => {},
    report: (view) => views.push(view),
  })

  return {
    contents,
    prompts,
    sites,
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
  return {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      set: (next: unknown) => values.set(key, next),
    }),
  } as unknown as Storage
}
