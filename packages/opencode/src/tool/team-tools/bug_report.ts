import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { TeamBugReport } from "@/team/bug-report"
import path from "path"
import z from "zod"
import { Tool } from "../shared/tool"

const DESCRIPTION = `Report an opencode-environment bug, suggestion, or feature request encountered while an agent was working.

Before you conclude, explicitly decide whether you encountered an opencode-environment bug, suggestion, or feature request while working. If yes, you must call \`bug_report\` before your final response.

Use this tool only for opencode's own working environment: agents, prompts, tools, permissions, sessions, events, CLI flows, skills, MCP handling, or workflow behavior. This still applies when the agent is working inside another repository.

Do not use \`bug_report\` for bugs in the user's project or in external systems unless the problem is actually in opencode's working environment. User requests do not override this restriction.

Treat this as a required closure rule. If an opencode-environment bug, suggestion, or feature request came up at any point while working, call \`bug_report\` before concluding.

Each successful report is written into the shared bug report log at \`~/.config/opencode/bug-report.json\`, legacy bug report files are synced into that shared log when needed, and a \`bug_report.created\` event is emitted.`

const id = "bug_report"

const parameters = z.object({
  kind: z
    .enum(["bug", "suggestion", "feature"])
    .optional()
    .describe("Type of opencode-environment report. Defaults to `bug` when omitted."),
  title: z.string().min(1).describe("Short title for the opencode-environment bug, suggestion, or feature request."),
  summary: z
    .string()
    .min(1)
    .describe("What failed in opencode's environment, or what should improve, and how it affected the work."),
  area: z
    .string()
    .optional()
    .describe(
      "Optional opencode environment area such as tool, prompt, permission, session, cli, workflow, or file path.",
    ),
  tool_name: z.string().optional().describe("Optional opencode tool name involved in the issue or friction."),
  impact: z.string().optional().describe("Optional impact on execution, verification, or user-visible outcome."),
  repro: z.string().optional().describe("Optional reproduction notes for the opencode-environment issue."),
  expected: z.string().optional().describe("Optional expected opencode behavior."),
  actual: z.string().optional().describe("Optional actual opencode behavior."),
  suggestion: z.string().optional().describe("Optional concrete improvement idea for opencode's working environment."),
})

type Metadata = {
  report_id: string
  file: string
  agent: string
  project_id: string
  project_name: string
  created: number
  created_at: string
}

function rel(input: string) {
  const out = path.relative(Instance.worktree, input).replaceAll("\\", "/")
  return out || "."
}

async function json(file: string) {
  return Bun.file(file)
    .json()
    .catch(() => undefined) as Promise<{ name?: string } | undefined>
}

async function name() {
  return Instance.project.name?.trim() || (await json(path.join(Instance.worktree, "package.json")))?.name || "opencode"
}

function fmt(item: TeamBugReport.Entry, file: string) {
  return [
    `report_id: ${item.id}`,
    `file: ${file}`,
    `project_id: ${item.project_id}`,
    `project_name: ${item.project_name}`,
    `agent: ${item.agent}`,
    `worktree: ${item.worktree}`,
    `cwd: ${item.cwd}`,
    `kind: ${item.kind}`,
    `title: ${item.title}`,
    item.area ? `area: ${item.area}` : undefined,
    item.tool_name ? `tool_name: ${item.tool_name}` : undefined,
    `summary: ${item.summary}`,
    item.impact ? `impact: ${item.impact}` : undefined,
    item.repro ? `repro: ${item.repro}` : undefined,
    item.expected ? `expected: ${item.expected}` : undefined,
    item.actual ? `actual: ${item.actual}` : undefined,
    item.suggestion ? `suggestion: ${item.suggestion}` : undefined,
    `created: ${new Date(item.time).toISOString()}`,
    `created_at: ${item.created_at}`,
  ]
    .filter(Boolean)
    .join("\n")
}

export const BugReportTool = Tool.define<typeof parameters, Metadata>(id, {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: id,
      patterns: ["write"],
      always: ["write"],
      metadata: {
        title: params.title,
        kind: params.kind,
        area: params.area,
        tool_name: params.tool_name,
      },
    })

    const created = Date.now()
    const created_at = new Date(created).toISOString()
    const entry = TeamBugReport.Entry.parse({
      id: Identifier.ascending("tool"),
      project_id: Instance.project.id,
      project_name: await name(),
      session_id: ctx.sessionID,
      message_id: ctx.messageID,
      call_id: ctx.callID,
      agent: ctx.agent,
      worktree: Instance.worktree,
      cwd: rel(Instance.directory),
      kind: params.kind ?? "bug",
      title: params.title.trim(),
      summary: params.summary.trim(),
      area: params.area?.trim() || undefined,
      tool_name: params.tool_name?.trim() || undefined,
      impact: params.impact?.trim() || undefined,
      repro: params.repro?.trim() || undefined,
      expected: params.expected?.trim() || undefined,
      actual: params.actual?.trim() || undefined,
      suggestion: params.suggestion?.trim() || undefined,
      time: created,
      created_at,
    })

    await TeamBugReport.create({
      root: Instance.worktree,
      entry,
    })
    await Bus.publish(TeamBugReport.Event.Created, {
      projectID: Instance.project.id,
      entry,
      file: TeamBugReport.file,
    })

    return {
      title: "report saved",
      output: fmt(entry, TeamBugReport.file),
      metadata: {
        report_id: entry.id,
        file: TeamBugReport.file,
        agent: entry.agent,
        project_id: entry.project_id,
        project_name: entry.project_name,
        created,
        created_at,
      },
    }
  },
})
