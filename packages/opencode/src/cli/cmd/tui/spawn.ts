import { cmd } from "@/cli/cmd/cmd"
import { Instance } from "@/project/instance"
import path from "path"
import { Server } from "@/server/server"
import { upgrade } from "@/cli/upgrade"

export const TuiSpawnCommand = cmd({
  command: "spawn [project]",
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
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    upgrade()
    const server = Server.listen({
      port: args.port,
      hostname: "127.0.0.1",
    })
    const bin = process.execPath
    const cmd: string[] = []
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

    // Ensure all arguments are strings
    const projectPath = args.project ? path.resolve(args.project) : process.cwd()
    const serverUrl = server.url.toString()

    if (typeof projectPath !== "string") {
      console.error("ERROR: Invalid project path", { projectPath, type: typeof projectPath })
      throw new Error(
        `Invalid project path: expected string, got ${typeof projectPath}. Value: ${JSON.stringify(projectPath)}`,
      )
    }
    if (typeof serverUrl !== "string") {
      console.error("ERROR: Invalid server URL", { serverUrl, type: typeof serverUrl })
      throw new Error(
        `Invalid server URL: expected string, got ${typeof serverUrl}. Value: ${JSON.stringify(serverUrl)}`,
      )
    }

    cmd.push("attach", serverUrl, "--dir", projectPath)

    // Final validation of entire cmd array
    console.log("TUI Spawn cmd array:", JSON.stringify(cmd))
    for (let i = 0; i < cmd.length; i++) {
      if (typeof cmd[i] !== "string") {
        console.error(`ERROR: Invalid cmd[${i}]`, { value: cmd[i], type: typeof cmd[i] })
        throw new Error(
          `Invalid command argument at index ${i}: expected string, got ${typeof cmd[i]}. Value: ${JSON.stringify(cmd[i])}`,
        )
      }
    }
    const proc = Bun.spawn({
      cmd,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        BUN_OPTIONS: "",
      },
    })
    await proc.exited
    await Instance.disposeAll()
    await server.stop(true)
  },
})
