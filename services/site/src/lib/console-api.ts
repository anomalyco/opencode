import { config } from "~/config"
import { androidSoon, installs, mobileStores, sdkDocs } from "~/component/site/product-data"
import { docsConfigure, docsPages, docsProducts } from "~/lib/docs-content"
import { desktopBuilds, desktopInstall, detectOS, getDownloadHref } from "~/lib/download"
import { detectPlatform } from "~/lib/platform"
import { modules, type Letter } from "~/lib/font-content"
import { freeModels } from "~/lib/get-started"
import { sdkInstalls } from "~/lib/install-commands"

// window.opencode: a small console API for developers who open DevTools on the site. Site loads
// this module once the page is idle (Settings › Other › Console API). opencode.try() and
// opencode.install.pick() load Text.js console apps from /textjs/ (services/site/textjs) on
// demand, so React and Text.js never enter the site's own bundles.
//
// OpenCode Lite also starts on its own once a visitor shows they want the console: DevTools docks,
// they press a DevTools shortcut on the page, or it already started in this tab. Text.js's
// onConsoleIntent watches for that; its ~2 kB chunk is all a desktop visitor downloads until then,
// and touch screens skip it. Quitting Lite turns this off for the browser until opencode.try().

const brand = {
  light: { open: "#626262", code: "#1f1f1f", inner: "#d2d2d2", text: "#333333", dim: "#737373", link: "#3b5cf6" },
  dark: { open: "#aeaeae", code: "#eeeeee", inner: "#4b4b4b", text: "#c8c8c8", dim: "#8a8a8a", link: "#4f8bff" },
}
const mono = "font-family: ui-monospace, Menlo, Consolas, monospace;"
const buildLabels: Record<string, string> = {
  "darwin-aarch64-dmg": "macOS (Apple Silicon)",
  "darwin-x64-dmg": "macOS (Intel)",
  "windows-x64-nsis": "Windows (x64)",
  "windows-aarch64-nsis": "Windows (ARM64)",
  "linux-x64-deb": "Linux (.deb, x64)",
  "linux-aarch64-deb": "Linux (.deb, ARM64)",
  "linux-x64-rpm": "Linux (.rpm, x64)",
  "linux-aarch64-rpm": "Linux (.rpm, ARM64)",
  "linux-x64-appimage": "Linux (AppImage, x64)",
  "linux-aarch64-appimage": "Linux (AppImage, ARM64)",
}
const buildIds: Record<string, string> = {
  "darwin-aarch64-dmg": "mac-arm",
  "darwin-x64-dmg": "mac-intel",
  "windows-x64-nsis": "windows",
  "windows-aarch64-nsis": "windows-arm",
  "linux-x64-deb": "deb",
  "linux-aarch64-deb": "deb-arm",
  "linux-x64-rpm": "rpm",
  "linux-aarch64-rpm": "rpm-arm",
  "linux-x64-appimage": "appimage",
  "linux-aarch64-appimage": "appimage-arm",
}
const liteQuitKey = "opencode-lite-quit"
const docsTopics = [...docsPages, ...docsConfigure, ...docsProducts.filter((item) => item.label !== "V1")]

export function install() {
  if (Object.hasOwn(window, "opencode")) return
  const colors = matchMedia("(prefers-color-scheme: dark)").matches ? brand.dark : brand.light
  const say = (...parts: [string, string?][]) =>
    console.log(
      parts.map((part) => `%c${part[0]}`).join(""),
      ...parts.map((part) => mono + (part[1] ?? `color:${colors.text}`)),
    )
  const dim = `color:${colors.dim}`
  const strong = `color:${colors.code}`
  const url = (path: string) => (path.startsWith("http") ? path : `${location.origin}${path}`)
  const os = detectOS()
  const builds = desktopBuilds.map((build) => ({
    id: buildIds[build.id] ?? build.id,
    label: buildLabels[build.id] ?? build.id,
    url: url(getDownloadHref(build.id)),
  }))
  const command = (id: string) => installs.find((item) => item.id === id)?.command
  const forThisComputer =
    os === "Windows" ? ["npm", "bun"] : os === "macOS" ? ["brew", "curl"] : ["curl", "npm", "paru"]

  const manifest = {
    site: location.origin,
    about: "OpenCode, the open source coding agent",
    pages: {
      product: url("/product"),
      docs: url(docsTopics[0].href),
      changelog: url("/changelog"),
      console: url("/console"),
      models: url("/console/models"),
      data: url("/data"),
      subscriptions: url("/console/go"),
      discord: config.social.discord,
    },
    agents: {
      llms: url("/llms.txt"),
      llmsFull: url("/llms-full.txt"),
      markdown: "add .md to a page URL, or send Accept: text/markdown",
      sitemap: url("/sitemap.xml"),
      releases: { rss: url("/changelog.xml"), json: url("/changelog.json") },
      openapi: url("/openapi.json"),
    },
    install: { ...Object.fromEntries(installs.map((item) => [item.id, item.command])), cask: desktopInstall.command },
    desktop: Object.fromEntries(builds.map((build) => [build.id, build.url])),
    mobile: url("/mobile"),
    sdk: { install: sdkInstalls[0].command, docs: url(sdkDocs) },
    source: config.github.repoUrl,
  }

  const printInstall = (id?: string) => {
    if (id) {
      const found = command(id)
      if (!found) return say([`Try one of: ${installs.map((item) => item.id).join(", ")}`, dim])
      say(["› ", dim], [found, strong])
      return found
    }
    say([`Install OpenCode${os ? ` on ${os}` : ""}:`, dim])
    forThisComputer.forEach((id) => say(["› ", dim], [command(id) ?? "", strong], [`   # ${id}`, dim]))
    say(["Others: opencode.install('npm' | 'bun' | 'brew' | 'paru' | 'curl'). Pick one: opencode.install.pick()", dim])
    return command(forThisComputer[0])
  }

  // One OpenCode Lite at a time. Quitting it brings the greeting back, and stops it from starting on
  // its own in this browser (people who debug the site open DevTools all day) until opencode.try().
  let lite: Promise<{ stop: () => void }> | undefined
  const startLite = (reason?: string) => {
    if (lite) return lite
    // Lite takes a moment to download, and the visitor may click back into the page from DevTools
    // meanwhile. Its keyboard needs to know that focus left the page (see src/lite.tsx). A DevTools
    // shortcut counts at once, since DevTools takes focus as it opens.
    let away = reason === "shortcut" || !document.hasFocus()
    const blur = () => (away = true)
    window.addEventListener("blur", blur)
    lite = textjs<{
      start: (options: { away: () => boolean; onExit: () => void }) => Promise<{ stop: () => void }>
    }>("lite").then((app) =>
      app.start({
        away: () => away,
        onExit: () => {
          lite = undefined
          localStorage.setItem(liteQuitKey, "1")
          void import("@textjs/core/experimental").then((textjs) =>
            sessionStorage.removeItem(textjs.CONSOLE_INTENT_KEY),
          )
          greet(colors, say)
          say([
            "OpenCode Lite won't start on its own in this browser again. Type opencode.try() to bring it back.",
            dim,
          ])
        },
      }),
    )
    lite.finally(() => window.removeEventListener("blur", blur)).catch(() => (lite = undefined))
    return lite
  }

  const pick = async () => {
    // Two apps can't share the console: the picker takes it from OpenCode Lite.
    await lite?.then((app) => app.stop()).catch(() => undefined)
    lite = undefined
    say(["Click an empty part of the page, then use ↑ ↓ and Enter: keys reach the console app through the page.", dim])
    const options = [
      ...installs.map((item) => ({ value: item.command, label: item.id, description: item.command })),
      ...builds.map((build) => ({ value: build.url, label: `desktop ${build.id}`, description: build.label })),
      { value: desktopInstall.command, label: "desktop cask", description: desktopInstall.command },
    ]
    const picker = await textjs<{ pick: (input: unknown) => Promise<string | undefined> }>("picker").catch(
      () => undefined,
    )
    if (!picker) {
      say(["The picker couldn't load here, so here are the commands instead.", dim])
      return printInstall()
    }
    const chosen = await picker.pick({ options, selected: command(forThisComputer[0]), dark: colors === brand.dark })
    if (!chosen) return
    const copied = await navigator.clipboard.writeText(chosen).then(
      () => true,
      () => false,
    )
    say([copied ? "Copied: " : "Copy this: ", dim], [chosen, strong])
    return chosen
  }

  const api = {
    help() {
      console.table({
        "opencode.install()": "the install command for this computer",
        "opencode.install('brew')": "or one of: curl, npm, bun, brew, paru",
        "opencode.install.pick()": "choose one with the arrow keys and copy it",
        "opencode.download()": "desktop builds; download('mac-arm') starts one",
        "opencode.mobile()": androidSoon
          ? "the iPhone beta on TestFlight, Android coming soon"
          : "the iPhone beta and the Android app",
        "opencode.sdk()": "the TypeScript SDK",
        "opencode.models()": "the free models, live from models.dev",
        "opencode.docs('agents')": "open a docs page; docs() lists them",
        "opencode.agents()": "this site, for agents",
        "opencode.contribute()": "help build OpenCode",
        "opencode.manifest": "all of the above, as one object",
        "opencode.try()": "OpenCode Lite in this console: a sandbox, nothing to install",
      })
    },
    install: Object.assign(
      (input?: string | { interactive?: boolean }) =>
        typeof input === "object" && input.interactive
          ? pick()
          : printInstall(typeof input === "string" ? input : undefined),
      { pick },
    ),
    download(id?: string) {
      if (id) {
        const build = builds.find((item) => item.id === id)
        if (!build) return say([`Try one of: ${builds.map((item) => item.id).join(", ")}`, dim])
        window.open(build.url, "_blank", "noopener")
        return build.url
      }
      console.table(Object.fromEntries(builds.map((build) => [build.id, { build: build.label, url: build.url }])))
      say(["Homebrew: ", dim], [desktopInstall.command, strong])
      return builds.map((build) => build.url)
    },
    mobile() {
      const devices = (soon: boolean) =>
        mobileStores.filter((store) => store.soon === soon).map((store) => store.device)
      say([`OpenCode Mobile for ${devices(false).join(" and ")}: ${url("/mobile")}`])
      for (const store of mobileStores.filter((item) => item.beta))
        say([`The ${store.device} app is a public beta on TestFlight: ${store.href}`, dim])
      if (devices(true).length > 0) say([`Coming soon to ${devices(true).join(" and ")}.`, dim])
      say(["Pair it with your computer: run opencode pair in a terminal.", dim])
      return url("/mobile")
    },
    sdk() {
      say(["› ", dim], [manifest.sdk.install, strong])
      say(['import { OpenCode } from "@opencode/sdk"'])
      say([`Docs: ${manifest.sdk.docs}`, dim])
      return manifest.sdk.install
    },
    async models() {
      const live = await fetch("https://models.dev/api.json")
        .then((response) => response.json() as Promise<ModelsDev>)
        .then((data) =>
          Object.values(data.opencode?.models ?? {}).filter(
            (model) => model.cost?.input === 0 && model.cost?.output === 0 && model.status !== "deprecated",
          ),
        )
        .catch(() => [])
      if (!live.length) {
        say([`Free models include ${freeModels.join(", ")}. No account needed.`])
        return freeModels
      }
      console.table(Object.fromEntries(live.map((model) => [model.name, { id: `opencode/${model.id}` }])))
      say([`No account needed. Try one: opencode run -m opencode/${live[0].id} "hello"`, dim])
      return live.map((model) => `opencode/${model.id}`)
    },
    docs(topic?: string) {
      if (!topic) {
        console.table(Object.fromEntries(docsTopics.map((item) => [item.label, url(item.href)])))
        return docsTopics.map((item) => item.label.toLowerCase())
      }
      const key = topic.toLowerCase()
      const page = docsTopics.find((item) => item.label.toLowerCase() === key || item.href.endsWith(`/${key}`))
      const href = url(page?.href ?? docsTopics[0].href)
      window.open(href, "_blank", "noopener")
      return href
    },
    agents() {
      console.table({
        "Every page, linked as Markdown": manifest.agents.llms,
        "Every page in one file": manifest.agents.llmsFull,
        "One page as Markdown": `${url("/desktop.md")} (or send Accept: text/markdown)`,
        Sitemap: manifest.agents.sitemap,
        Releases: `${manifest.agents.releases.rss}  ${manifest.agents.releases.json}`,
        "OpenCode server API": manifest.agents.openapi,
      })
      return manifest.agents.llms
    },
    contribute() {
      say(["OpenCode is open source (MIT). Come build it with us:"])
      say([`  Good first issues  ${config.github.repoUrl}/contribute`, dim])
      say([`  Contributing       ${config.github.repoUrl}/blob/dev/CONTRIBUTING.md`, dim])
      say([`  Discord            ${config.social.discord}`, dim])
      return `${config.github.repoUrl}/blob/dev/CONTRIBUTING.md`
    },
    manifest,
    async try() {
      localStorage.removeItem(liteQuitKey)
      if (lite) return say(["OpenCode Lite is already running. Click an empty part of the page, then type.", dim])
      say(["Click an empty part of the page, then type: keys reach the console app through the page.", dim])
      if (["ios", "android"].includes(detectPlatform() ?? ""))
        return say(["OpenCode Lite needs a desktop browser with DevTools. Try https://textjs.org/opencode", dim])
      if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
        say(["In Safari, turn on Settings › Advanced › Show features for web developers.", dim])
      const started = await startLite().then(
        () => true,
        () => false,
      )
      if (!started)
        return say([
          "OpenCode Lite couldn't load here. Try it at https://textjs.org/opencode, or install OpenCode: opencode.install()",
          dim,
        ])
    },
    toString: () => "opencode: type opencode.help()",
  }
  Object.defineProperty(window, "opencode", { value: api, configurable: true, writable: true })
  // The greeting waits in the console for whoever opens DevTools later, and OpenCode Lite's first
  // frame replaces it then. When DevTools is already docked (or Lite already ran in this tab), Lite
  // starts at once and the greeting is skipped. If Lite can't load, the greeting shows instead.
  // After a visitor quits Lite, only the greeting shows.
  const greetOnce = () => {
    if (sessionStorage.getItem("opencode-console-greeted")) return
    sessionStorage.setItem("opencode-console-greeted", "1")
    greet(colors, say)
  }
  if (matchMedia("(hover: none) and (pointer: coarse)").matches || localStorage.getItem(liteQuitKey)) return greetOnce()
  import("@textjs/core/experimental").then((textjs) => {
    // Settings › Other › Console API removes window.opencode when it's turned off, and Lite may have
    // been started by hand and quit since this page loaded.
    const intent = textjs.onConsoleIntent(
      (e) =>
        (window as { opencode?: unknown }).opencode === api &&
        !localStorage.getItem(liteQuitKey) &&
        void startLite(e.reason).catch(greetOnce),
      { engageSelector: false },
    )
    if (!intent.triggered) greetOnce()
  }, greetOnce)
}

type ModelsDev = Record<
  string,
  { models?: Record<string, { id: string; name: string; status?: string; cost?: { input?: number; output?: number } }> }
>

/** Loads a Text.js console app built by packages/console/textjs; its manifest maps names to hashed files. */
async function textjs<T>(name: "lite" | "picker") {
  const files = (await fetch("/textjs/manifest.json").then((response) => response.json())) as Record<string, string>
  return (await import(/* @vite-ignore */ `/textjs/${files[name]}`)) as T
}

/** The view-source logo (the wordmark with a ░ drop shadow) in colour, then three lines. */
function greet(colors: typeof brand.light, say: (...parts: [string, string?][]) => void) {
  const word = [..."opencode"] as Letter[]
  const ink = (x: number, y: number) => {
    const letter = word[Math.floor(x / 10)]
    const column = Math.floor((x % 10) / 2)
    return y >= 0 && y < 7 && x >= 0 && column < 4 && letter !== undefined && modules[letter][y][column] === "#"
  }
  const styles: string[] = []
  const rows = Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 80 }, (_, x) => {
      const color = ink(x, y) ? (x < 40 ? colors.open : colors.code) : ink(x - 2, y - 1) ? colors.inner : undefined
      return { char: color ? "█" : " ", style: color ? `color:${color}` : "" }
    }),
  )
  let text = ""
  let last: string | undefined
  rows.forEach((row) => {
    row.forEach((cell) => {
      if (cell.style !== last) {
        text += "%c"
        styles.push(`${mono}line-height:1.15;${cell.style}`)
        last = cell.style
      }
      text += cell.char
    })
    text += "\n"
  })
  console.log(text, ...styles)
  say(["OpenCode, the open source coding agent.", `font-weight:bold;color:${colors.code}`])
  say(
    ["Type ", `color:${colors.dim}`],
    ["opencode.help()", `color:${colors.link}`],
    [" to install, download or read the docs from here.", `color:${colors.dim}`],
  )
  say(["Or try OpenCode right in this console: ", `color:${colors.dim}`], ["opencode.try()", `color:${colors.link}`])
  const links = [
    ["Contribute", config.github.repoUrl],
    ["Good first issues", `${config.github.repoUrl}/labels/good%20first%20issue`],
    ["Discord", config.social.discord],
    ["What's new", `${config.baseUrl}/changelog`],
  ]
  const width = Math.max(...links.map((item) => item[0].length)) + 3
  links.forEach((item) => say([item[0].padEnd(width), `color:${colors.dim}`], [item[1], `color:${colors.link}`]))
}
