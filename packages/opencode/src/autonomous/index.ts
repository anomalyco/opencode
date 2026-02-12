import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { AutonomousTypes } from "./types"
import { Player } from "./player"
import { Coach } from "./coach"
import { fn } from "@/util/fn"
import z from "zod"

export namespace Autonomous {
  const log = Log.create({ service: "autonomous" })

  export const RunInput = z.object({
    requirements: z.string(),
    config: AutonomousTypes.Config.optional(),
  })
  export type RunInput = z.infer<typeof RunInput>

  export const run = fn(RunInput, async (input): Promise<AutonomousTypes.RunResult> => {
    const config = AutonomousTypes.Config.parse(input.config ?? {})
    const metrics: AutonomousTypes.TurnMetrics[] = []
    let coachFeedback = ""

    const playerModel = config.playerModel ?? (await Provider.defaultModel())
    const coachModel = config.coachModel ?? playerModel

    log.info("starting autonomous mode", {
      maxTurns: config.maxTurns,
      playerModel: `${playerModel.providerID}/${playerModel.modelID}`,
      coachModel: `${coachModel.providerID}/${coachModel.modelID}`,
    })

    const playerSession = await Session.create({ title: "Autonomous: Player" })
    let coachSessionID: string | undefined

    for (let turn = 1; turn <= config.maxTurns; turn++) {
      log.info(`turn ${turn}/${config.maxTurns}`, { sessionID: playerSession.id })

      // Player phase
      const playerStart = Date.now()
      const playerPrompt = Player.prompt({
        requirements: input.requirements,
        coachFeedback,
        turn,
      })

      await SessionPrompt.prompt({
        sessionID: playerSession.id,
        model: playerModel,
        parts: [{ type: "text", text: playerPrompt }],
      })

      const playerDuration = Date.now() - playerStart
      const playerTokens = await getSessionTokens(playerSession.id)
      log.info("player completed", { turn, duration: playerDuration, tokens: playerTokens })

      // Coach phase - FRESH session each turn (critical for unbiased review)
      const coachStart = Date.now()
      const coachSession = await Session.create({
        title: `Autonomous: Coach (Turn ${turn})`,
        parentID: playerSession.id,
      })
      coachSessionID = coachSession.id

      const coachPrompt = Coach.prompt(input.requirements)
      const coachResult = await SessionPrompt.prompt({
        sessionID: coachSession.id,
        model: coachModel,
        parts: [{ type: "text", text: coachPrompt }],
      })

      const coachDuration = Date.now() - coachStart
      const coachTokens = await getSessionTokens(coachSession.id)

      // Extract feedback from coach response
      const coachText = extractTextFromMessage(coachResult)
      const feedback = Coach.extractFeedback(coachText)

      log.info("coach completed", {
        turn,
        duration: coachDuration,
        tokens: coachTokens,
        approved: feedback.approved,
      })

      metrics.push({
        turn,
        playerTokens,
        coachTokens,
        playerDuration,
        coachDuration,
        feedbackLength: feedback.feedback.length,
      })

      if (feedback.approved) {
        log.info("implementation approved", { turn, sessionID: playerSession.id })
        return {
          success: true,
          turns: turn,
          metrics,
          sessionID: playerSession.id,
          coachSessionID,
        }
      }

      coachFeedback = feedback.feedback
      log.info("coach feedback", { turn, feedback: coachFeedback.slice(0, 200) })
    }

    log.info("max turns reached", { maxTurns: config.maxTurns, sessionID: playerSession.id })
    return {
      success: false,
      turns: config.maxTurns,
      metrics,
      sessionID: playerSession.id,
      coachSessionID,
    }
  })

  async function getSessionTokens(sessionID: string): Promise<number> {
    const messages = await Session.messages({ sessionID })
    let total = 0
    for (const msg of messages) {
      if (msg.info.role === "assistant") {
        const assistant = msg.info as MessageV2.Assistant
        total += assistant.tokens.input + assistant.tokens.output
      }
    }
    return total
  }

  function extractTextFromMessage(msg: MessageV2.WithParts): string {
    const parts: string[] = []
    for (const part of msg.parts) {
      if (part.type === "text") {
        parts.push(part.text)
      }
    }
    return parts.join("\n")
  }

  export function formatReport(result: AutonomousTypes.RunResult): string {
    const totalTokens = result.metrics.reduce((sum, m) => sum + m.playerTokens + m.coachTokens, 0)
    const totalTime = result.metrics.reduce((sum, m) => sum + m.playerDuration + m.coachDuration, 0)

    const lines = [
      "═══════════════════════════════════════════",
      "     AUTONOMOUS MODE SESSION REPORT",
      "═══════════════════════════════════════════",
      `Total Turns: ${result.turns}`,
      `Total Tokens: ${totalTokens.toLocaleString()}`,
      `Total Time: ${(totalTime / 1000).toFixed(1)}s`,
      `Final Status: ${result.success ? "APPROVED" : "MAX_TURNS_REACHED"}`,
      `Player Session: ${result.sessionID}`,
    ]

    if (result.coachSessionID) {
      lines.push(`Last Coach Session: ${result.coachSessionID}`)
    }

    lines.push("═══════════════════════════════════════════")

    if (result.metrics.length > 0) {
      lines.push("", "Turn Details:")
      for (const m of result.metrics) {
        lines.push(
          `  Turn ${m.turn}: Player ${m.playerTokens} tokens (${(m.playerDuration / 1000).toFixed(1)}s), ` +
            `Coach ${m.coachTokens} tokens (${(m.coachDuration / 1000).toFixed(1)}s)`,
        )
      }
    }

    return lines.join("\n")
  }
}

export { AutonomousTypes } from "./types"
export { Player } from "./player"
export { Coach } from "./coach"
