import z from "zod"
import { Tool } from "./tool"
import { Team } from "../team"
import { TeamID } from "../team/schema"
import { SessionInject } from "../session/inject"
import DESCRIPTION from "./send-message.txt"

export const SendMessageTool = Tool.define("send_message", {
  description: DESCRIPTION,
  parameters: z.object({
    team_id: z.string().describe("The team ID"),
    recipient: z.string().default("lead").describe("Agent name to send to, or 'lead' for the team lead"),
    content: z.string().describe("The message content"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "send_message",
      patterns: [params.recipient],
      always: ["*"],
      metadata: {},
    })

    const teamID = TeamID.make(params.team_id)
    const team = Team.get(teamID)
    if (!team) throw new Error(`Team not found: ${params.team_id}`)
    if (team.status === "disbanded") throw new Error(`Team has been disbanded: ${params.team_id}`)

    // Validate sender is a member of this team
    const members = Team.members(teamID)
    const sender = members.find((m) => m.sessionID === ctx.sessionID)
    if (!sender) throw new Error(`You are not a member of team "${team.name}"`)

    // Resolve recipient session
    let target: Team.Member | undefined
    if (params.recipient === "lead") {
      target = Team.leadSession(teamID)
    } else {
      target = Team.findMemberSession({
        teamID,
        agent: params.recipient,
      })
    }

    if (!target) throw new Error(`Recipient "${params.recipient}" not found in team "${team.name}"`)

    await SessionInject.send({
      sessionID: target.sessionID,
      from: ctx.agent,
      fromSessionID: ctx.sessionID,
      content: params.content,
      teamID: params.team_id,
    })

    return {
      title: `Message sent to ${params.recipient}`,
      output: `Message delivered to @${params.recipient} in team "${team.name}".`,
      metadata: {
        teamID: params.team_id,
        recipient: params.recipient,
      },
    }
  },
})
