import { Plugin } from "@opencode/plugin"

import pkg from "../../package.json" with { type: "json" }
import { GptLive, VOICES, type Voice } from "../shared/rpc"
import { resolveAuth } from "./auth"
import { Bridge } from "./bridge"
import { background, historyFrom, type HistoryEntry } from "./context"
import { LiveError, MODEL, Sideband, createCall, requestIDs } from "./live"
import { CallLog } from "./log"
import { loadPrompt } from "./prompt"

interface Options {
  voice?: string
  /** Appended to GPT-Live's prompt. */
  instructions?: string
  /** Appended to the voice agent's prompt. */
  voiceAgentInstructions?: string
  /** Replace a built-in prompt with a Markdown file or a folder of sections. */
  prompts?: { gptLive?: string; voiceAgent?: string }
  /** Model for the voice agent's session, as "provider/model". */
  voiceModel?: string
  /** Thinking level for the voice agent's model. */
  voiceVariant?: string
  /** Keep a local JSONL log of each call (default true). */
  log?: boolean
}

interface Call {
  callID: string
  sessionID: string
  voiceSessionID: string
  prompt: string
  bridge?: Bridge
  sideband?: Sideband
  /** Last heartbeat from the window that owns the call. */
  seenAt: number
  end(reason?: string): void
}

/** A call whose window has not checked in for this long is treated as abandoned. */
const ORPHAN_AFTER = 20_000

const TOOL_PREFIX = "gptlive_"
/** Finished turns remembered per voice session for the next call's context. */
const TURNS_KEPT = 30

type Link = {
  voiceSessionID: string
  calls: number
}

function parseModel(value: string, variant?: string) {
  const slash = value.indexOf("/")
  if (slash <= 0) return undefined
  return {
    providerID: value.slice(0, slash),
    id: value.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}

/** RPC payloads must be JSON: drop keys whose value is undefined. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function toolText(content: string) {
  return { content }
}

export default Plugin.define({
  id: "shuvcode.gpt-live",
  async setup(ctx) {
    const options = ctx.options as Options
    const defaultVoice: Voice = VOICES.includes(options.voice as Voice) ? (options.voice as Voice) : "cove"
    const voiceModel = parseModel(options.voiceModel ?? "openai/gpt-6-sol", options.voiceVariant ?? "medium")
    let active: Call | undefined
    // Calls outlive a window that crashes or is killed (the server is shared), so the
    // window sends heartbeats and abandoned calls are ended rather than left running.
    const reaper = setInterval(() => {
      if (active && Date.now() - active.seenAt > ORPHAN_AFTER) active.end("The window that started the call closed")
    }, 5_000)
    reaper.unref?.()

    const bridgeFor = (sessionID: string) =>
      active?.bridge && active.voiceSessionID === sessionID ? active.bridge : undefined
    const outsideCall = toolText("This tool only works inside an active GPT-Live voice session.")

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "gptlive",
        description: "Control the user's main Shuvcode session during a GPT-Live voice call",
      })
      const tool = (definition: {
        name: string
        description: string
        input: Record<string, unknown>
        run: (bridge: Bridge, input: Record<string, unknown>) => Promise<string> | string
      }) =>
        editor.add({
          name: definition.name,
          description: definition.description,
          input: definition.input,
          options: { namespace: "gptlive", codemode: false },
          execute: async (input, context) => {
            const bridge = bridgeFor(context.sessionID)
            if (!bridge) return outsideCall
            try {
              return toolText(await definition.run(bridge, (input ?? {}) as Record<string, unknown>))
            } catch (error) {
              return toolText(`Failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          },
        })
      tool({
        name: "main_send",
        description:
          "Send a task or message to the user's coding session. Interpret the user's intent and write a clear, self-contained brief.",
        input: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description:
                "A clear brief of what the user means: goal, relevant specifics and constraints from the conversation, and what a good result looks like. Not a verbatim transcript.",
            },
            delivery: {
              type: "string",
              enum: ["queue", "steer"],
              description: "queue (default): run after current work. steer: redirect the work already running.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        run: (bridge, input) => bridge.send(String(input.text), input.delivery === "steer" ? "steer" : "queue"),
      })
      tool({
        name: "main_status",
        description:
          "Check whether the main session is busy, what it is doing right now, queued tasks and its last reply.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: (bridge) => bridge.status(),
      })
      tool({
        name: "main_read",
        description: "Read the main session's recent conversation, including which tools it used.",
        input: {
          type: "object",
          properties: { turns: { type: "number", description: "How many recent turns to read (default 8)." } },
          additionalProperties: false,
        },
        run: (bridge, input) => bridge.read(typeof input.turns === "number" ? input.turns : 8),
      })
      tool({
        name: "main_stop",
        description: "Stop the main session's current work.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: (bridge) => bridge.cancel(),
      })
      tool({
        name: "main_permissions",
        description: "List permission requests the main session is waiting on.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: (bridge) => bridge.permissions(),
      })
      tool({
        name: "end_call",
        description:
          "Hang up the voice call. Use only when the user clearly asks to end, stop or hang up the call, or says goodbye to finish.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: (bridge) => bridge.endCall(),
      })
      tool({
        name: "main_permission_reply",
        description: "Answer a pending permission request in the main session after the user decides.",
        input: {
          type: "object",
          properties: {
            requestID: { type: "string" },
            decision: { type: "string", enum: ["once", "always", "reject"] },
            message: { type: "string", description: "Optional note, e.g. why it was rejected." },
          },
          required: ["requestID", "decision"],
          additionalProperties: false,
        },
        run: (bridge, input) =>
          bridge.replyPermission(
            String(input.requestID),
            input.decision === "always" ? "always" : input.decision === "reject" ? "reject" : "once",
            typeof input.message === "string" ? input.message : undefined,
          ),
      })
    })

    // The voice session gets its instructions and only the control tools; every other
    // session never sees them.
    const shapeRequest = (event: {
      sessionID: string
      system: Array<{ type: "text"; text: string }>
      tools: Record<string, unknown>
    }) => {
      const voice = active && active.voiceSessionID === event.sessionID ? active : undefined
      for (const name of Object.keys(event.tools)) {
        const own = name.startsWith(TOOL_PREFIX)
        // The voice agent only talks and delegates: it gets the control tools and nothing else.
        if (voice ? !own : own) delete event.tools[name]
      }
      if (voice) event.system.push({ type: "text", text: voice.prompt })
    }
    await ctx.session.hook("context", (event) => shapeRequest(event as never))
    await ctx.session.hook("generate", (event) => shapeRequest(event as never))
    await ctx.session.hook("compaction", (event) => shapeRequest(event as never))

    const registration = await ctx.rpc.register(GptLive, {
      status: async () => {
        const auth = await resolveAuth(ctx)
        return defined({
          signedIn: auth.ok,
          plan: auth.ok ? auth.plan : undefined,
          callID: active?.callID,
          sessionID: active?.sessionID,
          voiceSessionID: active?.voiceSessionID,
        })
      },

      start: async (input, { signal, error }) => {
        // Starting a call while another is still up (typically from a window that went away)
        // moves the call here.
        active?.end("Moved to another window")
        const auth = await resolveAuth(ctx)
        if (!auth.ok) return error("not_signed_in", auth.reason, { reason: auth.reason })

        const voice = input.voice ?? defaultVoice
        const main = await ctx.session.get({ sessionID: input.sessionID as never }).catch(() => undefined)
        const mainTitle = (main as { title?: string } | undefined)?.title
        const history = await ctx.session
          .context({ sessionID: input.sessionID as never })
          .then((messages) => historyFrom(messages as readonly unknown[]))
          .catch(() => [])
        const project = ctx.location.project.canonical.split(/[\\/]/).findLast(Boolean) ?? "project"

        // One voice session per main session, continued across calls unless a fresh one is requested.
        const linkKey = `link/${input.sessionID}`
        let link = input.fresh ? undefined : ((await ctx.storage.get(linkKey)) as Link | undefined)
        let voiceTitle = link
          ? (
              (await ctx.session.get({ sessionID: link.voiceSessionID as never }).catch(() => undefined)) as
                | { title?: string }
                | undefined
            )?.title
          : undefined
        if (!link || voiceTitle === undefined) {
          voiceTitle = `Voice · ${mainTitle ?? "session"}`
          const created = await ctx.session.create({
            title: voiceTitle,
            ...(voiceModel ? { model: voiceModel as never } : {}),
            metadata: { gptLive: { role: "voice", mainSessionID: input.sessionID } },
          })
          link = { voiceSessionID: created.id, calls: 0 }
        }
        link = { ...link, calls: link.calls + 1 }
        await ctx.storage.set(linkKey, { ...link })
        const voiceSession = { id: link.voiceSessionID }
        const turnsKey = `turns/${link.voiceSessionID}`
        const previous = (((await ctx.storage.get(turnsKey)) as HistoryEntry[] | undefined) ?? []).slice(-TURNS_KEPT)
        // Prompts are read per call, so edits to them apply to the next call.
        const variables = { project, directory: ctx.location.directory }
        const agentPrompt = loadPrompt("voice-agent", {
          override: options.prompts?.voiceAgent,
          extra: options.voiceAgentInstructions,
          directory: ctx.location.directory,
          variables,
        })
        const livePrompt = loadPrompt("gpt-live", {
          override: options.prompts?.gptLive,
          extra: options.instructions,
          directory: ctx.location.directory,
          variables,
        })
        const prompt = agentPrompt.text + background(history)

        const ids = requestIDs()
        let call: { callID: string; sdp: string }
        try {
          call = await createCall({
            auth: auth.auth,
            ids,
            sdp: input.sdp,
            version: pkg.version,
            signal,
            session: {
              model: MODEL,
              instructions:
                livePrompt.text +
                background(
                  previous,
                  "Your recent voice conversation with this user from earlier calls",
                  "previous_calls",
                  4_000,
                ) +
                background(history, undefined, undefined, 4_000),
              audio: { output: { voice } },
              delegation: { type: "client" },
            },
          })
        } catch (cause) {
          const status = cause instanceof LiveError ? (cause.status ?? 0) : 0
          return error("rejected", cause instanceof Error ? cause.message : String(cause), { status })
        }

        const entry: Call = {
          callID: call.callID,
          sessionID: input.sessionID,
          voiceSessionID: voiceSession.id,
          prompt,
          seenAt: Date.now(),
          end: (reason) => {
            if (active !== entry) return
            active = undefined
            entry.bridge?.close()
            entry.sideband?.close()
            emitState("closed", reason)
          },
        }
        active = entry
        const emitState = (state: "connecting" | "live" | "closed" | "error", message?: string) =>
          void registration.events.emit("state", defined({ callID: entry.callID, state, message }))
        const finish = (state: "closed" | "error", message?: string) => {
          if (active !== entry) return
          active = undefined
          entry.bridge?.close()
          emitState(state, message)
        }
        emitState("connecting")

        // Join the control channel in the background so the SDP answer returns immediately;
        // the helper's ICE negotiation runs in parallel.
        const joinControlChannel = async () => {
          const sideband = await Sideband.connect({
            callID: call.callID,
            auth: auth.auth,
            ids,
            version: pkg.version,
            onEvent: (event) => entry.bridge?.handle(event),
            onClose: (reason) => finish("closed", reason),
          })
          if (active !== entry) {
            sideband.close()
            return
          }
          entry.sideband = sideband
          const log = options.log === false ? undefined : new CallLog(entry.callID)
          log?.write({
            type: "start",
            callID: entry.callID,
            sessionID: entry.sessionID,
            voiceSessionID: entry.voiceSessionID,
            voice,
          })
          let turns = previous.slice()
          entry.bridge = new Bridge(
            ctx,
            entry.sessionID,
            entry.voiceSessionID,
            sideband,
            {
              turn: (role, text) => {
                turns = [...turns, { role, text }].slice(-TURNS_KEPT)
                void ctx.storage
                  .set(
                    turnsKey,
                    turns.map((turn) => ({ role: turn.role, text: turn.text })),
                  )
                  .catch(() => undefined)
              },
              transcript: (role, text, final) =>
                void registration.events.emit("transcript", { callID: entry.callID, role, text, final }),
              task: (taskID, text, status, detail) =>
                void registration.events.emit("task", defined({ callID: entry.callID, taskID, text, status, detail })),
              activity: (scope, busy, label) =>
                void registration.events.emit("activity", defined({ callID: entry.callID, scope, busy, label })),
              closed: (reason) => finish("closed", reason),
              error: (message) => {
                log?.write({ type: "error", message })
                emitState("error", message)
              },
              end: (reason) => {
                log?.write({ type: "end", reason })
                finish("closed", reason)
              },
            },
            log,
            link.calls,
          )
          emitState("live")
        }
        void joinControlChannel().catch((cause) =>
          finish("error", cause instanceof Error ? cause.message : String(cause)),
        )

        return {
          callID: call.callID,
          sdp: call.sdp,
          model: MODEL,
          voice,
          voiceSessionID: voiceSession.id,
          voiceTitle,
          call: link.calls,
          previous: previous.slice(-8),
          notices: [...livePrompt.notices, ...agentPrompt.notices],
        }
      },

      stop: async (input) => {
        if (!active || active.callID !== input.callID) return { stopped: false }
        active.end()
        return { stopped: true }
      },

      alive: async (input) => {
        if (!active || active.callID !== input.callID) return { active: false }
        active.seenAt = Date.now()
        return { active: true }
      },

      say: async (input) => {
        if (!active?.bridge || active.callID !== input.callID) return { sent: false }
        active.bridge.say(input.text)
        return { sent: true }
      },
    })

    return async () => {
      clearInterval(reaper)
      active?.bridge?.close()
      active?.sideband?.close()
      active = undefined
      await registration.dispose()
    }
  },
})
