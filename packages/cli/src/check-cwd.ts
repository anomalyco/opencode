import { writeSync } from "node:fs"

try {
  process.cwd()
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  writeSync(2, "Error: The current directory no longer exists. Change directories and run opencode again.\n")
  process.exit(1)
}
