import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

interface Script {
  readonly metadata: Metadata
  readonly modules: Map<string, string>
  readonly assets?: { readonly files: Map<string, string>; readonly spa: boolean }
  schedules: { cron: string }[]
  loaded?: Promise<Handler>
}

interface Metadata {
  readonly main_module: string
  readonly bindings: readonly { type: string; name: string; [key: string]: unknown }[]
  readonly keep_bindings?: readonly string[]
  readonly assets?: { readonly jwt: string; readonly config: { readonly not_found_handling: string } }
}

interface Handler {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response
  scheduled: (controller: unknown, env: unknown, ctx: unknown) => Promise<void> | void
}

/**
 * Cloudflare's REST API for the calls the provider makes, in-process, and the Workers it deploys: each upload's
 * modules run in Bun behind the platform's asset routing, so a request reaches the generated entry module for real.
 */
export function fakeCloudflare() {
  const state = {
    calls: 0,
    failUpload: false,
    d1: new Map<string, { name: string; db: Database }>(),
    r2: new Set<string>(),
    kv: new Map<string, string>(),
    scripts: new Map<string, Script>(),
    blobs: new Map<string, Uint8Array>(),
    sessions: new Map<string, { manifest: Record<string, { hash: string }>; missing: Set<string> }>(),
    uploads: new Array<Metadata>(),
  }
  const directories = new Array<string>()
  const ok = (result: unknown = null, status = 200) => Response.json({ success: true, errors: [], result }, { status })
  const fail = (status: number, message: string) =>
    Response.json({ success: false, errors: [{ code: status, message }], result: null }, { status })

  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const auth = request.headers.get("authorization")
    if (url.pathname.endsWith("/workers/assets/upload")) {
      const session = state.sessions.get(auth?.slice("Bearer ".length) ?? "")
      if (!session) return fail(401, "bad upload token")
      const form = await request.formData()
      for (const [hash, value] of form.entries()) {
        state.blobs.set(hash, Buffer.from(typeof value === "string" ? value : await value.text(), "base64"))
        session.missing.delete(hash)
      }
      if (session.missing.size > 0) return ok({}, 202)
      const jwt = "completion-" + crypto.randomUUID()
      state.sessions.set(jwt, session)
      return ok({ jwt }, 201)
    }
    if (auth !== "Bearer token") return fail(403, "bad token")
    const [, , , , account, ...parts] = url.pathname.split("/")
    if (account !== "account") return fail(403, "wrong account")
    const at = parts.join("/")
    const body = (request.headers.get("content-type")?.includes("json") ? await request.json() : {}) as {
      name: string
      title: string
      sql: string
      manifest: Record<string, { hash: string }>
    }

    if (at === "workers/subdomain") return ok({ subdomain: "fake" })
    if (at === "d1/database" && request.method === "POST") {
      const uuid = crypto.randomUUID()
      state.d1.set(uuid, { name: body.name, db: new Database(":memory:") })
      return ok({ uuid, name: body.name })
    }
    const query = /^d1\/database\/([^/]+)\/query$/.exec(at)
    if (query) {
      const db = state.d1.get(query[1]!)?.db
      if (!db) return fail(404, "no such database")
      const sql: string = body.sql
      try {
        if (/^\s*select/i.test(sql)) return ok([{ results: db.query(sql).all(), success: true }])
        db.transaction(() => db.run(sql))()
        return ok([{ results: [], success: true }])
      } catch (error) {
        return fail(400, String(error))
      }
    }
    if (at === "r2/buckets" && request.method === "POST") {
      if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(body.name)) return fail(400, "invalid bucket name " + body.name)
      state.r2.add(body.name)
      return ok({ name: body.name })
    }
    if (at === "storage/kv/namespaces" && request.method === "POST") {
      const id = crypto.randomUUID().replaceAll("-", "")
      state.kv.set(id, body.title)
      return ok({ id, title: body.title })
    }
    const script = /^workers\/scripts\/([^/]+)(?:\/(.+))?$/.exec(at)
    if (!script) return fail(404, "no route " + request.method + " " + at)
    const name = script[1]!
    const action = script[2]
    const existing = state.scripts.get(name)
    if (action === "assets-upload-session") {
      const manifest: Record<string, { hash: string }> = body.manifest
      const missing = new Set(
        Object.values(manifest)
          .map((file) => file.hash)
          .filter((hash) => !state.blobs.has(hash)),
      )
      const jwt = "session-" + crypto.randomUUID()
      state.sessions.set(jwt, { manifest, missing })
      return ok({ jwt, buckets: missing.size > 0 ? [[...missing]] : [] })
    }
    if (action === undefined && request.method === "PUT") return upload(name, await request.formData())
    if (action === undefined && request.method === "DELETE") {
      if (!existing) return fail(404, "This Worker does not exist on your account.")
      state.scripts.delete(name)
      return ok()
    }
    if (!existing) return fail(404, "This Worker does not exist on your account.")
    if (action === "subdomain") return ok({ enabled: true })
    if (action === "schedules" && request.method === "PUT") {
      existing.schedules = body as unknown as { cron: string }[]
      return ok({ schedules: body })
    }
    return fail(404, "no route " + request.method + " " + at)
  }

  const upload = async (name: string, form: Awaited<ReturnType<Request["formData"]>>) => {
    const raw = form.get("metadata")
    const metadata: Metadata = JSON.parse(typeof raw === "string" ? raw : await raw!.text())
    if (state.failUpload) return fail(400, "Uncaught SyntaxError: Unexpected token")
    const modules = new Map<string, string>()
    for (const [key, value] of form.entries())
      if (key !== "metadata") modules.set(key, typeof value === "string" ? value : await value.text())
    if (!modules.has(metadata.main_module)) return fail(400, "main_module is missing")
    for (const binding of metadata.bindings) {
      const found =
        binding.type === "assets" ||
        (binding.type === "d1" && state.d1.has(String(binding.id))) ||
        (binding.type === "r2_bucket" && state.r2.has(String(binding.bucket_name))) ||
        (binding.type === "kv_namespace" && state.kv.has(String(binding.namespace_id)))
      if (!found) return fail(400, "binding " + binding.name + " points at nothing")
    }
    const session = metadata.assets && state.sessions.get(metadata.assets.jwt)
    if (metadata.assets && (!session || session.missing.size > 0)) return fail(400, "assets JWT not complete")
    state.uploads.push(metadata)
    state.scripts.set(name, {
      metadata,
      modules,
      assets: session
        ? {
            files: new Map(Object.entries(session.manifest).map(([file, entry]) => [file, entry.hash])),
            spa: metadata.assets!.config.not_found_handling === "single-page-application",
          }
        : undefined,
      schedules: state.scripts.get(name)?.schedules ?? [],
    })
    return ok({ id: name })
  }

  const load = (script: Script) => {
    script.loaded ??= (async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "fake-worker-"))
      directories.push(directory)
      await Promise.all([...script.modules].map(([file, source]) => writeFile(path.join(directory, file), source)))
      return (await import(path.join(directory, script.metadata.main_module))).default as Handler
    })()
    return script.loaded
  }

  const asset = (script: Script, pathname: string) => {
    const hash = script.assets?.files.get(pathname.endsWith("/") ? pathname + "index.html" : pathname)
    return hash === undefined ? undefined : new Response(state.blobs.get(hash))
  }

  const env = (script: Script) =>
    Object.fromEntries(
      script.metadata.bindings.map((binding) => [
        binding.name,
        binding.type === "assets"
          ? {
              fetch: (request: Request) =>
                asset(script, new URL(request.url).pathname) ??
                (script.assets?.spa ? asset(script, "/index.html")! : new Response("Not found", { status: 404 })),
            }
          : binding,
      ]),
    )

  const context = () => {
    const pending = new Array<Promise<unknown>>()
    return { pending, ctx: { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), props: {} } }
  }

  return {
    state,
    calls: () => state.calls,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      state.calls++
      return route(input instanceof Request ? input : new Request(String(input), init))
    }) as typeof fetch,
    /** What a visitor gets at a workers.dev URL: a matching asset, else the Worker. */
    serve: async (target: string | URL, init?: RequestInit) => {
      const url = new URL(target)
      const script = state.scripts.get(url.hostname.split(".")[0]!)
      if (!script) return new Response("There is nothing here yet", { status: 404 })
      const found = asset(script, url.pathname)
      if (found) return found
      const { ctx, pending } = context()
      const response = await (await load(script)).fetch(new Request(url.href, init), env(script), ctx)
      await Promise.all(pending)
      return response
    },
    /** Fires a Cron Trigger as the platform does, failing when the Worker has no such schedule. */
    scheduled: async (name: string, cron: string) => {
      const script = state.scripts.get(name)
      if (!script?.schedules.some((schedule) => schedule.cron === cron)) throw new Error("no trigger " + cron)
      const { ctx, pending } = context()
      await (await load(script)).scheduled({ cron, scheduledTime: Date.now(), noRetry() {} }, env(script), ctx)
      await Promise.all(pending)
    },
    cleanup: () => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))),
  }
}
