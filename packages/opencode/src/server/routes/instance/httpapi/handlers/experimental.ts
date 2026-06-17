import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ConsoleSwitchPayload,
  SessionListQuery,
  ToolListQuery,
  VoiceTranscribePayload,
  WorktreeApiError,
} from "../groups/experimental"

const MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024
const MAX_VOICE_AUDIO_BASE64_LENGTH = Math.ceil(MAX_VOICE_AUDIO_BYTES / 3) * 4
const BASE64_AUDIO_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

function badRequest() {
  return new HttpApiError.BadRequest({})
}

function whisperEndpoint(input: string) {
  try {
    const base = new URL(input)
    if (base.protocol !== "http:" && base.protocol !== "https:") return
    if (!localHost(base.hostname)) return
    return new URL("/inference", base)
  } catch {
    return
  }
}

function localHost(hostname: string) {
  const host = hostname.toLowerCase()
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  )
}

function decodeVoiceAudio(input: string) {
  const value = input.trim()
  if (!value || value.length > MAX_VOICE_AUDIO_BASE64_LENGTH) return
  if (value.length % 4 === 1 || !BASE64_AUDIO_PATTERN.test(value)) return
  return Buffer.from(value, "base64")
}

function parseWhisperText(body: string) {
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    if (typeof json.text === "string") return json.text
    if (typeof json.transcription === "string") return json.transcription
  } catch {}
  return body
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const all = yield* sessions.listGlobal({
        directory: ctx.query.directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    const voiceTranscribe = Effect.fn("ExperimentalHttpApi.voiceTranscribe")(function* (ctx: {
      payload: typeof VoiceTranscribePayload.Type
    }) {
      const cfg = yield* config.get()
      const voice = cfg.experimental?.voice
      if (voice?.enabled !== true || !voice.whisper_url?.trim()) return yield* Effect.fail(badRequest())

      const endpoint = whisperEndpoint(voice.whisper_url)
      if (!endpoint) return yield* Effect.fail(badRequest())

      const audio = decodeVoiceAudio(ctx.payload.audio)
      if (!audio || audio.byteLength === 0) return yield* Effect.fail(badRequest())
      if (audio.byteLength > MAX_VOICE_AUDIO_BYTES) return yield* Effect.fail(badRequest())

      return yield* Effect.tryPromise({
        try: async () => {
          const form = new FormData()
          form.append(
            "file",
            new File([new Uint8Array(audio)], ctx.payload.filename ?? "opencode-voice.wav", {
              type: ctx.payload.mime ?? "audio/wav",
            }),
          )
          form.append("response_format", "json")

          const response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) })
          const body = await response.text()
          if (!response.ok) throw new Error(body || `whisper.cpp returned HTTP ${response.status}`)
          return { text: parseWhisperText(body).trim() }
        },
        catch: () => badRequest(),
      })
    })

    return handlers
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("voiceTranscribe", voiceTranscribe)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("resource", resource)
  }),
)
