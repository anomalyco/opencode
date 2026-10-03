// Temporary diff color tuner. Delete this directory, packages/session-ui/src/pierre/diff-color-tuning.ts,
// and the matching import/interpolation in packages/session-ui/src/pierre/index.ts when finished.
import path from "node:path"
import { resolveThemeVariantV2 } from "../../packages/ui/src/theme/v2/resolve"

const root = path.resolve(import.meta.dir, "../..")
const setsDir = path.join(import.meta.dir, "sets")
const localPath = path.join(import.meta.dir, "local.json")
const outputPath = path.join(root, "packages/session-ui/src/pierre/diff-color-tuning.ts")
const cdp = process.env.TUNER_CDP ?? "http://127.0.0.1:9222"
const port = Number(process.env.TUNER_PORT ?? 4455)

const theme = await Bun.file(path.join(root, "packages/ui/src/theme/themes/oc-2.json")).json()
// Alpha ramps are static CSS, not part of the resolved theme.
const alpha = Object.fromEntries(
  [...(await Bun.file(path.join(root, "packages/ui/src/styles/tokens/colors.css")).text()).matchAll(
    /--(v2-alpha-(?:dark|light)-\d+):\s*([^;]+);/g,
  )].map((match) => [match[1]!, match[2]!.trim()]),
)
const tokens = buildTokens()

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  routes: {
    "/": () => new Response(Bun.file(path.join(import.meta.dir, "index.html"))),
    "/api/tokens": Response.json(tokens),
    "/api/sets": {
      GET: async () => Response.json({ active: await activeSet(), sets: await listSets() }),
      POST: async (request) => {
        const body = await request.json()
        const id = await uniqueID(body.name)
        await writeSet(id, { ...body.set, name: body.name, readonly: false })
        return Response.json({ id })
      },
    },
    "/api/sets/:id": {
      GET: async (request) => {
        const file = Bun.file(setPath(request.params.id))
        return (await file.exists()) ? Response.json(await file.json()) : new Response("Not found", { status: 404 })
      },
      PUT: async (request) => {
        const id = request.params.id
        const current = await readSet(id)
        if (current?.readonly) return new Response("Read-only set", { status: 403 })
        const body = await request.json()
        await writeSet(id, { ...body.set, name: body.set.name ?? current?.name ?? id, readonly: false })
        return Response.json(await apply(id, body.css))
      },
      DELETE: async (request) => {
        const current = await readSet(request.params.id)
        if (!current || current.readonly) return new Response("Cannot delete", { status: 403 })
        await Bun.file(setPath(request.params.id)).delete()
        return Response.json({ ok: true })
      },
    },
    "/api/active": {
      POST: async (request) => {
        const body = await request.json()
        return Response.json(await apply(body.id, body.css))
      },
    },
    // The embedded browser pane may deny navigator.clipboard, so copy through the OS clipboard instead.
    "/api/copy": {
      POST: async (request) => {
        const process = Bun.spawn(["pbcopy"], { stdin: new Blob([await request.text()]) })
        return Response.json({ ok: (await process.exited) === 0 })
      },
    },
    "/api/live": {
      POST: async (request) => Response.json({ live: await push((await request.json()).css) }),
    },
  },
})

console.log(`Diff color tuner: http://127.0.0.1:${server.port}`)

type OverrideSet = { name: string; readonly?: boolean; enabled: boolean; disabledGroups?: Record<string, boolean>; slots: Record<string, unknown> }

function setPath(id: string) {
  return path.join(setsDir, `${id.replace(/[^\w-]/g, "")}.json`)
}

async function readSet(id: string): Promise<OverrideSet | undefined> {
  const file = Bun.file(setPath(id))
  return (await file.exists()) ? file.json() : undefined
}

function writeSet(id: string, set: OverrideSet) {
  return Bun.write(setPath(id), JSON.stringify(set, null, 2) + "\n")
}

async function listSets() {
  const ids = [...new Bun.Glob("*.json").scanSync(setsDir)].map((file) => file.slice(0, -5))
  const sets = await Promise.all(ids.map(async (id) => ({ id, ...(await readSet(id))! })))
  return sets
    .map((set) => ({ id: set.id, name: set.name, readonly: Boolean(set.readonly) }))
    .sort((a, b) => Number(b.readonly) - Number(a.readonly) || a.name.localeCompare(b.name))
}

async function activeSet() {
  const file = Bun.file(localPath)
  const active = (await file.exists()) ? (await file.json()).active : undefined
  return active && (await readSet(active)) ? active : "reference"
}

async function uniqueID(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "set"
  const taken = new Set((await listSets()).map((set) => set.id))
  return Array.from({ length: 100 }, (_, i) => (i ? `${base}-${i + 1}` : base)).find((id) => !taken.has(id))!
}

// Activating a set always rewrites the tuning module and pushes live CSS, so the dev app shows exactly the selected set.
async function apply(id: string, css: string) {
  await Bun.write(localPath, JSON.stringify({ active: id }, null, 2) + "\n")
  await Bun.write(outputPath, renderModule(css))
  return { live: await push(css) }
}

function renderModule(css: string) {
  const escaped = css.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
  return `// Temporary diff color tuning output. Generated by diff-color-review-artifacts/tuner; delete with the tuner.\nexport const diffColorTuningCSS = \`${escaped}\`\n`
}

function buildTokens() {
  const light = { ...alpha, ...resolveThemeVariantV2(theme.light, false) }
  const dark = { ...alpha, ...resolveThemeVariantV2(theme.dark, true) }
  const resolve = (map: Record<string, string>, value: string, depth = 0): string => {
    const match = /^var\(--([\w-]+)\)$/.exec(value.trim())
    if (!match || depth > 8) return value
    return map[match[1]!] ? resolve(map, map[match[1]!]!, depth + 1) : value
  }
  return Object.keys(light)
    .filter((name) => !name.includes("elevation") && !name.includes("font"))
    .map((name) => ({ name, light: resolve(light, light[name]!), dark: resolve(dark, dark[name] ?? light[name]!) }))
    .filter((token) => /^(#|rgb|hsl|oklch)/.test(token.light))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

// Live preview: Pierre reads unsafeCSS when a viewer mounts, so already-open diffs need the CSS pushed into their shadow roots.
async function push(css: string) {
  const targets: { type: string; webSocketDebuggerUrl: string }[] = await fetch(`${cdp}/json/list`)
    .then((response) => response.json())
    .catch(() => [])
  const counts = await Promise.all(
    targets.filter((target) => target.type === "page").map((target) => evaluate(target.webSocketDebuggerUrl, injector(css))),
  )
  return counts.reduce<number>((sum, count) => sum + (typeof count === "number" ? count : 0), 0)
}

function injector(css: string) {
  return `(() => {
  window.__diffColorTuning = ${JSON.stringify(css)}
  const apply = (host) => {
    const root = host.shadowRoot
    if (!root) return
    let style = root.querySelector("style[data-diff-color-tuning]")
    if (!style) {
      style = document.createElement("style")
      style.dataset.diffColorTuning = ""
      root.appendChild(style)
    }
    if (style.textContent !== window.__diffColorTuning) style.textContent = window.__diffColorTuning
  }
  const all = () => document.querySelectorAll("diffs-container").forEach(apply)
  all()
  if (!window.__diffColorTuningObserver) {
    let queued = false
    window.__diffColorTuningObserver = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; all() })
    })
    window.__diffColorTuningObserver.observe(document.body, { childList: true, subtree: true })
  }
  return document.querySelectorAll("diffs-container").length
})()`
}

function evaluate(url: string, expression: string) {
  return new Promise<unknown>((resolve) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      resolve(undefined)
    }, 2000)
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      resolve(message.result?.result?.value)
    }
    socket.onerror = () => {
      clearTimeout(timer)
      resolve(undefined)
    }
  })
}
