import { EOL } from "os"
import { cmd } from "../cmd"

export const StartupCommand = cmd({
  command: "startup",
  describe: "print startup timing",
  builder: (yargs) => yargs,
  handler() {
    process.stdout.write(performance.now().toString() + EOL)
  },
})
