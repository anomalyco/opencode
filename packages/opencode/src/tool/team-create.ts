import z from "zod"
import { Tool } from "./tool"
import { Team } from "../team"
import DESCRIPTION from "./team-create.txt"

export const TeamCreateTool = Tool.define("team_create", {
  description: DESCRIPTION,
  parameters: z.object({
    name: z.string().describe("A descriptive name for the team (e.g., 'spec-review-auth-service')"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "team_create",
      patterns: [params.name],
      always: ["*"],
      metadata: { name: params.name },
    })

    const team = Team.create({
      name: params.name,
      sessionID: ctx.sessionID,
      agent: ctx.agent,
    })

    return {
      title: `Team created: ${params.name}`,
      output: JSON.stringify(
        {
          team_id: team.id,
          name: team.name,
          status: team.status,
        },
        null,
        2,
      ),
      metadata: { team },
    }
  },
})
