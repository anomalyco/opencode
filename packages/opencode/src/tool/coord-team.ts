import z from "zod"
import { Tool } from "./tool"
import { CoordSession, CoordSummary, CoordTeam } from "@/coord"
import { Slug } from "@opencode-ai/util/slug"

const parameters = z.object({
  action: z.enum(["create", "list", "get", "delete"]).describe("Team action"),
  team_id: z.string().describe("Team ID").optional(),
  name: z.string().describe("Team name").optional(),
  description: z.string().describe("Team description").optional(),
})

export const CoordTeamTool = Tool.define("coord_team", {
  description: "Manage coordination teams (create/list/get/delete).",
  parameters,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: { teams: CoordTeam.TeamSummary[]; team: CoordTeam.TeamConfig | undefined; sessions: string[] | undefined } }> {
    await ctx.ask({
      permission: "coord_team",
      patterns: [params.action],
      always: ["*"],
      metadata: {
        action: params.action,
        team_id: params.team_id,
      },
    })

    if (params.action === "list") {
      const teams = await CoordTeam.listTeams()
      return {
        title: `${teams.length} teams`,
        output: JSON.stringify(teams, null, 2),
        metadata: { teams, team: undefined, sessions: undefined },
      }
    }

    if (params.action === "create") {
      const id = params.team_id ?? Slug.create()
      const name = params.name ?? id
      const team = await CoordTeam.createTeam({ id, name, description: params.description })
      await CoordSession.setTeam(ctx.sessionID, team.id)
      await CoordSummary.summarize(ctx.sessionID, team.id)
      return {
        title: `Team ${team.name} created`,
        output: JSON.stringify(team, null, 2),
        metadata: { team, teams: [], sessions: undefined },
      }
    }

    if (!params.team_id) throw new Error("team_id is required")

    if (params.action === "get") {
      const team = await CoordTeam.getTeam(params.team_id)
      if (!team) throw new Error(`Team ${params.team_id} not found`)
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Team ${team.name}`,
        output: JSON.stringify(team, null, 2),
        metadata: { team, teams: [], sessions: undefined },
      }
    }

    if (params.action === "delete") {
      const sessions = await CoordSession.clearTeam(params.team_id)
      await CoordTeam.deleteTeam(params.team_id)
      return {
        title: `Team ${params.team_id} deleted`,
        output: JSON.stringify({ deleted: true, sessions }, null, 2),
        metadata: { sessions, team: undefined, teams: [] },
      }
    }

    throw new Error("Unsupported action")
  },
})
