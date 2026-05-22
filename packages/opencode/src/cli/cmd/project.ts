import type { Argv } from "yargs"
import { Cause, Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Project } from "@/project/project"
import { ProjectID } from "../../project/schema"
import { UI } from "../ui"
import { EOL } from "os"

export const ProjectCommand = cmd({
  command: "project",
  describe: "manage projects",
  builder: (yargs: Argv) => yargs.command(ProjectDeleteCommand).command(ProjectListCommand).demandCommand(),
  async handler() {},
})

export const ProjectDeleteCommand = effectCmd({
  command: "delete <projectID>",
  describe: "delete a project and all its data",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("projectID", {
        describe: "project ID to delete",
        type: "string",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        describe: "skip confirmation",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.project.delete")(function* (args) {
    const svc = yield* Project.Service
    const projectID = ProjectID.make(args.projectID)

    const project = yield* Effect.sync(() => Project.get(projectID))

    if (!args.force) {
      const name = project?.name ?? projectID
      const input = yield* Effect.promise(() =>
        UI.input(`Delete project '${name}' and ALL its data? Type '${projectID}' to confirm: `),
      )
      if (input !== projectID) {
        UI.println("Confirmation failed. Aborting.")
        return
      }
    }

    yield* svc.remove(projectID).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause)
        return fail(error instanceof Error ? error.message : String(error))
      }),
    )
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Project ${projectID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const ProjectListCommand = effectCmd({
  command: "list",
  describe: "list projects",
  instance: false,
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.project.list")(function* (args) {
    const svc = yield* Project.Service
    const projects = yield* svc.list()

    if (projects.length === 0) return

    const output = args.format === "json" ? formatProjectJSON(projects) : formatProjectTable(projects)
    console.log(output)
  }),
})

function formatProjectTable(projects: Project.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...projects.map((p) => p.id.length))
  const maxNameWidth = Math.max(25, ...projects.map((p) => p.name?.length ?? 0))
  const maxWorktreeWidth = Math.max(20, ...projects.map((p) => p.worktree.length))

  const header = `Project ID${" ".repeat(Math.max(0, maxIdWidth - 10))}  Name${" ".repeat(Math.max(0, maxNameWidth - 4))}  Worktree${" ".repeat(Math.max(0, maxWorktreeWidth - 8))}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const project of projects) {
    const name = project.name ?? ""
    const paddedId = project.id.padEnd(maxIdWidth)
    const paddedName = name.padEnd(maxNameWidth)
    const paddedWorktree = project.worktree.padEnd(maxWorktreeWidth)
    const timeStr = new Date(project.time.updated).toISOString().slice(0, 19).replace("T", " ")
    lines.push(`${paddedId}  ${paddedName}  ${paddedWorktree}  ${timeStr}`)
  }

  return lines.join(EOL)
}

function formatProjectJSON(projects: Project.Info[]): string {
  const jsonData = projects.map((project) => ({
    id: project.id,
    name: project.name,
    worktree: project.worktree,
    vcs: project.vcs,
    updated: project.time.updated,
    created: project.time.created,
    sandboxes: project.sandboxes,
  }))
  return JSON.stringify(jsonData, null, 2)
}
