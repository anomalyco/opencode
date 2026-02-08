import z from "zod"
import { Tool } from "./tool"
import { CoordSession, CoordSummary, CoordTeam } from "@/coord"

const parameters = z.object({
  action: z.enum(["set", "get"]).describe("Session coordination action"),
  session_id: z.string().describe("Session ID"),
  team_id: z.string().describe("Team ID").optional(),
})

export const CoordSessionTool = Tool.define("coord_session", {
  description: "Attach or read a coordination team for a session.",
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "coord_session",
      patterns: [params.action],
      always: ["*"],
      metadata: {
        action: params.action,
        session_id: params.session_id,
        team_id: params.team_id,
      },
    })

    if (params.action === "get") {
      const info = await CoordSession.teamInfo(params.session_id)
      return {
        title: info ? `Session ${params.session_id} team` : "No team",
        output: JSON.stringify(info ?? null, null, 2),
        metadata: { team: info?.team, link: info?.link },
      }
    }

    if (!params.team_id) throw new Error("team_id is required")
    const team = await CoordTeam.getTeam(params.team_id)
    if (!team) throw new Error(`Team ${params.team_id} not found`)

    const link = await CoordSession.setTeam(params.session_id, params.team_id)
    await CoordSummary.summarize(params.session_id, params.team_id)

    return {
      title: `Session ${params.session_id} linked`,
      output: JSON.stringify({ link, team }, null, 2),
      metadata: { link, team },
    }
  },
})
