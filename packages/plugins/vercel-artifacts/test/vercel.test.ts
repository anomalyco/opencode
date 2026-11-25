import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { Flag } from "@opencode/core/flag"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { ArtifactConformance } from "../../../core/test/lib/artifact-conformance"
import { testEffect } from "../../../core/test/lib/effect"
import { PluginTestLayer } from "../../../core/test/plugin/fixture"
import VercelArtifacts from "../index"

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts"))))
const provider = Artifact.ProviderID.make("vercel")
const decoder = new TextDecoder()

type Project = {
  id: string
  name: string
  ssoProtection: { deploymentType: string } | null
  env: Record<string, string>
  production?: string
}
type Deployment = { id: string; projectId: string; files: Record<string, Uint8Array> }

/**
 * Vercel's REST API in-process, plus its edge: it serves each project's production deployment at
 * <name>.vercel.app the way Build Output API v3 routes it, and runs functions by importing the uploaded launcher.
 */
function fakeVercel() {
  const state = {
    teams: ["team_1"],
    /** Answers project changes as if the plan can't protect every deployment. */
    ignoreProtection: false,
    requests: new Array<{ method: string; path: string; teamId: string | null; body: any; headers: Headers }>(),
    projects: new Map<string, Project>(),
    files: new Map<string, Uint8Array>(),
    deployments: new Map<string, Deployment>(),
    stores: new Map<string, { name: string; access: string }>(),
    connections: new Array<{ storeId: string; body: any; oidc: string | null }>(),
  }
  let next = 0
  const root = mkdtemp(path.join(tmpdir(), "fake-vercel-"))
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const raw = new Uint8Array(await request.arrayBuffer())
      const body =
        request.headers.get("content-type") === "application/json" ? JSON.parse(decoder.decode(raw)) : undefined
      state.requests.push({
        method: request.method,
        path: url.pathname,
        teamId: url.searchParams.get("teamId"),
        body,
        headers: request.headers,
      })
      const route = `${request.method} ${url.pathname}`
      if (route === "GET /v2/teams") return Response.json({ teams: state.teams.map((id) => ({ id })) })
      if (route === "POST /v11/projects") {
        const project = {
          id: `prj_${++next}`,
          name: body.name,
          ssoProtection: state.ignoreProtection ? null : body.ssoProtection,
          env: {},
        }
        state.projects.set(project.id, project)
        return Response.json(project)
      }
      const projectRoute = url.pathname.match(/^\/v(?:9|10)\/projects\/([^/]+)(\/env)?$/)
      const project = projectRoute && state.projects.get(projectRoute[1] ?? "")
      if (projectRoute && !project) return Response.json({ error: { message: "Project not found" } }, { status: 404 })
      if (project && request.method === "PATCH") {
        if (!state.ignoreProtection) project.ssoProtection = body.ssoProtection
        return Response.json(project)
      }
      if (project && request.method === "DELETE") {
        state.projects.delete(project.id)
        return new Response(null, { status: 204 })
      }
      if (project && projectRoute?.[2]) {
        project.env[body.key] = body.value
        return Response.json({})
      }
      if (route === "POST /v1/storage/stores/blob") {
        const id = `store_${++next}`
        state.stores.set(id, { name: body.name, access: body.access ?? "public" })
        return Response.json({ store: { id } })
      }
      const connection = url.pathname.match(/^\/v1\/storage\/stores\/([^/]+)\/connections$/)
      if (connection) {
        const storeId = connection[1] ?? ""
        state.connections.push({ storeId, body, oidc: request.headers.get("x-vercel-use-oidc") })
        const connected = state.projects.get(body.projectId)
        if (connected) connected.env[`${body.envVarPrefix}_STORE_ID`] = storeId
        return Response.json({})
      }
      if (route === "POST /v2/files") {
        const sha = createHash("sha1").update(raw).digest("hex")
        if (request.headers.get("x-vercel-digest") !== sha) return Response.json({ error: {} }, { status: 400 })
        state.files.set(sha, raw)
        return Response.json({})
      }
      if (route === "POST /v13/deployments") {
        const target = state.projects.get(body.project)
        const files: { file: string; sha: string }[] = body.files
        if (!target || url.searchParams.get("prebuilt") !== "1" || files.some((file) => !state.files.has(file.sha)))
          return Response.json({ error: { code: "missing_files" } }, { status: 400 })
        const deployment = {
          id: `dpl_${++next}`,
          projectId: target.id,
          files: Object.fromEntries(
            files.map((file) => [file.file.replace(/^\.vercel\/output\//, ""), state.files.get(file.sha) ?? raw]),
          ),
        }
        state.deployments.set(deployment.id, deployment)
        target.production = deployment.id
        return Response.json({
          id: deployment.id,
          readyState: "READY",
          aliasAssigned: true,
          alias: [`${target.name}.vercel.app`],
        })
      }
      return Response.json({ error: { message: `Unknown route ${route}` } }, { status: 404 })
    },
  })

  /** What a reader without a Vercel sign-in gets at a URL. */
  const serve = async (href: string, init: RequestInit = {}) => {
    const url = new URL(href)
    const project = [...state.projects.values()].find((item) => `${item.name}.vercel.app` === url.host)
    const deployment = project?.production === undefined ? undefined : state.deployments.get(project.production)
    if (!project || !deployment) return new Response("DEPLOYMENT_NOT_FOUND", { status: 404 })
    if (project.ssoProtection?.deploymentType === "all") return new Response("Authentication Required", { status: 401 })
    const file = (pathname: string) =>
      deployment.files[`static${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`]
    const config = JSON.parse(decoder.decode(deployment.files["config.json"]))
    expect(config.version).toBe(3)
    expect(config.routes[0]).toEqual({ handle: "filesystem" })
    const asset = file(url.pathname)
    if (asset) return new Response(asset)
    const route = config.routes.slice(1).find((item: { src: string }) => new RegExp(`^${item.src}$`).test(url.pathname))
    if (route?.dest === "/index.html") return new Response(file("/index.html"))
    if (route?.dest !== "/__server") return new Response("NOT_FOUND", { status: 404 })
    return invoke(project, deployment, url, init)
  }

  // Vercel hands a function the deployment's own URL, with the reader's host in the forwarded headers.
  const invoke = async (project: Project, deployment: Deployment, url: URL, init: RequestInit) => {
    const prefix = "functions/__server.func/"
    const config = JSON.parse(decoder.decode(deployment.files[`${prefix}.vc-config.json`]))
    expect(config).toMatchObject({ launcherType: "Nodejs", handler: "index.js" })
    const dir = path.join(await root, deployment.id)
    await Promise.all(
      Object.entries(deployment.files)
        .filter(([file]) => file.startsWith(prefix))
        .map(async ([file, bytes]) => {
          await mkdir(path.dirname(path.join(dir, file.slice(prefix.length))), { recursive: true })
          await writeFile(path.join(dir, file.slice(prefix.length)), bytes)
        }),
    )
    const launcher = await import(pathToFileURL(path.join(dir, config.handler)).href)
    const saved = { ...process.env }
    Object.assign(process.env, project.env)
    const response: Response = await launcher.default.fetch(
      new Request(`https://${deployment.id}.vercel.app${url.pathname}${url.search}`, {
        ...init,
        headers: {
          ...init.headers,
          host: url.host,
          "x-forwarded-host": url.host,
          "x-forwarded-proto": "https",
          "x-vercel-deployment-url": `${deployment.id}.vercel.app`,
        },
      }),
    )
    process.env = saved
    return response
  }

  return {
    state,
    server,
    serve,
    stop: async () => {
      server.stop(true)
      await rm(await root, { recursive: true, force: true })
    },
  }
}

const withVercel = <A, E, R>(use: (vercel: ReturnType<typeof fakeVercel>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeVercel), use, (vercel) => Effect.promise(vercel.stop))

/** Starts the plugin against the fake, with the team named unless the options say otherwise. */
const start = Effect.fnUntraced(function* (
  vercel: ReturnType<typeof fakeVercel>,
  options: Record<string, unknown> = { token: "test-token", teamId: "team_1" },
) {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* PluginPromise.fromPromise(VercelArtifacts).effect({
    ...host,
    options: { apiUrl: vercel.server.url.origin, ...options },
  })
})

const read = (vercel: ReturnType<typeof fakeVercel>, info: Artifact.Info, filePath: string, init?: RequestInit) =>
  Effect.promise(() => vercel.serve(new URL(filePath, `https://${new URL(info.url).host}/`).href, init))

const sent = (vercel: ReturnType<typeof fakeVercel>, method: string, pattern: RegExp) =>
  vercel.state.requests.filter((request) => request.method === method && pattern.test(request.path))

const firstIndex = (vercel: ReturnType<typeof fakeVercel>, method: string, pattern: RegExp) =>
  vercel.state.requests.findIndex((request) => request.method === method && pattern.test(request.path))

describe("Vercel artifacts", () => {
  it.live("adds no provider without a token", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        const token = process.env.VERCEL_TOKEN
        delete process.env.VERCEL_TOKEN
        yield* start(vercel, {}).pipe(
          Effect.ensuring(Effect.sync(() => void (token === undefined || (process.env.VERCEL_TOKEN = token)))),
        )
        const artifacts = yield* Artifact.Service
        expect((yield* artifacts.providers()).map((item) => item.id)).not.toContain(provider)
        expect(vercel.state.requests).toEqual([])
      }),
    ),
  )

  it.live("meets the Vercel provider's pinned conformance matrix", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        yield* ArtifactConformance.run(
          {
            provider,
            fetch: (info, filePath) =>
              read(vercel, info, filePath).pipe(
                Effect.flatMap((response) =>
                  Effect.promise(async () =>
                    response.status === 200 ? new Uint8Array(await response.arrayBuffer()) : undefined,
                  ),
                ),
              ),
            calls: () => vercel.state.requests.length,
          },
          {
            "markdown-doc": "accept",
            "static-binary": "accept",
            "nested-entry": "accept",
            "spa-index": "accept",
            "fetch-echo": "accept",
            sqlite: "refuse",
            blob: "accept",
            cron: "accept",
          },
        )
        expect(vercel.state.requests.every((request) => request.teamId === "team_1")).toBe(true)
      }),
    ),
  )

  it.live("gives the server the URL the reader used, not the deployment's", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const info = yield* artifacts.create({ title: "Echo", provider, ...ArtifactConformance.fixtures["fetch-echo"] })
        const response = yield* read(vercel, info, "deep/path?q=1&b=two")
        const body = yield* Effect.promise(() => response.json() as Promise<{ url: string }>)
        expect(body.url).toBe(`https://${new URL(info.url).host}/deep/path?q=1&b=two`)
      }),
    ),
  )

  it.live("protects a private artifact before uploading anything, and again before each update", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const info = yield* artifacts.create({
          title: "Private",
          provider,
          visibility: "private",
          files: { "index.html": "<p>secret</p>" },
        })
        const created = sent(vercel, "POST", /^\/v11\/projects$/)[0]
        expect(created?.body.ssoProtection).toEqual({ deploymentType: "all" })
        expect(firstIndex(vercel, "POST", /^\/v11\/projects$/)).toBeLessThan(
          firstIndex(vercel, "POST", /^\/v2\/files$/),
        )
        expect((yield* read(vercel, info, "")).status).toBe(401)

        const before = vercel.state.requests.length
        yield* artifacts.update(info.id, { files: { "index.html": "<p>secret v2</p>" } })
        const patched = vercel.state.requests.findIndex(
          (request, index) => index >= before && request.method === "PATCH",
        )
        expect(vercel.state.requests[patched]?.body.ssoProtection).toEqual({ deploymentType: "all" })
        const uploaded = vercel.state.requests.findIndex(
          (request, index) => index >= before && request.path === "/v2/files",
        )
        expect(patched).toBeGreaterThan(-1)
        expect(patched).toBeLessThan(uploaded)
      }),
    ),
  )

  it.live("publishes nothing private when Vercel won't protect every deployment", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        vercel.state.ignoreProtection = true
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const error = yield* artifacts
          .create({ title: "Private", provider, visibility: "private", files: { "index.html": "<p>secret</p>" } })
          .pipe(Effect.flip)
        expect(error.message).toContain("Vercel Authentication")
        expect(sent(vercel, "POST", /^\/v2\/files$/)).toEqual([])
        expect(sent(vercel, "POST", /^\/v13\/deployments$/)).toEqual([])
      }),
    ),
  )

  it.live("gives each blob binding its own private store, keeps it across updates and after deletion", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const fixture = ArtifactConformance.fixtures.blob
        const info = yield* artifacts.create({ title: "Files", provider, ...fixture })
        expect([...vercel.state.stores.values()].map((store) => store.access)).toEqual(["private"])
        expect(vercel.state.connections).toMatchObject([
          { oidc: "1", body: { envVarPrefix: "FILES", skipReadWriteToken: true } },
        ])
        const project = [...vercel.state.projects.values()][0]
        expect(project?.env.FILES_STORE_ID).toBe(vercel.state.connections[0]?.storeId)
        yield* artifacts.update(info.id, { files: fixture.files })
        expect(vercel.state.stores.size).toBe(1)
        yield* artifacts.remove(info.id)
        expect(vercel.state.projects.size).toBe(0)
        expect(vercel.state.stores.size).toBe(1)
        expect(sent(vercel, "DELETE", /storage/)).toEqual([])
      }),
    ),
  )

  it.live("runs a cron's path only for Vercel's cron secret", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const info = yield* artifacts.create({ title: "Cron", provider, ...ArtifactConformance.fixtures.cron })
        expect(firstIndex(vercel, "POST", /\/env$/)).toBeLessThan(firstIndex(vercel, "POST", /^\/v13\/deployments$/))
        const project = [...vercel.state.projects.values()][0]
        const deployment = vercel.state.deployments.get(project?.production ?? "")
        expect(JSON.parse(decoder.decode(deployment?.files["config.json"])).crons).toEqual(
          JSON.parse(ArtifactConformance.fixtures.cron.files["artifact.json"]).crons,
        )
        expect((yield* read(vercel, info, "tasks/hourly")).status).toBe(401)
        const secret = project?.env.CRON_SECRET
        expect(secret).toBeString()
        const run = yield* read(vercel, info, "tasks/hourly", { headers: { authorization: `Bearer ${secret}` } })
        expect(run.status).toBe(200)
        expect((yield* read(vercel, info, "other")).status).toBe(200)
        // Without the secret, say once it's deleted in the dashboard, no request runs the cron.
        delete project?.env.CRON_SECRET
        const unset = { headers: { authorization: "Bearer undefined" } }
        expect((yield* read(vercel, info, "tasks/hourly", unset)).status).toBe(401)
      }),
    ),
  )

  it.live("refuses kv, and a cron without a path, before any request", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel)
        const artifacts = yield* Artifact.Service
        const app = (manifest: object) => ({
          provider,
          files: {
            "artifact.json": JSON.stringify({ server: "server.js", ...manifest }),
            "server.js": "export default {}",
          },
        })
        yield* artifacts
          .create({ title: "KV", ...app({ bindings: [{ name: "CACHE", kind: "kv" }] }) })
          .pipe(Effect.flip)
        const error = yield* artifacts
          .create({ title: "Cron", ...app({ crons: [{ schedule: "0 0 * * *" }] }) })
          .pipe(Effect.flip)
        expect(error.message).toContain("path")
        expect(vercel.state.requests).toEqual([])
      }),
    ),
  )

  it.live("publishes to the token's only team, and asks which when it reaches several", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        vercel.state.teams = ["team_a", "team_b"]
        yield* start(vercel, { token: "test-token" })
        const artifacts = yield* Artifact.Service
        const files = { "index.html": "<p>hi</p>" }
        const error = yield* artifacts.create({ title: "Two", provider, files }).pipe(Effect.flip)
        expect(error.message).toContain("VERCEL_TEAM_ID")
        expect(vercel.state.projects.size).toBe(0)
        vercel.state.teams = ["team_a"]
        yield* artifacts.create({ title: "One", provider, files })
        expect(sent(vercel, "POST", /^\/v11\/projects$/)[0]?.teamId).toBe("team_a")
      }),
    ),
  )

  it.live("names projects with the projectPrefix option", () =>
    withVercel((vercel) =>
      Effect.gen(function* () {
        yield* start(vercel, { token: "test-token", teamId: "team_1", projectPrefix: "opencode-artifacts-test" })
        const artifacts = yield* Artifact.Service
        yield* artifacts.create({ title: "One", provider, files: { "index.html": "<p>hi</p>" } })
        expect(sent(vercel, "POST", /^\/v11\/projects$/)[0]?.body.name).toMatch(
          /^opencode-artifacts-test-one-[0-9a-f]{8}$/,
        )
      }),
    ),
  )
})
