import z from "zod"
import { Tool } from "./tool"
import { Team } from "../team"
import { TeamID } from "../team/schema"
import DESCRIPTION from "./team-delete.txt"

export const TeamDeleteTool = Tool.define("team_delete", {
  description: DESCRIPTION,
  parameters: z.object({
    team_id: z.string().describe("The team ID returned by TeamCreate"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "team_delete",
      patterns: [params.team_id],
      always: ["*"],
      metadata: {},
    })

    const id = TeamID.make(params.team_id)
    const team = Team.get(id)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)
    if (team.status === "disbanded") throw new Error(`Team already disbanded: ${params.team_id}`)

    Team.disband(id)

    return {
      title: `Team disbanded: ${team.name}`,
      output: `Team "${team.name}" (${id}) has been disbanded. All active members marked as cancelled.`,
      metadata: { teamID: id },
    }
  },
})
