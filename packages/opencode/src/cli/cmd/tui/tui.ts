import { cmd } from "@/cli/cmd/cmd"
import { Instance } from "@/project/instance"
import path from "path"
import { Server } from "@/server/server"

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    const server = Server.listen({
      port: args.port,
      hostname: "127.0.0.1",
    })
    const bin = process.execPath
    const cmd = []
    let cwd = process.cwd()
    if (bin.endsWith("bun")) {
      cmd.push(
        process.execPath,
        "run",
        "--conditions",
        "browser",
        new URL("../../../index.ts", import.meta.url).pathname,
      )
      cwd = new URL("../../../../", import.meta.url).pathname
    } else cmd.push(process.execPath)
    cmd.push("attach", server.url.toString(), "--dir", args.project ? path.resolve(args.project) : process.cwd())
    while (true) {
      const proc = Bun.spawn({
        cmd,
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      })
      await proc.exited
      const code = proc.exitCode
      if (code === 0) break
    }
    await server.stop(true)
    await Instance.disposeAll()
  },
})
