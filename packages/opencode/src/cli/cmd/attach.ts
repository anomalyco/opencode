import { Global } from "../../global"
import { UI } from "../ui"
import { cmd } from "./cmd"
import path from "path"
import fs from "fs/promises"

export const AttachCommand = cmd({
  command: "attach <host>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("host", {
        type: "string",
        describe: "hostname of the running opencode server",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("prompt", {
        alias: ["p"],
        type: "string",
        describe: "prompt to use",
      })
      .option("mode", {
        type: "string",
        describe: "mode to use",
      }),
  handler: async (args) => {
    let host = args.host

    if (!host) {
      UI.error("Host is required. Please provide a valid host address.")
      return
    }

    if (!host.startsWith("http://") && !host.startsWith("https://")) {
      host = `http://${host}`
    }

    let cmd = ["go", "run", "./main.go"]
    let cwd = Bun.fileURLToPath(new URL("../../../../tui/cmd/opencode", import.meta.url))
    if (Bun.embeddedFiles.length > 0) {
      const blob = Bun.embeddedFiles[0] as File
      let binaryName = blob.name
      if (process.platform === "win32" && !binaryName.endsWith(".exe")) {
        binaryName += ".exe"
      }
      const binary = path.join(Global.Path.cache, "tui", binaryName)
      const file = Bun.file(binary)
      if (!(await file.exists())) {
        await Bun.write(file, blob, { mode: 0o755 })
        await fs.chmod(binary, 0o755)
      }
      cwd = process.cwd()
      cmd = [binary]
    }

    const proc = Bun.spawn({
      cmd: [
        ...cmd,
        ...(args.model ? ["--model", args.model] : []),
        ...(args.prompt ? ["--prompt", args.prompt] : []),
        ...(args.mode ? ["--mode", args.mode] : []),
      ],
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        OPENCODE_SERVER: host,
      },
    })

    await proc.exited
  },
})
