import { spawn } from "node:child_process"
import { existsSync, openSync } from "node:fs"
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import type { APIEvent } from "@solidjs/start/server"
import { formatEdit, type Edit } from "./edit"

// Development only: the video editor's file, render and proxy API (see product-videos/EDITOR.md). Reached through
// routes/video-editor/api/[...path].ts, which only loads this module when import.meta.env.DEV is true.

// The recording pipelines live outside the repo; by default in product-videos/ next to the checkout (the dev server
// runs from packages/console/app). Set PRODUCT_VIDEOS_DIR to use another folder.
const ROOT = resolve(process.env.PRODUCT_VIDEOS_DIR ?? join(process.cwd(), "../../../../product-videos"))
const EDITOR = join(ROOT, "editor")
const SITE = join(process.cwd(), "public", "product-videos")
const PIPELINES = ["real-ui", "real-cli", "real-ios"]
const PROXY_WIDTH = 1280
const types: Record<string, string> = {
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp4": "video/mp4",
}

export async function handle(event: APIEvent) {
  const url = new URL(event.request.url)
  const parts = url.pathname
    .replace(/^\/video-editor\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent)
  const method = event.request.method
  const route = parts[0]
  if (route === "videos" && method === "GET") return Response.json(await videos(), noStore)
  if (route === "engine.mjs") return file(join(EDITOR, "engine.mjs"))
  if (route === "edit" && method === "GET") return file(editPath(parts[1], parts[2]))
  if (route === "edit" && method === "PUT") return saveEdit(parts[1], parts[2], await event.request.json())
  if (route === "rendered")
    return file(join(ROOT, pipeline(parts[1]), "edits", ".rendered", `${safeName(parts[2])}.json`))
  if (route === "file") return file(inside(join(ROOT, pipeline(parts[1])), parts.slice(2).join("/")))
  if (route === "proxy")
    return proxy(
      parts[1],
      parts.slice(2, -1).join("/"),
      parts.at(-1) ?? "",
      Number(url.searchParams.get("w") ?? PROXY_WIDTH),
    )
  if (route === "warm" && method === "POST") return warm(parts[1], parts[2])
  if (route === "render" && method === "POST") return startRender(await event.request.json())
  if (route === "render" && parts[2] === "cancel" && method === "POST") return cancelRender(parts[1])
  if (route === "render" && method === "GET") return Response.json(await renderStatus(parts[1]), noStore)
  if (route === "renders" && method === "GET")
    return Response.json(await renders(url.searchParams.get("video") ?? ""), noStore)
  if (route === "restore" && method === "POST") return restore(await event.request.json())
  return new Response("Not found", { status: 404 })
}

const noStore = { headers: { "Cache-Control": "no-store" } }

function pipeline(name = "") {
  if (!PIPELINES.includes(name)) throw new Error(`unknown pipeline ${name}`)
  return name
}

function safeName(name = "") {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`bad name ${name}`)
  return name
}

const editPath = (pipe = "", name = "") => join(ROOT, pipeline(pipe), "edits", `${safeName(name)}.json`)

function inside(root: string, path: string) {
  const full = resolve(root, path)
  if (relative(root, full).startsWith("..")) throw new Error("outside the pipeline folder")
  return full
}

async function file(path: string, cache = "no-store") {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) return new Response("Not found", { status: 404 })
  const ext = path.slice(path.lastIndexOf("."))
  return new Response(await readFile(path), {
    headers: {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Content-Length": String(info.size),
      "Cache-Control": cache,
    },
  })
}

async function readEdit(pipe: string, name: string) {
  return JSON.parse(await readFile(editPath(pipe, name), "utf8")) as Edit
}

async function videos() {
  const lists = await Promise.all(
    PIPELINES.map(async (pipe) => {
      const names = (await readdir(join(ROOT, pipe, "edits")).catch(() => [] as string[])).filter((name) =>
        name.endsWith(".json"),
      )
      return Promise.all(
        names.map(async (entry) => {
          const name = entry.slice(0, -5)
          const edit = await readEdit(pipe, name)
          const out = edit.name ?? `${edit.product}-${edit.aspect}`
          const styles = await Promise.all(
            Object.entries(edit.styles).map(async ([style, config]) => {
              const mp4 = join(SITE, config.set, `${out}.mp4`)
              const info = await stat(mp4).catch(() => undefined)
              const version = info ? Math.round(info.mtimeMs) : 0
              return {
                style,
                set: config.set,
                video: `/product-videos/${config.set}/${out}.mp4?v=${version}`,
                poster: `/product-videos/${config.set}/${out}.jpg?v=${version}`,
                updated: info?.mtimeMs ?? 0,
                size: info?.size ?? 0,
              }
            }),
          )
          return {
            id: `${pipe}/${name}`,
            pipeline: pipe,
            name,
            title: edit.title,
            product: edit.product,
            aspect: edit.aspect,
            feature: Boolean(edit.name),
            styles,
          }
        }),
      )
    }),
  )
  return lists.flat()
}

async function saveEdit(pipe: string | undefined, name: string | undefined, body: Edit) {
  if (!Array.isArray(body?.shots) || body.shots.length === 0 || !body.styles || !body.sources)
    return new Response("Invalid edit", { status: 400 })
  const path = editPath(pipe, name)
  await writeFile(`${path}.tmp`, formatEdit(body))
  await rename(`${path}.tmp`, path)
  return Response.json({ ok: true })
}

// Proxy frames: the source frames scaled down for the browser (preview, filmstrip, thumbnails), cached in
// editor/cache/<pipeline>/<source dir>/<width>/.
async function proxy(pipe: string | undefined, dir: string, entry: string, width: number) {
  const root = join(ROOT, pipeline(pipe))
  const source = inside(root, join(dir, safeName(entry)))
  const w = Math.max(64, Math.min(PROXY_WIDTH, Math.round(width)))
  const cached = join(EDITOR, "cache", pipeline(pipe), dir, String(w), entry)
  if (!existsSync(cached)) {
    if (!existsSync(source)) return new Response("Not found", { status: 404 })
    await mkdir(dirname(cached), { recursive: true })
    const tmp = `${cached}.${process.pid}.${Math.random().toString(36).slice(2)}.jpg`
    await exec("ffmpeg", ["-v", "error", "-y", "-i", source, "-vf", `scale='min(${w},iw)':-2`, "-q:v", "4", tmp])
    await rename(tmp, cached)
  }
  return file(cached, "public, max-age=86400")
}

// Builds every proxy frame of a video's sources in the background, so playback doesn't wait for single frames.
async function warm(pipe: string | undefined, name: string | undefined) {
  const edit = await readEdit(pipeline(pipe), safeName(name))
  const started = await Promise.all(
    Object.values(edit.sources).map(async (source) => {
      const out = join(EDITOR, "cache", pipeline(pipe), source.dir, String(PROXY_WIDTH))
      const done = join(out, ".complete")
      if (existsSync(done) || existsSync(`${out}.warming`)) return false
      await mkdir(`${out}.warming`, { recursive: true })
      const pattern = `%0${source.pad ?? 4}d.jpg`
      const child = spawn(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-start_number",
          "0",
          "-i",
          join(ROOT, pipeline(pipe), source.dir, pattern),
          "-vf",
          `scale='min(${PROXY_WIDTH},iw)':-2`,
          "-q:v",
          "4",
          "-start_number",
          "0",
          join(`${out}.warming`, pattern),
        ],
        { stdio: "ignore" },
      )
      child.on("close", async () => {
        await mkdir(out, { recursive: true })
        const names = await readdir(`${out}.warming`)
        await Promise.all(names.map((entry) => rename(join(`${out}.warming`, entry), join(out, entry))))
        await writeFile(done, "")
        await exec("rm", ["-rf", `${out}.warming`])
      })
      return true
    }),
  )
  return Response.json({ started: started.filter(Boolean).length })
}

type RenderRequest = {
  pipeline: string
  name: string
  style: string
  hdr?: boolean
  publish?: boolean
  draft?: boolean
}
type RenderMeta = RenderRequest & { id: string; pid: number; started: number }

async function startRender(body: RenderRequest) {
  const path = editPath(body.pipeline, body.name)
  const id = `${Date.now().toString(36)}-${safeName(body.name)}`
  const dir = join(EDITOR, "jobs")
  await mkdir(dir, { recursive: true })
  const log = openSync(join(dir, `${id}.log`), "w")
  const args = [join(EDITOR, "render.mjs"), path, "--style", body.style || "both"]
  if (body.publish !== false) args.push("--publish")
  if (body.hdr) args.push("--hdr")
  if (body.draft) args.push("--maxs", "4")
  const child = spawn("node", args, {
    cwd: EDITOR,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, SITE_VIDEOS: SITE },
  })
  child.unref()
  const meta: RenderMeta = { ...body, id, pid: child.pid ?? 0, started: Date.now() }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta))
  return Response.json(meta)
}

async function cancelRender(id = "") {
  const meta = JSON.parse(await readFile(join(EDITOR, "jobs", `${safeName(id)}.json`), "utf8")) as RenderMeta
  if (alive(meta.pid)) process.kill(meta.pid)
  return Response.json({ ok: true })
}

function alive(pid: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

type RenderEvent = {
  type: string
  text?: string
  style?: string
  frame?: number
  count?: number
  results?: unknown[]
  at: number
}

async function renderStatus(id = "") {
  const dir = join(EDITOR, "jobs")
  const meta = JSON.parse(await readFile(join(dir, `${safeName(id)}.json`), "utf8")) as RenderMeta
  const lines = (await readFile(join(dir, `${meta.id}.log`), "utf8").catch(() => "")).split("\n").filter(Boolean)
  const events = lines.map((line): RenderEvent => {
    if (!line.startsWith("{")) return { type: "log", text: line, at: 0 }
    return JSON.parse(line) as RenderEvent
  })
  const done = events.find((event) => event.type === "done")
  const error = events.find((event) => event.type === "error")
  const progress = events.filter((event) => event.type === "progress").at(-1)
  const running = alive(meta.pid)
  return {
    ...meta,
    status: done ? "done" : error ? "error" : running ? "running" : "stopped",
    progress: progress ? { style: progress.style, frame: progress.frame, count: progress.count } : undefined,
    log: events
      .filter((event) => event.type !== "progress")
      .map((event) => event.text ?? "")
      .slice(-60),
    results: done?.results ?? [],
  }
}

async function renders(video: string) {
  const dir = join(EDITOR, "jobs")
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"))
  const metas = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as RenderMeta),
  )
  return metas
    .filter((meta) => !video || `${meta.pipeline}/${meta.name}` === video)
    .toSorted((a, b) => b.started - a.started)
    .slice(0, 10)
}

// Puts back the files from the newest editor backup of this video (the files a render replaced). The current files
// are kept in a backup/editor-<time>-before-restore/ folder first.
async function restore(body: { pipeline: string; name: string; style: string }) {
  const edit = await readEdit(pipeline(body.pipeline), safeName(body.name))
  const out = edit.name ?? `${edit.product}-${edit.aspect}`
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const restored = await Promise.all(
    Object.entries(edit.styles)
      .filter(([style]) => body.style === "both" || body.style === style)
      .map(async ([, config]) => {
        const setDir = join(SITE, config.set)
        const backups = (await readdir(join(setDir, "backup")).catch(() => [] as string[]))
          .filter((name) => /^editor-[\d-T]+$/.test(name) && existsSync(join(setDir, "backup", name, `${out}.mp4`)))
          .toSorted()
        const latest = backups.at(-1)
        if (!latest) return { set: config.set, restored: false }
        const files = [`${out}.mp4`, `${out}.jpg`, `hdr/${out}.mp4`].filter((entry) =>
          existsSync(join(setDir, "backup", latest, entry)),
        )
        const keep = join(setDir, "backup", `editor-${stamp}-before-restore`)
        for (const entry of files) {
          if (existsSync(join(setDir, entry))) {
            await mkdir(dirname(join(keep, entry)), { recursive: true })
            await copyFile(join(setDir, entry), join(keep, entry))
          }
          await copyFile(join(setDir, "backup", latest, entry), join(setDir, entry))
        }
        const savedEdit = join(setDir, "backup", latest, `${out}.edit.json`)
        if (existsSync(savedEdit))
          await copyFile(
            savedEdit,
            join(ROOT, pipeline(body.pipeline), "edits", ".rendered", `${safeName(body.name)}.json`),
          )
        // The backup is used up: the next restore goes one render further back.
        await rename(join(setDir, "backup", latest), join(setDir, "backup", `${latest}-restored`))
        return { set: config.set, restored: true, from: latest, files }
      }),
  )
  return Response.json({ restored })
}

function exec(cmd: string, args: string[]) {
  return new Promise<void>((done, fail) =>
    spawn(cmd, args, { stdio: "ignore" }).on("close", (code) =>
      code === 0 ? done() : fail(new Error(`${cmd} exited ${code}`)),
    ),
  )
}
