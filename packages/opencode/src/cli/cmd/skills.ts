import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"

const REGISTRY: Record<string, string> = {
  gsd: "https://github.com/CobuilderLabs/gsd-workflow",
}

const skillsInstallCmd = cmd({
  command: "install <name>",
  describe: "install a skill by alias or GitHub URL",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: 'skill alias (e.g. "gsd") or full GitHub URL',
      demandOption: true,
    }),
  async handler(args) {
    const input = args.name as string
    const url =
      input in REGISTRY
        ? REGISTRY[input]!
        : input.startsWith("https://") || input.startsWith("git@")
          ? input
          : null

    if (!url) {
      prompts.log.error(
        `Unknown skill "${input}". Available aliases: ${Object.keys(REGISTRY).join(", ")}`,
      )
      process.exit(1)
    }

    const skillName =
      input in REGISTRY ? input : url.split("/").pop()?.replace(/\.git$/, "") ?? input
    const tmpDir = path.join(Global.Path.config, ".skill-install-tmp")
    const destDir = path.join(Global.Path.config, "commands", skillName)

    const spin = prompts.spinner()
    spin.start(`Installing skill: ${skillName}`)

    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
      const proc = Bun.spawnSync(["git", "clone", "--depth=1", url, tmpDir], { stderr: "pipe" })
      if (proc.exitCode !== 0) {
        throw new Error(`git clone failed: ${new TextDecoder().decode(proc.stderr)}`)
      }

      const srcCommands = path.join(tmpDir, "commands")
      await fs.mkdir(destDir, { recursive: true })
      const files = await fs.readdir(srcCommands).catch(() => [] as string[])
      for (const file of files) {
        if (file.endsWith(".md")) {
          await fs.copyFile(path.join(srcCommands, file), path.join(destDir, file))
        }
      }

      await fs.rm(tmpDir, { recursive: true, force: true })
      spin.stop(`Skill "${skillName}" installed`)
      prompts.log.info(`Run /${skillName}:<command> in CoBuilder to use it.`)
    } catch (e) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      spin.stop("Installation failed")
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})

const skillsListCmd = cmd({
  command: "list",
  describe: "list installed skills",
  handler: async () => {
    const commandsDir = path.join(Global.Path.config, "commands")
    let entries: string[] = []
    try {
      entries = await fs.readdir(commandsDir)
    } catch {
      prompts.log.info("No skills installed.")
      return
    }
    const skills: string[] = []
    for (const entry of entries) {
      const stat = await fs.stat(path.join(commandsDir, entry)).catch(() => null)
      if (stat?.isDirectory()) skills.push(entry)
    }
    if (skills.length === 0) {
      prompts.log.info("No skills installed. Run: cobuilder skills install <name>")
    } else {
      for (const s of skills) prompts.log.info(`  ${s}`)
    }
  },
})

const skillsRemoveCmd = cmd({
  command: "remove <name>",
  describe: "remove an installed skill",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: "skill name to remove",
      demandOption: true,
    }),
  async handler(args) {
    const name = args.name as string
    const destDir = path.join(Global.Path.config, "commands", name)
    const spin = prompts.spinner()
    spin.start(`Removing skill: ${name}`)
    try {
      await fs.rm(destDir, { recursive: true, force: true })
      spin.stop(`Skill "${name}" removed`)
    } catch (e) {
      spin.stop("Removal failed")
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})

export const SkillsCommand = cmd({
  command: "skills <action>",
  describe: "manage skills (install, list, remove)",
  builder: (yargs) =>
    yargs
      .command(skillsInstallCmd)
      .command(skillsListCmd)
      .command(skillsRemoveCmd)
      .demandCommand(1, "Specify a subcommand: install, list, or remove"),
  handler: () => {},
})
