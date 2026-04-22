import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { TeamBugReport } from "@/team/bug-report"
import z from "zod"
import { Tool } from "../shared/tool"

const DESCRIPTION = `Manage saved opencode-environment bug reports, suggestions, and feature requests.

Actions:
- \`list\`: show saved reports, optionally narrowed by exact-match filter fields
- \`update\`: update one saved report by \`report_id\` using \`patch\`
- \`delete\`: delete the selected \`report_ids\`
- \`clear\`: remove all saved reports with \`clear_all=true\`, or only the set matched by \`filter\`

Required fields:
- \`update\` requires \`report_id\` and a non-empty \`patch\`
- \`delete\` requires \`report_ids\`
- \`clear\` requires either \`clear_all=true\` or \`filter\`

Behavior notes:
- This is the single tool for listing, updating, deleting selected reports, and clearing filtered or full report sets from the shared bug report log
- \`list\` may migrate legacy bug report logs into the shared \`~/.config/opencode/bug-report.json\` file before returning results
- \`update\`, \`delete\`, and \`clear\` persist changes to the shared log and matching legacy bug report files so removed reports do not reappear on the next sync`

const id = "bug_report_management"
const Action = z.enum(["list", "update", "delete", "clear"])
const text = z.string().trim().min(1)

const patch = z.object({
  kind: TeamBugReport.Entry.shape.kind.optional(),
  title: text.optional(),
  summary: text.optional(),
  area: text.nullable().optional(),
  tool_name: text.nullable().optional(),
  impact: text.nullable().optional(),
  repro: text.nullable().optional(),
  expected: text.nullable().optional(),
  actual: text.nullable().optional(),
  suggestion: text.nullable().optional(),
})

const parameters = z
  .object({
    action: Action.describe("Management action."),
    report_id: z.string().optional().describe("Report id for action=update."),
    report_ids: z.array(z.string()).min(1).optional().describe("Report ids for action=delete."),
    filter: TeamBugReport.Filter.optional().describe("Optional exact-match filter for action=list or action=clear."),
    clear_all: z.boolean().optional().describe("Allow action=clear to remove every saved report."),
    patch: patch.optional().describe("Fields to update for action=update. Use null to clear optional text fields."),
  })
  .superRefine((value, ctx) => {
    if (value.action === "update" && !value.report_id) {
      ctx.addIssue({ code: "custom", path: ["report_id"], message: "report_id is required when action=update" })
    }
    if (value.action === "update" && (!value.patch || Object.keys(value.patch).length === 0)) {
      ctx.addIssue({ code: "custom", path: ["patch"], message: "patch is required when action=update" })
    }
    if (value.action === "delete" && !value.report_ids?.length) {
      ctx.addIssue({ code: "custom", path: ["report_ids"], message: "report_ids is required when action=delete" })
    }
    if (value.action === "clear" && !value.clear_all && !value.filter) {
      ctx.addIssue({
        code: "custom",
        path: ["clear_all"],
        message: "set clear_all=true or provide filter when action=clear",
      })
    }
  })

type Metadata = {
  action: z.infer<typeof Action>
  count: number
  file: string
  report_ids: string[]
}

function fmt(item: TeamBugReport.Entry) {
  return [
    `report_id: ${item.id}`,
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
    `agent: ${item.agent}`,
    `project_name: ${item.project_name}`,
    `worktree: ${item.worktree}`,
    `cwd: ${item.cwd}`,
    `created_at: ${item.created_at}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function show(list: TeamBugReport.Entry[]) {
  return list.length ? list.map(fmt).join("\n\n---\n\n") : "No bug reports found."
}

function mode(action: z.infer<typeof Action>) {
  if (action === "list") return ["read", "write"] as const
  return ["write"] as const
}

function next(input: z.infer<typeof patch>) {
  const out: TeamBugReport.Patch = {}
  if ("kind" in input) out.kind = input.kind
  if ("title" in input) out.title = input.title
  if ("summary" in input) out.summary = input.summary
  if ("area" in input) out.area = input.area ?? undefined
  if ("tool_name" in input) out.tool_name = input.tool_name ?? undefined
  if ("impact" in input) out.impact = input.impact ?? undefined
  if ("repro" in input) out.repro = input.repro ?? undefined
  if ("expected" in input) out.expected = input.expected ?? undefined
  if ("actual" in input) out.actual = input.actual ?? undefined
  if ("suggestion" in input) out.suggestion = input.suggestion ?? undefined
  return out
}

function pick(input?: string) {
  const value = input?.trim()
  if (!value) return
  const low = value.toLowerCase()
  if (low === "x" || low === "dummy" || low === "placeholder" || low === "__none__") return
  return value
}

function clean(filter?: z.infer<typeof TeamBugReport.Filter>) {
  if (!filter) return
  const next: z.infer<typeof TeamBugReport.Filter> = {}
  const ids = filter.ids?.map((item) => pick(item)).filter((item): item is string => !!item && item.startsWith("tool_")) ?? []
  if (ids.length > 0) next.ids = ids
  if (filter.kind) next.kind = filter.kind

  const agent = pick(filter.agent)
  if (agent) next.agent = agent
  const project_id = pick(filter.project_id)
  if (project_id) next.project_id = project_id
  const project_name = pick(filter.project_name)
  if (project_name) next.project_name = project_name
  const worktree = pick(filter.worktree)
  if (worktree) next.worktree = worktree
  const cwd = pick(filter.cwd)
  if (cwd) next.cwd = cwd
  const area = pick(filter.area)
  if (area) next.area = area
  const tool_name = pick(filter.tool_name)
  if (tool_name) next.tool_name = tool_name

  return Object.keys(next).length > 0 ? next : undefined
}

export const BugReportManagementTool = Tool.define<typeof parameters, Metadata>(id, {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const allow = mode(params.action)
    await ctx.ask({
      permission: id,
      patterns: [...allow],
      always: [...allow],
      metadata: {
        action: params.action,
        report_id: params.report_id,
        report_ids: params.report_ids,
        filter: params.filter,
      },
    })

    if (params.action === "list") {
      const filter = clean(params.filter)
      const list = await TeamBugReport.list(Instance.worktree, filter)
      return {
        title: list.length === 1 ? "listed 1 report" : `listed ${list.length} reports`,
        output: show(list),
        metadata: {
          action: params.action,
          count: list.length,
          file: TeamBugReport.file,
          report_ids: list.map((item) => item.id),
        },
      }
    }

    if (params.action === "update") {
      const item = await TeamBugReport.update({
        root: Instance.worktree,
        id: params.report_id!,
        patch: next(params.patch!),
      })
      if (!item) throw new Error(`bug report not found: ${params.report_id}`)
      await Bus.publish(TeamBugReport.Event.Updated, {
        projectID: item.project_id,
        entry: item,
        file: TeamBugReport.file,
      })
      return {
        title: "updated 1 report",
        output: fmt(item),
        metadata: {
          action: params.action,
          count: 1,
          file: TeamBugReport.file,
          report_ids: [item.id],
        },
      }
    }

    if (params.action === "delete") {
      const list = await TeamBugReport.remove({
        root: Instance.worktree,
        ids: params.report_ids!,
      })
      if (list.length) {
        await Bus.publish(TeamBugReport.Event.Removed, {
          report_ids: list.map((item) => item.id),
          file: TeamBugReport.file,
        })
      }
      return {
        title: list.length === 1 ? "deleted 1 report" : `deleted ${list.length} reports`,
        output: show(list),
        metadata: {
          action: params.action,
          count: list.length,
          file: TeamBugReport.file,
          report_ids: list.map((item) => item.id),
        },
      }
    }

    const filter = clean(params.filter)
    if (!params.clear_all && params.filter && !filter) {
      return {
        title: "cleared 0 reports",
        output: show([]),
        metadata: {
          action: params.action,
          count: 0,
          file: TeamBugReport.file,
          report_ids: [],
        },
      }
    }
    const list = await TeamBugReport.clear({
      root: Instance.worktree,
      filter: params.clear_all ? undefined : filter,
    })
    if (list.length) {
      await Bus.publish(TeamBugReport.Event.Removed, {
        report_ids: list.map((item) => item.id),
        file: TeamBugReport.file,
      })
    }
    return {
      title: list.length === 1 ? "cleared 1 report" : `cleared ${list.length} reports`,
      output: show(list),
      metadata: {
        action: params.action,
        count: list.length,
        file: TeamBugReport.file,
        report_ids: list.map((item) => item.id),
      },
    }
  },
})
