import { wrapLanguageModel, type ModelMessage } from "ai"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Bus } from "../bus"
import z from "zod"
import { SessionPrompt } from "./prompt"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { ProviderTransform } from "@/provider/transform"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { mergeDeep, pipe } from "remeda"
import { SessionTranscript } from "./transcript"
import { SessionKnowledge } from "./knowledge"
import path from "path"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: Bus.event(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  export function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = context - output
    return count > usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    if (Flag.OPENCODE_DISABLE_PRUNE) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    model: {
      providerID: string
      modelID: string
    }
    agent: string
    abort: AbortSignal
    auto: boolean
  }) {
    const config = await Config.get()
    let knowledgeFiles: string[] = []

    // Find the compaction part from the last user message to update extraction status
    const lastUserMsg = input.messages.findLast((m) => m.info.role === "user")
    let compactionPart = lastUserMsg?.parts.find((p) => p.type === "compaction") as MessageV2.CompactionPart | undefined

    // Stage 1: Extract knowledge (if enabled)
    if (config.compaction?.extract_knowledge) {
      log.info("checking for new knowledge before compaction", { sessionID: input.sessionID })
      await SessionKnowledge.ensureDirectories()

      const sessDir = path.join(Instance.directory, ".opencode", "sess")
      const transcriptPath = path.join(sessDir, `${input.sessionID}.md`)
      await SessionTranscript.writeToFile(input.sessionID, transcriptPath)

      // Update compaction part to show we're checking for knowledge
      if (compactionPart) {
        compactionPart.extraction = { status: "checking" }
        await Session.updatePart(compactionPart)
      }

      // Quick check if there's new knowledge worth extracting
      const checkResult = await SessionKnowledge.check({
        transcriptPath,
        model: input.model,
      })

      if (checkResult.hasNewKnowledge) {
        log.info("new knowledge detected, extracting", { sessionID: input.sessionID })

        // Update compaction part to show extraction is starting
        if (compactionPart) {
          compactionPart.extraction = { status: "extracting" }
          await Session.updatePart(compactionPart)
        }

        const result = await SessionKnowledge.extract({
          sessionID: input.sessionID,
          transcriptPath,
          model: input.model,
          async onStart(childSessionID) {
            // Update compaction part with child session ID
            if (compactionPart) {
              compactionPart.extraction = {
                status: "extracting",
                childSessionID,
              }
              await Session.updatePart(compactionPart)
            }
          },
        })

        knowledgeFiles = result.knowledgeFiles
        log.info("knowledge extraction complete", {
          files: knowledgeFiles,
          substantial: result.hasSubstantialKnowledge,
        })

        // Update compaction part to show extraction is complete
        if (compactionPart) {
          compactionPart.extraction = {
            status: "completed",
            childSessionID: result.childSessionID,
            files: knowledgeFiles,
          }
          await Session.updatePart(compactionPart)
        }
      } else {
        log.info("no new knowledge detected, skipping extraction", { sessionID: input.sessionID })

        // Update compaction part to show extraction was skipped
        if (compactionPart) {
          compactionPart.extraction = { status: "skipped" }
          await Session.updatePart(compactionPart)
        }
      }

      // Cleanup transcript if configured
      if (config.compaction?.cleanup_transcripts !== false) {
        await Bun.file(transcriptPath)
          .delete()
          .catch(() => {})
      }
    }

    // Stage 2: Generate summary with knowledge references
    const model = await Provider.getModel(input.model.providerID, input.model.modelID)
    const language = await Provider.getLanguage(model)
    const system = [...SystemPrompt.compaction(model.providerID)]

    const knowledgeContext =
      knowledgeFiles.length > 0
        ? `\n\nThe following knowledge files were created or updated during this session and should be referenced in your summary:\n${knowledgeFiles.map((f) => `- ${f}`).join("\n")}`
        : ""

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: input.agent,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: input.model.modelID,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model: model,
      abort: input.abort,
    })
    const result = await processor.process({
      onError(error) {
        log.error("stream error", {
          error,
        })
      },
      // set to 0, we handle loop
      maxRetries: 0,
      providerOptions: ProviderTransform.providerOptions(
        model.api.npm,
        model.providerID,
        pipe({}, mergeDeep(ProviderTransform.options(model, input.sessionID)), mergeDeep(model.options)),
      ),
      headers: model.headers,
      abortSignal: input.abort,
      tools: model.capabilities.toolcall ? {} : undefined,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...MessageV2.toModelMessage(
          input.messages.filter((m) => {
            if (m.info.role !== "assistant" || m.info.error === undefined) {
              return true
            }
            if (
              MessageV2.AbortedError.isInstance(m.info.error) &&
              m.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
            ) {
              return true
            }

            return false
          }),
        ),
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Summarize our conversation above. This summary will be the only context available when the conversation continues, so preserve critical information including: what was accomplished, current work in progress, files involved, next steps, and any key user requests or constraints. Be concise but detailed enough that work can continue seamlessly." +
                knowledgeContext,
            },
          ],
        },
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, model)
              }
              return args.params
            },
          },
        ],
      }),
      experimental_telemetry: { isEnabled: config.experimental?.openTelemetry },
    })
    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: input.agent,
        model: input.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )
}
