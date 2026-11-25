import { Plugin, type Artifact } from "@opencode/plugin"
import type { ArtifactProviderDefinition, ArtifactPublishInput } from "@opencode/plugin/promise/artifact"

export interface Options {
  readonly accountId: string
  readonly apiToken: string
  /** Starts the name of every Worker, database, namespace and bucket this provider creates. */
  readonly prefix?: string
  readonly fetch?: typeof fetch
}

/** What a publish created, saved with the artifact: its Worker and the resource behind each binding, by name. */
export interface Receipt {
  readonly script: string
  readonly bindings: Readonly<Record<string, { readonly kind: Artifact.Binding["kind"]; readonly id: string }>>
}

const API = "https://api.cloudflare.com/client/v4"
const COMPATIBILITY_DATE = "2026-11-01"
const BATCH_BYTES = 15 * 1024 * 1024
const ENTRY = "__opencode_entry.mjs"
const APP = "app.mjs"

const prompt = `Publishes to a Cloudflare Worker at https://<worker>.<subdomain>.workers.dev. Every artifact is public.

A folder without artifact.json is served as static files. For more, add an artifact.json such as:
{ "assets": "dist", "spa": true, "server": "server.js", "bindings": [{ "name": "DB", "kind": "sqlite", "migrations": ["migrations"] }], "crons": [{ "schedule": "0 * * * *", "path": "/tasks/hourly" }] }
- assets: the built folder, served as files before the server sees a request. With "spa": true, a browser navigation that matches no file gets index.html, so serve APIs from paths the app fetches, such as /api/*.
- server: one bundled ES module, such as the output of "wrangler deploy --dry-run --outdir out", whose default export is { fetch(request, env, ctx) } or a WorkerEntrypoint class. It runs on workerd with nodejs_compat, and env.ASSETS.fetch(request) serves the assets.
- bindings: env.<name> is a D1Database ("sqlite"), a KVNamespace ("kv") or an R2Bucket ("blob"), and keeps its data across updates.
- migrations: folders of .sql files applied in name order before the new server deploys, each file once and atomically, recorded in d1_migrations as Wrangler does. If the deploy then fails, the old server keeps running on the migrated database, so only add tables and columns the old code can ignore; never rename or drop in the same publish.
- crons: native Cron Triggers. With "path", the trigger sends GET <path> to the server inside the Worker, and that path answers 404 to the internet, so it needs no secret. Without one, the module's scheduled(controller, env, ctx) runs. A new or changed schedule can take up to 15 minutes to start firing.
- secrets: never put them in files. Ask the user to run "npx wrangler secret put <NAME> --name <worker>", where <worker> is the first label of the artifact's hostname. They survive updates and read as env.<NAME>.
Deleting an artifact deletes its Worker only; its D1 databases, KV namespaces and R2 buckets stay in the account. A new Worker's URL can take a minute to answer.`

export default Plugin.define({
  id: "opencode.cloudflare-artifacts",
  async setup(ctx) {
    const accountId = ctx.options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = ctx.options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN
    if (!accountId || !apiToken) return
    await ctx.experimental.artifact.transform((editor) =>
      editor.add(provider({ accountId, apiToken, prefix: ctx.options.prefix })),
    )
  },
})

export function provider(options: Options): ArtifactProviderDefinition {
  const call = options.fetch ?? fetch
  const prefix = options.prefix ?? "opencode"

  const api = async <T>(signal: AbortSignal, method: string, path: string, body?: unknown): Promise<T> => {
    const form = body instanceof FormData
    const response = await call(`${API}/accounts/${options.accountId}${path}`, {
      method,
      signal,
      headers: {
        authorization: `Bearer ${options.apiToken}`,
        ...(body === undefined || form ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined || form ? body : JSON.stringify(body),
    })
    const parsed = (await response.json().catch(() => undefined)) as
      | { success?: boolean; result?: T; errors?: { code: number; message: string }[] }
      | undefined
    if (response.ok && parsed?.success !== false) return parsed?.result as T
    const reason = parsed?.errors?.map((error) => `${error.code}: ${error.message}`).join("; ")
    throw Object.assign(new Error(`Cloudflare ${method} ${path} failed: ${reason || `HTTP ${response.status}`}`), {
      status: response.status,
    })
  }

  const sql = (signal: AbortSignal, database: string, query: string) =>
    api<{ results: Record<string, unknown>[] }[]>(signal, "POST", `/d1/database/${database}/query`, { sql: query })

  const provision = async (signal: AbortSignal, kind: Artifact.Binding["kind"], name: string) => {
    if (kind === "sqlite") return (await api<{ uuid: string }>(signal, "POST", "/d1/database", { name })).uuid
    if (kind === "kv") return (await api<{ id: string }>(signal, "POST", "/storage/kv/namespaces", { title: name })).id
    await api(signal, "POST", "/r2/buckets", { name })
    return name
  }

  // Wrangler's own bookkeeping, so "wrangler d1 migrations apply" sees the same files as applied. Each file goes in one
  // query with its record, which D1 runs atomically.
  const migrate = async (signal: AbortSignal, database: string, files: { name: string; sql: string }[]) => {
    await sql(
      signal,
      database,
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
    )
    const applied = new Set(
      (await sql(signal, database, "SELECT name FROM d1_migrations"))[0]?.results.map((row) => String(row.name)),
    )
    for (const file of files.filter((file) => !applied.has(file.name)))
      await sql(
        signal,
        database,
        `${file.sql}\nINSERT INTO d1_migrations (name) VALUES ('${file.name.replaceAll("'", "''")}');`,
      ).catch((error) => {
        throw new Error(`Migration ${file.name} failed, so the new server wasn't deployed: ${error.message}`)
      })
  }

  // Cloudflare asks only for the files it lacks, in buckets, and the request that completes the set returns the JWT
  // the script upload redeems. When it lacks none, the session's own JWT redeems.
  const uploadAssets = async (signal: AbortSignal, script: string, assets: ArtifactPublishInput["assets"]) => {
    const files = await Promise.all(
      Object.entries(assets).map(async ([path, file]) => ({
        path: `/${path}`,
        ...file,
        hash: await hash(path, file.bytes),
      })),
    )
    const session = await api<{ jwt: string; buckets?: string[][] }>(
      signal,
      "POST",
      `/workers/scripts/${script}/assets-upload-session`,
      { manifest: Object.fromEntries(files.map((file) => [file.path, { hash: file.hash, size: file.bytes.length }])) },
    )
    const byHash = new Map(files.map((file) => [file.hash, file]))
    const batches = (session.buckets ?? []).flatMap((bucket) =>
      bucket.reduce<(typeof files)[]>((all, item) => {
        const file = byHash.get(item)!
        const last = all.at(-1)
        if (last && last.reduce((sum, each) => sum + each.bytes.length, file.bytes.length) <= BATCH_BYTES)
          last.push(file)
        else all.push([file])
        return all
      }, []),
    )
    let jwt = session.jwt
    for (const batch of batches) {
      const form = new FormData()
      batch.forEach((file) =>
        form.set(
          file.hash,
          new File([Buffer.from(file.bytes).toString("base64")], file.hash, { type: file.contentType }),
        ),
      )
      const response = await call(`${API}/accounts/${options.accountId}/workers/assets/upload?base64=true`, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${session.jwt}` },
        body: form,
      })
      if (!response.ok)
        throw new Error(`Cloudflare asset upload failed: HTTP ${response.status} ${await response.text()}`)
      jwt = ((await response.json()) as { result?: { jwt?: string } }).result?.jwt ?? jwt
    }
    return jwt
  }

  const publish = async (input: ArtifactPublishInput, signal: AbortSignal) => {
    const previous = input.receipt as Receipt | undefined
    const script = previous?.script ?? `${prefix}-${input.id.slice(4).toLowerCase()}`
    const subdomain = (await api<{ subdomain: string }>(signal, "GET", "/workers/subdomain")).subdomain
    const origin = `https://${script}.${subdomain}.workers.dev`

    // Pinned by binding name, so reordering or adding bindings never points one at another's data.
    const bindings = { ...previous?.bindings }
    for (const binding of input.manifest.bindings) {
      if (bindings[binding.name]?.kind === binding.kind) continue
      const name = `${script}-${binding.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`
        .slice(0, 63)
        .replace(/-+$/, "")
      bindings[binding.name] = { kind: binding.kind, id: await provision(signal, binding.kind, name) }
    }
    for (const binding of input.manifest.bindings.filter((binding) => binding.kind === "sqlite"))
      await migrate(
        signal,
        bindings[binding.name]!.id,
        (binding.migrations ?? []).flatMap((folder) =>
          Object.entries(input.serverFiles)
            .filter(([path]) => path.startsWith(`${folder}/`) && path.endsWith(".sql"))
            .map(([path, bytes]) => ({ name: path.slice(folder.length + 1), sql: new TextDecoder().decode(bytes) }))
            .toSorted((a, b) => a.name.localeCompare(b.name)),
        ),
      )

    const hasAssets = Object.keys(input.assets).length > 0
    const jwt = hasAssets ? await uploadAssets(signal, script, input.assets) : undefined
    const server = input.manifest.server === undefined ? undefined : input.serverFiles[input.manifest.server]
    const metadata = {
      main_module: ENTRY,
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: ["nodejs_compat"],
      bindings: [
        ...(hasAssets ? [{ type: "assets", name: "ASSETS" }] : []),
        ...input.manifest.bindings.map((binding) => {
          const id = bindings[binding.name]!.id
          if (binding.kind === "sqlite") return { type: "d1", name: binding.name, id }
          if (binding.kind === "kv") return { type: "kv_namespace", name: binding.name, namespace_id: id }
          return { type: "r2_bucket", name: binding.name, bucket_name: id }
        }),
      ],
      // Secrets are set out of band with "wrangler secret put", so every upload keeps them.
      keep_bindings: ["secret_text", "secret_key"],
      ...(jwt === undefined
        ? {}
        : { assets: { jwt, config: { not_found_handling: input.manifest.spa ? "single-page-application" : "none" } } }),
      observability: { enabled: true },
    }
    const form = new FormData()
    form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }))
    form.set(ENTRY, jsModule(ENTRY, entry(server !== undefined, origin, input.manifest.crons)))
    if (server) form.set(APP, jsModule(APP, server))
    await api(signal, "PUT", `/workers/scripts/${script}`, form)
    if (!previous)
      await api(signal, "POST", `/workers/scripts/${script}/subdomain`, { enabled: true, previews_enabled: false })
    await api(
      signal,
      "PUT",
      `/workers/scripts/${script}/schedules`,
      [...new Set(input.manifest.crons.map((cron) => cron.schedule))].map((cron) => ({ cron })),
    )
    return {
      url: `${origin}/${hasAssets && input.entry !== "index.html" ? input.entry : ""}`,
      receipt: { script, bindings } satisfies Receipt,
    }
  }

  return {
    id: "cloudflare",
    name: "Cloudflare",
    capabilities: ["static", "spa", "server-code", "sqlite", "kv", "blob", "cron"],
    audiences: ["public"],
    defaultAudience: "public",
    prompt,
    destination: async () => `cloudflare:${options.accountId}`,
    create: (input, context) => publish(input, context.signal),
    update: (_id, input, context) => publish(input, context.signal),
    // Only the Worker: its databases, namespaces and buckets hold data the user may still want.
    delete: async (_id, receipt, context) => {
      const script = (receipt as Receipt | undefined)?.script
      if (!script) return
      await api(context.signal, "DELETE", `/workers/scripts/${script}`).catch((error) => {
        if (error.status !== 404) throw error
      })
    },
  }
}

/**
 * The Worker's main module. It runs the app's fetch() and scheduled() as the runtime would, constructing a
 * WorkerEntrypoint class per call, and turns a cron with a path into a request to that path inside the Worker, which
 * the internet can't reach.
 */
function entry(server: boolean, origin: string, crons: readonly Artifact.Cron[]) {
  if (!server) return "export default { fetch: (request, env) => env.ASSETS.fetch(request) };\n"
  const targets = Object.fromEntries(
    [...new Set(crons.map((cron) => cron.schedule))].map((schedule) => [
      schedule,
      crons.filter((cron) => cron.schedule === schedule).map((cron) => cron.path ?? null),
    ]),
  )
  return `import user from "./${APP}";
const origin = ${JSON.stringify(origin)};
const crons = ${JSON.stringify(targets)};
const paths = new Set(Object.values(crons).flat().filter((path) => path !== null));
const invoke = (method, input, env, ctx) =>
  typeof user === "function" ? new user(ctx, env)[method](input) : user[method](input, env, ctx);
export default {
  fetch(request, env, ctx) {
    if (paths.has(new URL(request.url).pathname)) return new Response("Not found", { status: 404 });
    return invoke("fetch", request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    for (const path of crons[controller.cron] ?? [null]) {
      if (path === null) {
        await invoke("scheduled", controller, env, ctx);
        continue;
      }
      const response = await invoke("fetch", new Request(new URL(path, origin)), env, ctx);
      if (!response.ok) throw new Error(path + " answered " + response.status);
    }
  },
};
`
}

const jsModule = (name: string, content: string | Uint8Array) =>
  new File([content], name, { type: "application/javascript+module" })

// Cloudflare asks for 32 hex characters of a hash of each file; this hashes what Wrangler does, with SHA-256.
async function hash(path: string, bytes: Uint8Array) {
  const extension = /\.([^./]+)$/.exec(path)?.[1] ?? ""
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(Buffer.from(bytes).toString("base64") + extension))
  return Buffer.from(digest).toString("hex").slice(0, 32)
}
