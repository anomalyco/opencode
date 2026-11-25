import { createHash, randomBytes } from "node:crypto"
import { Plugin } from "@opencode/plugin"
import type { ArtifactPublishInput, ArtifactTarget } from "@opencode/plugin/promise/artifact"

const prompt = `Publishes to Vercel, at the project's production domain (<project>.vercel.app). Public by default. A private artifact turns on Vercel Authentication for every deployment, so only members of the Vercel team can open it.
- Static files are served as uploaded. With "spa": true, paths that match no file serve index.html.
- "server" is one self-contained ESM file with every dependency bundled in, since nothing is installed. It runs on Vercel's Node.js runtime. Its default export's fetch(request, env) gets the public URL as request.url, and env is process.env. Paths that match no static file go to it, so with a server, "spa" is up to the server.
- Each "blob" binding gets its own private Vercel Blob store. Use the @vercel/blob SDK, bundled into the server, with { access: "private", storeId: process.env.<NAME>_STORE_ID }. Vercel authenticates it with OIDC. There's no env.<NAME> object as on Cloudflare.
- Every cron needs a "path". Vercel sends GET <path> on schedule, and requests to that path without Vercel's cron secret get 401 before the server runs. Hobby teams run crons at most once a day, Pro teams once a minute.
- No "sqlite" or "kv": Vercel functions have no persistent disk.
- Secrets are set by the user in the Vercel dashboard or with \`vercel env add\`, never in files. The server reads them from env after the next update.
- Deleting removes the Vercel project and keeps its Blob stores.`

/** What a publish saves, so updates reuse the project and stores. */
type Receipt = {
  readonly project: string
  readonly projectId: string
  /** Blob store IDs by binding name. */
  readonly stores: Readonly<Record<string, string>>
  /** Whether the project has its CRON_SECRET. */
  readonly cron: boolean
}

type Deployment = {
  readonly id: string
  readonly readyState: string
  readonly aliasAssigned?: unknown
  readonly alias?: readonly string[]
  readonly errorMessage?: string
}

export default Plugin.define({
  id: "opencode.vercel-artifacts",
  async setup(ctx) {
    const token: string | undefined = ctx.options.token ?? process.env.VERCEL_TOKEN
    if (!token) return
    const configuredTeam: string | undefined = ctx.options.teamId ?? process.env.VERCEL_TEAM_ID
    const call = client(token, ctx.options.apiUrl ?? "https://api.vercel.com")
    const projectPrefix: string | undefined = ctx.options.projectPrefix

    // The team every call goes to, resolved once. A token that reaches several teams must name one.
    let scope: Promise<{ team?: string; owner: string }> | undefined
    const resolveScope = (signal: AbortSignal) =>
      (scope ??= (async () => {
        if (configuredTeam) return { team: configuredTeam, owner: configuredTeam }
        const teams = (await call<{ teams: { id: string }[] }>("GET", "/v2/teams", { signal })).teams
        if (teams.length > 1)
          throw new Error(
            `This Vercel token reaches ${teams.length} teams. Set VERCEL_TEAM_ID, or the plugin's teamId option, to the one to publish to.`,
          )
        if (teams[0]) return { team: teams[0].id, owner: teams[0].id }
        const user = (await call<{ user: { id: string } }>("GET", "/v2/user", { signal })).user
        return { owner: user.id }
      })().catch((error) => {
        scope = undefined
        throw error
      }))

    const publish = async (input: ArtifactPublishInput, signal: AbortSignal) => {
      const manifest = input.manifest
      const unrouted = manifest.crons.find((cron) => cron.path === undefined)
      if (unrouted)
        throw new Error(`Vercel runs a cron by calling its path: give the "${unrouted.schedule}" cron a path.`)
      const misnamed = manifest.bindings.find((binding) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(binding.name))
      if (misnamed) throw new Error(`Binding "${misnamed.name}" must be a valid environment variable prefix.`)
      const team = (await resolveScope(signal)).team
      const previous = input.receipt as Receipt | undefined
      const name = input.destination.slice(input.destination.lastIndexOf("/") + 1)
      const protection = input.visibility === "private" ? { deploymentType: "all" } : null

      // Vercel Authentication is set before anything is uploaded, so a private artifact is never served openly.
      type Project = { id: string; ssoProtection?: { deploymentType: string } | null }
      const project: Project =
        previous === undefined
          ? await call<Project>("POST", "/v11/projects", {
              team,
              signal,
              body: { name, framework: null, ssoProtection: protection },
            })
          : {
              id: previous.projectId,
              ...(protection &&
                (await call<Project>("PATCH", `/v9/projects/${previous.projectId}`, {
                  team,
                  signal,
                  body: { ssoProtection: protection },
                }))),
            }
      if (protection && project.ssoProtection?.deploymentType !== "all")
        throw new Error("Vercel didn't turn on Vercel Authentication for every deployment, so nothing was published.")

      const stores = { ...previous?.stores }
      for (const binding of manifest.bindings.filter((item) => stores[item.name] === undefined)) {
        const store = (
          await call<{ store: { id: string } }>("POST", "/v1/storage/stores/blob", {
            team,
            signal,
            body: {
              name: `${name}-${binding.name.toLowerCase().replaceAll("_", "-")}`.slice(0, 70),
              access: "private",
            },
          })
        ).store
        // OIDC, with no long-lived read-write token, as `vercel storage connect` does by default.
        await call("POST", `/v1/storage/stores/${store.id}/connections`, {
          team,
          signal,
          headers: { "x-vercel-use-oidc": "1" },
          body: {
            projectId: project.id,
            envVarEnvironments: ["production", "preview"],
            envVarPrefix: binding.name,
            skipReadWriteToken: true,
          },
        })
        stores[binding.name] = store.id
      }

      const cron = previous?.cron === true || manifest.crons.length > 0
      if (cron && !previous?.cron)
        await call("POST", `/v10/projects/${project.id}/env?upsert=true`, {
          team,
          signal,
          body: {
            key: "CRON_SECRET",
            value: randomBytes(32).toString("hex"),
            type: "encrypted",
            target: ["production"],
          },
        })

      // A Build Output API v3 tree: https://vercel.com/docs/build-output-api
      const output: Record<string, Uint8Array | string> = {
        "config.json": JSON.stringify({
          version: 3,
          routes: [
            { handle: "filesystem" },
            ...(manifest.server !== undefined
              ? [{ src: "/(.*)", dest: "/__server" }]
              : manifest.spa
                ? [{ src: "/(.*)", dest: "/index.html" }]
                : []),
          ],
          overrides: Object.fromEntries(
            Object.entries(input.assets)
              .filter(([file]) => !known.test(file))
              .map(([file, asset]) => [file, { contentType: asset.contentType }]),
          ),
          crons: manifest.crons.map((item) => ({ path: item.path, schedule: item.schedule })),
        }),
        ...Object.fromEntries(Object.entries(input.assets).map(([file, asset]) => [`static/${file}`, asset.bytes])),
        ...(manifest.server === undefined
          ? {}
          : {
              "functions/__server.func/.vc-config.json": JSON.stringify({
                runtime: "nodejs22.x",
                handler: "index.js",
                launcherType: "Nodejs",
              }),
              "functions/__server.func/package.json": JSON.stringify({ type: "module" }),
              "functions/__server.func/index.js": launcher(manifest.crons.flatMap((item) => item.path ?? [])),
              "functions/__server.func/server.js": input.serverFiles[manifest.server],
            }),
      }
      const files = Object.entries(output).map(([file, content]) => {
        const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
        return { file: `.vercel/output/${file}`, bytes, sha: createHash("sha1").update(bytes).digest("hex") }
      })
      const unique = [...new Map(files.map((item) => [item.sha, item.bytes])).entries()]
      for (let start = 0; start < unique.length; start += 16)
        await Promise.all(
          unique.slice(start, start + 16).map(([sha, bytes]) =>
            call("POST", "/v2/files", {
              team,
              signal,
              headers: { "x-vercel-digest": sha, "content-length": String(bytes.byteLength) },
              body: bytes,
            }),
          ),
        )

      const created = await call<Deployment>("POST", "/v13/deployments?prebuilt=1&skipAutoDetectionConfirmation=1", {
        team,
        signal,
        body: {
          name,
          project: project.id,
          target: "production",
          files: files.map((item) => ({ file: item.file, sha: item.sha, size: item.bytes.byteLength })),
        },
      })
      const deadline = Date.now() + 10 * 60_000
      const settle = async (deployment: Deployment): Promise<Deployment> => {
        if (deployment.readyState === "READY" && deployment.aliasAssigned) return deployment
        if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED")
          throw new Error(
            `Vercel deployment ${deployment.id} failed: ${deployment.errorMessage ?? deployment.readyState}`,
          )
        if (Date.now() > deadline) throw new Error(`Vercel deployment ${deployment.id} wasn't ready after 10 minutes.`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return settle(await call<Deployment>("GET", `/v13/deployments/${deployment.id}`, { team, signal }))
      }
      const ready = await settle(created)
      // The production domain moves to each new production deployment, so updates keep the URL.
      const domain = ready.alias?.[0]
      if (!domain) throw new Error(`Vercel gave deployment ${ready.id} no production domain.`)
      return {
        url: `https://${domain}/${input.entry === "index.html" ? "" : input.entry}`,
        receipt: { project: name, projectId: project.id, stores, cron } satisfies Receipt,
      }
    }

    await ctx.experimental.artifact.transform((editor) =>
      editor.add({
        id: "vercel",
        name: "Vercel",
        capabilities: ["static", "spa", "server-code", "blob", "cron"],
        audiences: ["public", "private"],
        defaultAudience: "public",
        prompt,
        destination: async (target, context) =>
          `vercel:${(await resolveScope(context.signal)).owner}/${projectName(target, projectPrefix)}`,
        create: (input, context) => publish(input, context.signal),
        update: (_id, input, context) => publish(input, context.signal),
        delete: async (_id, receipt, context) => {
          const team = (await resolveScope(context.signal)).team
          // Already gone counts as deleted: the destination check has made sure this is the same team.
          await call("DELETE", `/v9/projects/${(receipt as Receipt).projectId}`, {
            team,
            signal: context.signal,
          }).catch((error) => {
            if (error.status !== 404) throw error
          })
        },
      }),
    )
  },
})

/** Extensions Vercel already serves with the right Content-Type. Others get the type OpenCode detected. */
const known = /\.(html?|css|m?js|json|map|txt|xml|svg|png|jpe?g|gif|webp|avif|ico|woff2?|wasm|pdf|mp4|webm)$/i

/** Readable and stable: the prefix, the title when it was created, and a hash of the artifact ID. */
function projectName(target: ArtifactTarget, prefix: string | undefined) {
  const saved = (target.receipt as Receipt | undefined)?.project
  if (saved) return saved
  const slug = target.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "")
  return `${prefix ? `${prefix}-` : ""}${slug || "artifact"}-${createHash("sha256").update(target.id).digest("hex").slice(0, 8)}`
}

/**
 * The function's entry. Vercel's Node.js launcher calls a default export's fetch with the reader's path and query (as
 * SvelteKit's adapter-vercel relies on), and the URL is rebuilt from the host the reader used, not the deployment's.
 */
function launcher(crons: readonly string[]) {
  return `import server from "./server.js"

const crons = ${JSON.stringify(crons)}

export default {
  fetch(request) {
    const routed = new URL(request.url)
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    const url = new URL(routed.pathname + routed.search, (request.headers.get("x-forwarded-proto") ?? "https") + "://" + host)
    const secret = process.env.CRON_SECRET
    if (crons.includes(url.pathname) && (!secret || request.headers.get("authorization") !== "Bearer " + secret))
      return new Response("Unauthorized", { status: 401 })
    return server.fetch(new Request(url, request), process.env)
  },
}
`
}

function client(token: string, base: string) {
  return async <T = unknown>(
    method: string,
    path: string,
    options: {
      readonly team?: string
      readonly signal: AbortSignal
      readonly body?: unknown
      readonly headers?: Record<string, string>
    },
  ): Promise<T> => {
    const url = new URL(path, base)
    if (options.team) url.searchParams.set("teamId", options.team)
    const raw = options.body instanceof Uint8Array
    const response = await fetch(url, {
      method,
      signal: options.signal,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined || raw ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: raw ? (options.body as Uint8Array) : options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    if (!response.ok) {
      const message = text.startsWith("{") ? JSON.parse(text).error?.message : undefined
      throw Object.assign(
        new Error(`Vercel ${method} ${url.pathname} failed with ${response.status}: ${message ?? text}`),
        {
          status: response.status,
        },
      )
    }
    return JSON.parse(text || "{}")
  }
}
