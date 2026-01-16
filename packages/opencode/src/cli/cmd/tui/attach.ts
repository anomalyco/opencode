import path from "path"
import { cmd } from "../cmd"
import { tui } from "./app"

const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"])

function resolveDir(url: string, dir?: string) {
  if (!dir) return dir
  const target = URL.canParse(url) ? new URL(url) : new URL(`http://${url}`)
  if (!localHosts.has(target.hostname)) return dir
  if (path.isAbsolute(dir)) return dir
  const base = process.env.PWD ?? process.cwd()
  return path.resolve(base, dir)
}

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      }),
  handler: async (args) => {
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      directory: resolveDir(args.url, args.dir),
    })
  },
})
