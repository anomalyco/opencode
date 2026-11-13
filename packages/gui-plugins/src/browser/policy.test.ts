import { expect, test } from "bun:test"
import {
  agentFrame,
  agentFrames,
  agentRefusal,
  allowedDestination,
  committedLoad,
  destinationOrigin,
  extensionOrigin,
  fileURLWithin,
  localFileURL,
  normalizeURL,
  refusal,
} from "./policy"

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example")
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000")

  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(url)).toBeUndefined()
  }
})

test("file documents load only from allowed workspace roots and never from a host", () => {
  expect(localFileURL("file:///C:/work/out/report.html")).toBe("file:///C:/work/out/report.html")
  expect(localFileURL("file://server/share/report.html")).toBeUndefined()
  expect(localFileURL("https://example.com")).toBeUndefined()

  const roots = ["/home/me/repo"]
  expect(fileURLWithin("file:///home/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo-other/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/../.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/out/%2e%2e/%2e%2e/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/x.html", [])).toBe(false)
  expect(fileURLWithin("file://server/home/me/repo/x.html", roots)).toBe(false)

  expect(allowedDestination("file:///home/me/repo/x.html")).toBe(false)
  expect(allowedDestination("file:///home/me/repo/x.html", { fileRoots: roots })).toBe(true)
  expect(allowedDestination("file:///etc/passwd", { fileRoots: roots })).toBe(false)
  expect(allowedDestination("javascript:alert(1)", { fileRoots: roots })).toBe(false)

  expect(normalizeURL("file:///home/me/repo/x.html", { fileRoots: roots })).toBe("file:///home/me/repo/x.html")
  expect(() => normalizeURL("file:///home/me/repo/x.html")).toThrow()
  expect(() => normalizeURL("file:///etc/passwd", { fileRoots: roots })).toThrow()
  expect(normalizeURL("localhost:3000", { fileRoots: roots })).toBe("http://localhost:3000")
  expect(normalizeURL("app.localhost:3000/")).toBe("http://app.localhost:3000/")
  expect(normalizeURL(" ABOUT:BLANK ")).toBe("about:blank")
})

test("the pane names why it refuses an address, so the window can explain it", () => {
  const roots = ["/home/me/repo"]

  expect(
    [
      "example.com",
      "about:blank",
      "file:///home/me/repo/x.html",
      "https://user:pass@example.com",
      "file:///etc/passwd",
      "file://server/home/me/repo/x.html",
      "ftp://example.com",
      "about:config",
    ].map((url) => refusal(url, { fileRoots: roots })),
  ).toEqual([
    undefined,
    undefined,
    undefined,
    "browser.address.credentials",
    "browser.address.workspace",
    "browser.address.workspace",
    "browser.address.workspace",
    "browser.address.workspace",
  ])
  // Where no files open, only web pages do.
  expect(refusal("file:///home/me/repo/x.html")).toBe("browser.address.web")
  expect(() => normalizeURL("https://user:pass@example.com")).toThrow("user name or password")
})

test("windows workspace roots match drive-letter file URLs", () => {
  const roots = ["C:\\Users\\me\\repo"]
  const inside = process.platform === "win32"
  expect(fileURLWithin("file:///C:/Users/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///c:/users/me/repo/out/index.html", roots)).toBe(inside)
  expect(fileURLWithin("file:///C:/Users/me/repo2/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///D:/Users/me/repo/x.html", roots)).toBe(false)
})

test("a media URL whose viewer committed has loaded, while a download or network failure still fails", () => {
  // The shape Electron's loadURL rejects with when loading stops before did-finish-load.
  const stopped = Object.assign(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1/clip.mp4'"), {
    errno: -2,
    code: "ERR_FAILED",
  })

  const refused = Object.assign(new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1/'"), {
    errno: -102,
    code: "ERR_CONNECTION_REFUSED",
  })

  expect(committedLoad(stopped, true)).toBe(true)
  expect(committedLoad(stopped, false)).toBe(false)
  expect(committedLoad(refused, true)).toBe(false)
  expect(committedLoad(new Error("ERR_FAILED"), true)).toBe(false)
})

test("only the pages of a loaded extension open, so its popup and options can show in a tab", () => {
  const extensions = ["nngceckbapebfimnlniiiahkandclblb"]

  expect(
    [
      "chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html",
      "chrome://settings",
    ].map((url) => allowedDestination(url, { extensions })),
  ).toEqual([true, false, false])
  expect(allowedDestination("chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html")).toBe(false)
  expect(refusal("chrome-extension://nngceckbapebfimnlniiiahkandclblb/options.html", { extensions })).toBeUndefined()
})

const extensionPage = "chrome-extension://nngceckbapebfimnlniiiahkandclblb/options.html"

const web = { url: "https://example.com/", origin: "https://example.com" }

test("the agent cannot open an extension page in a tab", () => {
  expect(agentRefusal({ type: "navigate", url: extensionPage }, web)).toStartWith(
    `Agent browser tools cannot open extension pages such as ${extensionPage}`,
  )
  expect(agentRefusal({ type: "tabs.open", url: ` ${extensionPage}` }, web)).toStartWith(
    "Agent browser tools cannot open extension pages",
  )
  expect(agentRefusal({ type: "navigate", url: "moz-extension://x/popup.html" }, web)).toBeDefined()
})

test("the agent cannot read or act on an extension page, even one the user opened", () => {
  const opened = { url: extensionPage, origin: "chrome-extension://nngceckbapebfimnlniiiahkandclblb" }

  for (const type of [
    "evaluate",
    "snapshot",
    "click",
    "fill",
    "screenshot",
    "console",
    "network.list",
    "files.list",
    "dialog",
    "wait",
  ])
    expect(agentRefusal({ type }, opened)).toStartWith(`This tab shows an extension page (${extensionPage})`)
  // A blank page or blob an extension opened runs as that extension too.
  expect(agentRefusal({ type: "evaluate" }, { url: "about:blank", origin: opened.origin })).toBeDefined()
  expect(agentRefusal({ type: "evaluate" }, { url: `blob:${opened.origin}/0b6f7c2e`, origin: "null" })).toBeDefined()

  // Taking the tab elsewhere is allowed; the page checks again where it lands.
  for (const type of ["navigate", "back", "forward", "stop"])
    expect(agentRefusal({ type, url: "https://example.com/" }, opened)).toBeUndefined()
})

test("an extension's frame in a web page is no frame the agent can list or target", () => {
  const frames = agentFrames(
    {
      frame: { id: "main", url: "https://example.com/", securityOrigin: "https://example.com" },
      childFrames: [
        { frame: { id: "ad", parentId: "main", url: "https://ads.example/", name: "ad" } },
        {
          frame: { id: "overlay", parentId: "main", url: "about:blank", securityOrigin: "chrome-extension://abc" },
          childFrames: [{ frame: { id: "inner", parentId: "overlay", url: "https://example.com/inner" } }],
        },
      ],
    },
    [
      // Out-of-process frames: the extension's own, one nested in it, and a web one.
      { parentID: "main", tree: { frame: { id: "autofill", url: "chrome-extension://abc/menu.html" } } },
      { parentID: "autofill", tree: { frame: { id: "nested", url: "https://example.org/" } } },
      { parentID: "ad", tree: { frame: { id: "video", url: "https://video.example/" } } },
    ],
  )

  expect(frames.map((frame) => frame.id)).toEqual(["main", "ad", "video"])
  expect(extensionOrigin("chrome-extension://abc")).toBe(true)
  expect(extensionOrigin("https://example.com")).toBe(false)
})

test("a frameID the agent passes resolves only to a frame it may use, and names an extension's frame", () => {
  const root = {
    frame: { id: "main", url: "https://example.com/", securityOrigin: "https://example.com" },
    childFrames: [
      { frame: { id: "same", parentId: "main", url: "https://example.com/inner" } },
      {
        frame: { id: "opened", parentId: "main", url: "about:blank", securityOrigin: "chrome-extension://abc" },
        childFrames: [{ frame: { id: "inside", parentId: "opened", url: "https://example.com/x" } }],
      },
    ],
  }

  const children = [{ parentID: "main", tree: { frame: { id: "cross", url: "https://other.example/" } } }]
  // The extension's own out-of-process frame, whose tree is never read, and a frame that just became one.
  const extensions = new Set(["overlay", "cross-now-extension"])
  const access = (frameID: string, known = extensions) => agentFrame(root, children, known, frameID).type

  expect(agentFrame(root, children, extensions, "same")).toEqual({
    type: "frame",
    frame: { id: "same", parentID: "main", url: "https://example.com/inner", name: "" },
  })
  expect(access("cross")).toBe("frame")
  expect(access("main")).toBe("frame")
  expect(access("overlay")).toBe("extension")
  expect(access("opened")).toBe("extension")
  expect(access("inside")).toBe("extension")
  expect(access("made-up")).toBe("unavailable")
  // A web frame that now shows an extension's document is refused, even though its last tree read was a web page.
  expect(access("cross", new Set(["cross"]))).toBe("extension")
  expect(agentFrame(root, children, extensions, "overlay")).toMatchObject({
    message: expect.stringContaining("Agent browser tools cannot use extension frames"),
  })
})

test("a web tab stays fully usable by the agent", () => {
  for (const type of ["evaluate", "snapshot", "click", "screenshot", "files.get"])
    expect(agentRefusal({ type }, web)).toBeUndefined()
  expect(agentRefusal({ type: "navigate", url: "https://example.org/" }, web)).toBeUndefined()
  expect(
    agentRefusal({ type: "tabs.open", url: "localhost:3000" }, { url: "about:blank", origin: "null" }),
  ).toBeUndefined()
})

test("the user still opens extension pages the agent may not", () => {
  const extensions = ["nngceckbapebfimnlniiiahkandclblb"]

  expect(refusal(extensionPage, { extensions })).toBeUndefined()
  expect(agentRefusal({ type: "navigate", url: extensionPage }, web)).toBeDefined()
})
