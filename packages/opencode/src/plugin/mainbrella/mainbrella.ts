import type { Plugin, WorkspaceAdapter, WorkspaceInfo } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Flock } from "@opencode-ai/core/util/flock"

const generation = z.string().refine((value) => {
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
})
const binding = z.object({
  apiUrl: z.string().url().default("https://api.mainbrella.com"),
  containerID: z.string().regex(/^(small|c[1-9]\d{0,2})$/),
  createdAt: generation,
  directory: z
    .string()
    .refine(
      (value) =>
        value.startsWith("/") && !/[\x00-\x1f]/.test(value) && !value.split("/").some((x) => x === "." || x === ".."),
    )
    .default("/workspace"),
  port: z.number().int().min(1024).max(65535).default(4096),
})
const preview = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  createdAt: generation,
  expiresAt: z.number().int().positive(),
  url: z.string(),
})
const receipt = z.object({
  binding,
  workspaceID: z.string(),
  pendingPreview: z.boolean(),
  preview: preview.optional(),
})
const capabilities = z.object({ previews: z.object({ supported: z.boolean() }) })
const account = z.object({
  containers: z.array(z.object({ id: z.string(), createdAt: generation, status: z.string() })),
})
const command = z.object({ exitCode: z.number().nullable(), timedOut: z.boolean(), outputTruncated: z.boolean() })
const revoked = z.object({ revoked: z.literal(true) })
const health = z.object({ healthy: z.literal(true), version: z.string() })
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname)

class APIError extends Error {
  constructor(readonly status: number) {
    super(`Mainbrella API request failed (${status}).`)
  }
}

export const MainbrellaPlugin: Plugin = async (input) => {
  const apiKey = process.env.MAINBRELLA_API_KEY
  if (!apiKey) return {}
  input.experimental_workspace.register(
    "mainbrella",
    MainbrellaAdapter({
      apiKey,
      apiUrl: process.env.MAINBRELLA_API_URL,
      containerID: process.env.MAINBRELLA_CONTAINER_ID,
      createdAt: process.env.MAINBRELLA_CREATED_AT,
      directory: process.env.MAINBRELLA_DIRECTORY,
      port: process.env.MAINBRELLA_PORT ? Number(process.env.MAINBRELLA_PORT) : undefined,
    }),
  )
  return {}
}

/** Attach only to an explicitly prepared generation; the adapter never owns its machine. */
export function MainbrellaAdapter(
  options: { apiKey: string } & Partial<z.input<typeof binding>>,
  stateDirectory = path.join(Global.Path.state, "mainbrella"),
): WorkspaceAdapter {
  const key = z
    .string()
    .regex(/^mb_[a-f0-9]{64}$/i)
    .parse(options.apiKey)

  async function request<S extends z.ZodType>(
    config: z.output<typeof binding>,
    route: string,
    schema: S,
    body?: unknown,
    method = "GET",
  ) {
    const response = await fetch(new URL(route, config.apiUrl), {
      method,
      redirect: "error",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new Error("Mainbrella API is unavailable. No request was automatically retried.")
    })
    if (!response.ok) throw new APIError(response.status)
    const parsed = schema.safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) throw new Error("Mainbrella returned an invalid response.")
    return parsed.data
  }

  const route = (config: z.output<typeof binding>, pathname: string, extra: Record<string, string> = {}) =>
    `${pathname}?${new URLSearchParams({ id: config.containerID, createdAt: config.createdAt, ...extra })}`
  const file = (info: WorkspaceInfo) =>
    path.join(stateDirectory, `${createHash("sha256").update(info.id).digest("hex")}.json`)
  const locked = <T>(info: WorkspaceInfo, fn: () => Promise<T>) => Flock.withLock(`mainbrella:${file(info)}`, fn)

  async function read(info: WorkspaceInfo) {
    return fs
      .readFile(file(info), "utf8")
      .then((value) => {
        const state = receipt.parse(JSON.parse(value))
        if (state.workspaceID !== info.id) throw new Error("Workspace identity mismatch")
        return state
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return
        throw new Error("Cannot read private Mainbrella workspace state.")
      })
  }

  async function save(info: WorkspaceInfo, value: z.output<typeof receipt>) {
    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    await fs.chmod(stateDirectory, 0o700)
    const temporary = `${file(info)}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    await fs.rename(temporary, file(info)).finally(() => fs.rm(temporary, { force: true }))
  }

  async function running(config: z.output<typeof binding>) {
    return (await request(config, "/containers", account)).containers.some(
      (item) => item.id === config.containerID && item.createdAt === config.createdAt && item.status === "running",
    )
  }

  async function execute(config: z.output<typeof binding>, script: string) {
    const result = await request(
      config,
      route(config, "/containers/exec"),
      command,
      { command: script, timeoutMs: 20_000 },
      "POST",
    )
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated)
      throw new Error("Mainbrella server command failed. Check the prepared sandbox and its OpenCode server log.")
  }

  async function connection(info: WorkspaceInfo, state: z.output<typeof receipt>) {
    if (state.preview && state.preview.expiresAt > Date.now()) return state.preview
    if (state.pendingPreview)
      throw new Error(
        "Mainbrella preview creation needs reconciliation. Inspect and revoke the uncertain preview before resetting private workspace state.",
      )
    if (!(await running(state.binding))) throw new Error("The selected Mainbrella generation is unavailable.")
    if (!(await request(state.binding, "/capabilities", capabilities)).previews.supported)
      throw new Error("This Mainbrella deployment does not support protected previews.")

    // Preview issuance is not idempotent. An uncertain result must not mint another grant.
    await save(info, { ...state, pendingPreview: true })
    const grant = await request(
      state.binding,
      route(state.binding, "/containers/previews"),
      preview,
      { port: state.binding.port, ttlSeconds: 3600 },
      "POST",
    ).catch(async (error: unknown) => {
      if (error instanceof APIError && error.status >= 400 && error.status < 500)
        await save(info, { ...state, pendingPreview: false })
      throw error
    })
    if (!validPreview(state.binding, grant)) {
      await request(
        state.binding,
        route(state.binding, "/containers/previews", { previewId: grant.id }),
        revoked,
        undefined,
        "DELETE",
      )
      await save(info, { ...state, pendingPreview: false })
      throw new Error("Mainbrella returned an invalid protected preview.")
    }
    await save(info, { ...state, pendingPreview: false, preview: grant })
    return grant
  }

  return {
    name: "Mainbrella",
    description: "Run OpenCode in a prepared Mainbrella sandbox",
    configure(info) {
      const parsed = binding.safeParse(options)
      if (!parsed.success)
        throw new Error(
          "Set MAINBRELLA_CONTAINER_ID and its exact MAINBRELLA_CREATED_AT; directory and port must be valid guest values.",
        )
      const url = new URL(parsed.data.apiUrl)
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/" ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)))
      )
        throw new Error("MAINBRELLA_API_URL must be an HTTPS origin or loopback HTTP origin.")
      return { ...info, directory: parsed.data.directory, extra: { mainbrella: parsed.data } }
    },
    async create(info, _env, from) {
      if (from) throw new Error("Copying a Mainbrella workspace is not supported; prepare a separate sandbox.")
      const config = z.object({ mainbrella: binding }).parse(info.extra).mainbrella
      await locked(info, async () => {
        if (!(await running(config))) throw new Error("The selected Mainbrella generation is unavailable.")
        if (!(await request(config, "/capabilities", capabilities)).previews.supported)
          throw new Error("This Mainbrella deployment does not support protected previews.")
        const state = (await read(info)) ?? { binding: config, workspaceID: info.id, pendingPreview: false }
        if (JSON.stringify(state.binding) !== JSON.stringify(config))
          throw new Error("The Mainbrella workspace binding cannot change after server creation.")
        await save(info, state)
        await execute(config, launch(info.id, config))
        const grant = await connection(info, state)
        const response = await fetch(new URL("/global/health", grant.url), {
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined)
        const result = health.safeParse(response?.ok ? await response.json().catch(() => undefined) : undefined)
        if (!result.success || result.data.version !== InstallationVersion)
          throw new Error("The Mainbrella OpenCode server must be healthy and match the local OpenCode version.")
      })
    },
    async target(info) {
      return locked(info, async () => {
        const state = await read(info)
        if (!state) throw new Error("Mainbrella workspace has no private connection state. Create the workspace first.")
        return { type: "remote" as const, url: (await connection(info, state)).url }
      })
    },
    async remove(info) {
      await locked(info, async () => {
        const state = await read(info)
        if (!state) return
        if (await running(state.binding)) {
          await execute(state.binding, stop(info.id, state.binding.port))
          if (state.preview)
            await request(
              state.binding,
              route(state.binding, "/containers/previews", { previewId: state.preview.id }),
              revoked,
              undefined,
              "DELETE",
            )
          if (state.pendingPreview)
            throw new Error("The server was stopped, but uncertain preview issuance still needs reconciliation.")
        }
        await fs.rm(file(info), { force: true })
      })
    },
  }
}

function validPreview(config: z.output<typeof binding>, grant: z.output<typeof preview>) {
  if (grant.createdAt !== config.createdAt || grant.expiresAt <= Date.now() || !URL.canParse(grant.url)) return false
  const url = new URL(grant.url)
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return false
  if (new URL(config.apiUrl).protocol === "http:" && loopback(url.hostname) && url.protocol === "http:") return true
  return url.protocol === "https:" && !url.port && /^[a-f0-9]{48}\.mainbrella\.dev$/.test(url.hostname)
}

function launch(workspaceID: string, config: z.output<typeof binding>) {
  const control = `/tmp/opencode-mainbrella-${config.port}`
  const server = `exec env -u OPENCODE_SERVER_PASSWORD -u OPENCODE_SERVER_USERNAME OPENCODE_WORKSPACE_ID=${quote(workspaceID)} OPENCODE_EXPERIMENTAL_WORKSPACES=true opencode serve --hostname 0.0.0.0 --port ${config.port} >${quote(`${control}/server.log`)} 2>&1`
  return [
    "set -eu",
    "umask 077",
    `cd ${quote(config.directory)}`,
    "command -v tmux >/dev/null",
    "command -v curl >/dev/null",
    `test "$(opencode --version)" = ${quote(InstallationVersion)}`,
    `if mkdir ${quote(control)} 2>/dev/null; then printf '%s' ${quote(workspaceID)} >${quote(`${control}/owner`)}; fi`,
    `test "$(cat ${quote(`${control}/owner`)})" = ${quote(workspaceID)}`,
    `if ! tmux -S ${quote(`${control}/tmux.sock`)} has-session -t server 2>/dev/null; then`,
    `  if curl --silent --max-time 1 --output /dev/null http://127.0.0.1:${config.port}/global/health; then exit 1; fi`,
    `  tmux -S ${quote(`${control}/tmux.sock`)} new-session -d -s server ${quote(server)}`,
    "fi",
    "attempt=0",
    'while [ "$attempt" -lt 40 ]; do',
    `  tmux -S ${quote(`${control}/tmux.sock`)} has-session -t server`,
    `  if curl --fail --silent --max-time 1 http://127.0.0.1:${config.port}/global/health >/dev/null; then exit 0; fi`,
    "  attempt=$((attempt + 1))",
    "  sleep 0.25",
    "done",
    "exit 1",
  ].join("\n")
}

function stop(workspaceID: string, port: number) {
  const control = `/tmp/opencode-mainbrella-${port}`
  return [
    "set -eu",
    `if [ ! -d ${quote(control)} ]; then exit 0; fi`,
    `test "$(cat ${quote(`${control}/owner`)})" = ${quote(workspaceID)}`,
    "command -v tmux >/dev/null",
    `tmux -S ${quote(`${control}/tmux.sock`)} kill-server 2>/dev/null || true`,
    `if tmux -S ${quote(`${control}/tmux.sock`)} has-session -t server 2>/dev/null; then exit 1; fi`,
    `rm -rf -- ${quote(control)}`,
  ].join("\n")
}
