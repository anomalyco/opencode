import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Cache } from "@/cache"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Skill } from "@/skill"

function sanitize(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_")
}

async function enabled() {
  if (await Cache.isEnabled()) return true
  prompts.log.warn(
    "Cache feature not enabled. Set OPENCODE_EXPERIMENTAL_CACHE=true or experimental.cache.enabled in your config.",
  )
  return false
}

function ago(input?: number) {
  if (!input) return "-"
  const delta = Date.now() - input
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
  return `${Math.floor(delta / 86_400_000)}d`
}

function printTable(rows: string[][]) {
  if (rows.length === 0) return
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)))
  for (const row of rows) {
    console.log(row.map((col, i) => col.padEnd(widths[i])).join("  "))
  }
}

export const CacheCommand = cmd({
  command: "cache",
  describe: "manage L1/L2 tool and skill cache",
  builder: (yargs) =>
    yargs
      .command(CacheAddCommand)
      .command(CacheRemoveCommand)
      .command(CacheListCommand)
      .command(CachePromoteCommand)
      .command(CacheDemoteCommand)
      .command(CacheReembedCommand)
      .demandCommand(),
  async handler() {},
})

const CacheAddCommand = cmd({
  command: "add",
  describe: "add tools or skills to cache",
  builder: (yargs) => yargs.command(CacheAddToolCommand).command(CacheAddSkillCommand).demandCommand(),
  async handler() {},
})

const CacheAddToolCommand = cmd({
  command: "tool <server> <tool>",
  describe: "register an MCP tool in cache (starts in L2)",
  builder: (yargs) =>
    yargs
      .positional("server", { type: "string", describe: "MCP server name" })
      .positional("tool", { type: "string", describe: "MCP tool name" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return

        const cfg = await Config.get()
        const server = args.server as string
        const tool = args.tool as string
        if (!cfg.mcp?.[server]) {
          prompts.log.error(`MCP server '${server}' is not configured.`)
          return
        }

        const id = `${sanitize(server)}_${sanitize(tool)}`
        const tools = await MCP.tools()
        const found = tools[id]
        if (!found) {
          prompts.log.error(`Tool '${tool}' was not found on server '${server}'.`)
          return
        }

        await Cache.registerTool({
          id,
          name: id,
          description: found.description ?? "",
          schema_json: JSON.stringify(found.inputSchema ?? {}),
        })
        prompts.log.success(`Added tool '${id}' to cache (L2).`)
      },
    })
  },
})

const CacheAddSkillCommand = cmd({
  command: "skill <name>",
  describe: "register a skill in cache (starts in L2)",
  builder: (yargs) => yargs.positional("name", { type: "string", describe: "Skill name" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return

        const name = args.name as string
        const skill = await Skill.get(name)
        if (!skill) {
          prompts.log.error(`Skill '${name}' was not found.`)
          return
        }

        await Cache.registerSkill({
          name: skill.name,
          description: skill.description,
          location: skill.location,
        })
        prompts.log.success(`Added skill '${name}' to cache (L2).`)
      },
    })
  },
})

const CacheListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list cached tools and skills",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return

        const all = await Cache.list()
        const rows = [
          ["Type", "ID/Name", "Tier", "Last Used", "Count"],
          ...all.tools.map((item) => [
            "tool",
            item.id,
            item.is_l1 ? "L1" : "L2",
            ago(item.last_used),
            `${item.use_count}`,
          ]),
          ...all.skills.map((item) => [
            "skill",
            item.name,
            item.is_l1 ? "L1" : "L2",
            ago(item.last_used),
            `${item.use_count}`,
          ]),
        ]
        printTable(rows)
      },
    })
  },
})

const CachePromoteCommand = cmd({
  command: "promote",
  describe: "promote cached entries to L1",
  builder: (yargs) => yargs.command(CachePromoteToolCommand).command(CachePromoteSkillCommand).demandCommand(),
  async handler() {},
})

const CachePromoteToolCommand = cmd({
  command: "tool <id>",
  describe: "promote a cached tool to L1",
  builder: (yargs) => yargs.positional("id", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        const row = await Cache.promoteTool(args.id as string)
        if (!row) {
          prompts.log.error("Tool not found in cache.")
          return
        }
        prompts.log.success(`Promoted tool '${row.id}' to L1.`)
      },
    })
  },
})

const CachePromoteSkillCommand = cmd({
  command: "skill <name>",
  describe: "promote a cached skill to L1",
  builder: (yargs) => yargs.positional("name", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        const row = await Cache.promoteSkill(args.name as string)
        if (!row) {
          prompts.log.error("Skill not found in cache.")
          return
        }
        prompts.log.success(`Promoted skill '${row.name}' to L1.`)
      },
    })
  },
})

const CacheDemoteCommand = cmd({
  command: "demote",
  describe: "demote cached entries to L2",
  builder: (yargs) => yargs.command(CacheDemoteToolCommand).command(CacheDemoteSkillCommand).demandCommand(),
  async handler() {},
})

const CacheDemoteToolCommand = cmd({
  command: "tool <id>",
  describe: "demote a cached tool to L2",
  builder: (yargs) => yargs.positional("id", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        const row = await Cache.demoteTool(args.id as string)
        if (!row) {
          prompts.log.error("Tool not found in cache.")
          return
        }
        prompts.log.success(`Demoted tool '${row.id}' to L2.`)
      },
    })
  },
})

const CacheDemoteSkillCommand = cmd({
  command: "skill <name>",
  describe: "demote a cached skill to L2",
  builder: (yargs) => yargs.positional("name", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        const row = await Cache.demoteSkill(args.name as string)
        if (!row) {
          prompts.log.error("Skill not found in cache.")
          return
        }
        prompts.log.success(`Demoted skill '${row.name}' to L2.`)
      },
    })
  },
})

const CacheRemoveCommand = cmd({
  command: "remove",
  describe: "remove cached entries",
  builder: (yargs) => yargs.command(CacheRemoveToolCommand).command(CacheRemoveSkillCommand).demandCommand(),
  async handler() {},
})

const CacheRemoveToolCommand = cmd({
  command: "tool <id>",
  describe: "remove a tool from cache",
  builder: (yargs) => yargs.positional("id", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        await Cache.unregisterTool(args.id as string)
        prompts.log.success(`Removed tool '${args.id as string}' from cache.`)
      },
    })
  },
})

const CacheRemoveSkillCommand = cmd({
  command: "skill <name>",
  describe: "remove a skill from cache",
  builder: (yargs) => yargs.positional("name", { type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        await Cache.unregisterSkill(args.name as string)
        prompts.log.success(`Removed skill '${args.name as string}' from cache.`)
      },
    })
  },
})

const CacheReembedCommand = cmd({
  command: "reembed",
  describe: "regenerate all cached embeddings",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!(await enabled())) return
        await Cache.reembed()
        prompts.log.success("Regenerated all cache embeddings.")
      },
    })
  },
})
