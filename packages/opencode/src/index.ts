import { Log } from "./util/log"

await Log.init({
  print: true,
  dev: process.env.NODE_ENV === "development",
  level: "INFO",
})

Log.Default.error("cli removed", {
  message: "This build is hosted-only and does not support CLI/TUI commands.",
})

process.stderr.write("CLI/TUI is not supported in this hosted build.\n")
process.exit(1)
