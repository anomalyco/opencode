import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { Workflow } from "../../workflow"

const workflowAddCmd = cmd({
  command: "add <source>",
  describe: "install a workflow plugin (alias or GitHub URL)",
  builder: (yargs) =>
    yargs.positional("source", {
      type: "string",
      describe: 'workflow alias (e.g. "gsd") or full GitHub URL',
      demandOption: true,
    }),
  async handler(args) {
    const source = args.source as string
    const spin = prompts.spinner()
    spin.start(`Installing workflow: ${source}`)
    try {
      await Workflow.install(source)
      spin.stop(`Workflow "${source}" installed successfully`)
      prompts.log.info("Restart CoBuilder to activate workflow commands in the TUI.")
    } catch (e) {
      spin.stop("Installation failed")
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})

const workflowListCmd = cmd({
  command: "list",
  describe: "list installed workflow plugins",
  handler: async () => {
    const workflows = await Workflow.list()
    if (workflows.length === 0) {
      prompts.log.info("No workflows installed. Run: cobuilder workflow add <alias>")
      return
    }
    for (const wf of workflows) {
      const version = wf.version ? `@${wf.version}` : ""
      const desc = wf.description ? ` — ${wf.description}` : ""
      prompts.log.info(`${wf.name}${version}${desc}`)
      prompts.log.info(`  path: ${wf.path}`)
    }
  },
})

const workflowRemoveCmd = cmd({
  command: "remove <name>",
  describe: "remove an installed workflow plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: "workflow name to remove",
      demandOption: true,
    }),
  async handler(args) {
    const name = args.name as string
    const spin = prompts.spinner()
    spin.start(`Removing workflow: ${name}`)
    try {
      await Workflow.remove(name)
      spin.stop(`Workflow "${name}" removed`)
    } catch (e) {
      spin.stop("Removal failed")
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})

export const WorkflowCommand = cmd({
  command: "workflow <action>",
  describe: "manage workflow plugins",
  builder: (yargs) =>
    yargs
      .command(workflowAddCmd)
      .command(workflowListCmd)
      .command(workflowRemoveCmd)
      .demandCommand(1, "Specify a subcommand: add, list, or remove"),
  handler: () => {},
})
