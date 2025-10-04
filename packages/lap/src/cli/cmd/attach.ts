import { Global } from "../../global"
import { cmd } from "./cmd"
import path from "path"
import fs from "fs/promises"
import { Log } from "../../util/log"

import { $ } from "bun"

export const AttachCommand = cmd({
  command: "attach <server>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs.positional("server", {
      type: "string",
      describe: "http://localhost:4096",
    }),
  handler: async (args) => {
    let cmd = [] as string[]
    const tui = Bun.embeddedFiles.find((item) => (item as File).name.includes("tui")) as File
    if (tui) {
      let binaryName = tui.name
      if (process.platform === "win32" && !binaryName.endsWith(".exe")) {
        binaryName += ".exe"
      }
      const binary = path.join(Global.Path.cache, "tui", binaryName)
      const file = Bun.file(binary)
      if (!(await file.exists())) {
        await Bun.write(file, tui, { mode: 0o755 })
        if (process.platform !== "win32") await fs.chmod(binary, 0o755)
      }
      cmd = [binary]
    }
    if (!tui) {
      const dir = Bun.fileURLToPath(new URL("../../../../tui/cmd/opencode", import.meta.url))
      let binaryName = `./dist/tui${process.platform === "win32" ? ".exe" : ""}`
      await $`go build -o ${binaryName} ./main.go`.cwd(dir)
      cmd = [path.join(dir, binaryName)]
    }
    Log.Default.info("tui", {
      cmd,
    })
    const proc = Bun.spawn({
      cmd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        OPENCODE_SERVER: args.server,
      },
    })

    await proc.exited
  },
})
