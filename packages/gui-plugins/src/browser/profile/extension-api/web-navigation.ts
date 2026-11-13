import { Schema } from "effect"
import electron, { type WebFrameMain } from "electron"
import { method, type ApiModule, type Emit } from "./api"
import { privateFile, type ExtensionTabs } from "./tabs"

/** A frame and its ancestors, as far as frame ids need them. */
type FrameNode = { readonly frameTreeNodeId: number; readonly parent: FrameNode | null }

/** Chrome's frame id: 0 for a tab's top frame, else the frame's tree node id, as content scripts and scripting see it. */
export function frameIds(frame: FrameNode | null | undefined, main: boolean) {
  if (main || !frame) return { frameId: 0, parentFrameId: -1 }
  const parent = frame.parent

  return { frameId: frame.frameTreeNodeId, parentFrameId: !parent || !parent.parent ? 0 : parent.frameTreeNodeId }
}

/** Whether an in-page navigation only moved to another fragment of the same document. */
export function fragmentOnly(previous: string | undefined, next: string) {
  if (!previous || !URL.canParse(previous) || !URL.canParse(next)) return false
  const before = new URL(previous)
  const after = new URL(next)
  before.hash = ""
  after.hash = ""

  return before.href === after.href && previous !== next
}

const FrameQuery = Schema.Struct({ tabId: Schema.Number, frameId: Schema.optional(Schema.Number) })

/** `chrome.webNavigation`, from the navigation events of the pane's tabs. */
export function createWebNavigation(input: { tabs: ExtensionTabs; emit: Emit }): ApiModule {
  const release = input.tabs.watch((tab) => {
    const contents = tab.contents
    const tabId = contents.id
    const urls = new Map<number, string>()

    const base = (frame: WebFrameMain | null | undefined, main: boolean) => ({
      tabId,
      processId: frame?.processId ?? -1,
      timeStamp: Date.now(),
      ...frameIds(frame, main),
    })

    const frameOf = (process: number, routing: number) => electron.webFrameMain.fromId(process, routing)

    const started = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isSameDocument || privateFile(event.url)) return
      input.emit("webNavigation.onBeforeNavigate", [
        { ...base(event.frame, event.isMainFrame), url: event.url, frameType: event.isMainFrame ? "outermost_frame" : "sub_frame" },
      ])
    }

    const committed = (
      _event: Electron.Event,
      url: string,
      _code: number,
      _status: string,
      main: boolean,
      process: number,
      routing: number,
    ) => {
      const frame = frameOf(process, routing)
      const details = base(frame, main)
      urls.set(details.frameId, url)

      if (privateFile(url)) return
      input.emit("webNavigation.onCommitted", [{ ...details, url, transitionType: "link", transitionQualifiers: [] }])
    }

    const ready = () => {
      const url = contents.getURL()

      if (!privateFile(url)) input.emit("webNavigation.onDOMContentLoaded", [{ ...base(contents.mainFrame, true), url }])
    }

    const finished = (_event: Electron.Event, main: boolean, process: number, routing: number) => {
      const frame = frameOf(process, routing)
      const details = base(frame, main)
      const url = frame?.url ?? contents.getURL()

      if (privateFile(url)) return

      if (!main) input.emit("webNavigation.onDOMContentLoaded", [{ ...details, url }])
      input.emit("webNavigation.onCompleted", [{ ...details, url }])
    }

    const failed = (
      _event: Electron.Event,
      _code: number,
      description: string,
      url: string,
      main: boolean,
      process: number,
      routing: number,
    ) => {
      if (!privateFile(url)) input.emit("webNavigation.onErrorOccurred", [{ ...base(frameOf(process, routing), main), url, error: description }])
    }

    const inPage = (_event: Electron.Event, url: string, main: boolean, process: number, routing: number) => {
      const details = base(frameOf(process, routing), main)
      const previous = urls.get(details.frameId)
      urls.set(details.frameId, url)

      if (privateFile(url)) return
      const name = fragmentOnly(previous, url) ? "onReferenceFragmentUpdated" : "onHistoryStateUpdated"
      input.emit(`webNavigation.${name}`, [{ ...details, url, transitionType: "link", transitionQualifiers: [] }])
    }

    contents.on("did-start-navigation", started)
    contents.on("did-frame-navigate", committed)
    contents.on("dom-ready", ready)
    contents.on("did-frame-finish-load", finished)
    contents.on("did-fail-load", failed)
    contents.on("did-navigate-in-page", inPage)

    return () => {
      if (contents.isDestroyed()) return
      contents.off("did-start-navigation", started)
      contents.off("did-frame-navigate", committed)
      contents.off("dom-ready", ready)
      contents.off("did-frame-finish-load", finished)
      contents.off("did-fail-load", failed)
      contents.off("did-navigate-in-page", inPage)
    }
  })

  const frames = (tabId: number) => {
    const tab = input.tabs.get(tabId)

    if (!tab) throw new Error(`No tab with id: ${tabId}.`)

    return tab.contents.mainFrame.framesInSubtree.filter((frame) => !privateFile(frame.url) && !privateFile(frame.origin)).map((frame) => ({
      url: frame.url,
      errorOccurred: false,
      processId: frame.processId,
      ...frameIds(frame, frame === tab.contents.mainFrame),
    }))
  }

  return {
    namespaces: [
      {
        path: "webNavigation",
        permissions: ["webNavigation"],
        methods: ["getFrame", "getAllFrames"],
        events: [
          "onBeforeNavigate",
          "onCommitted",
          "onDOMContentLoaded",
          "onCompleted",
          "onErrorOccurred",
          "onCreatedNavigationTarget",
          "onReferenceFragmentUpdated",
          "onHistoryStateUpdated",
          "onTabReplaced",
        ],
      },
    ],
    methods: {
      "webNavigation.getFrame": method(Schema.Tuple([FrameQuery]), (_context, [query]) =>
        frames(query.tabId).find((frame) => frame.frameId === (query.frameId ?? 0)) ?? null,
      ),
      "webNavigation.getAllFrames": method(Schema.Tuple([FrameQuery]), (_context, [query]) => frames(query.tabId)),
    },
    dispose: release,
  }
}
