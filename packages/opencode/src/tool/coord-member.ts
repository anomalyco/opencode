import z from "zod"
import { Tool } from "./tool"
import { CoordSummary, CoordTeam } from "@/coord"

const parameters = z.object({
  action: z.enum(["add", "remove"]).describe("Member action"),
  team_id: z.string().describe("Team ID"),
  name: z.string().describe("Member name"),
  agent_type: z.string().describe("Member agent type").optional(),
})

export const CoordMemberTool = Tool.define("coord_member", {
  description: "Manage coordination team members (add/remove).",
  parameters,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: { member: CoordTeam.TeamMember | undefined; members: CoordTeam.TeamMember[] } }> {
    await ctx.ask({
      permission: "coord_member",
      patterns: [params.team_id],
      always: ["*"],
      metadata: {
        action: params.action,
        team_id: params.team_id,
        name: params.name,
      },
    })

    if (params.action === "add") {
      const member = await CoordTeam.addMember({
        teamID: params.team_id,
        name: params.name,
        agentType: params.agent_type ?? "general",
      })
      await CoordSummary.summarize(ctx.sessionID, params.team_id)
      return {
        title: `Member ${member.name} added`,
        output: JSON.stringify(member, null, 2),
        metadata: { member, members: [] },
      }
    }

    await CoordTeam.removeMember({ teamID: params.team_id, name: params.name })
    await CoordSummary.summarize(ctx.sessionID, params.team_id)
    return {
      title: `Member ${params.name} removed`,
      output: "true",
      metadata: { member: undefined, members: [] },
    }
  },
})
