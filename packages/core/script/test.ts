import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../test/fixture/tmpdir"

await using directory = await tmpdir("oc-")
const home = directory.path
const temporary = path.join(home, "tmp")
await fs.mkdir(temporary)

const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      if (process.env.RECORD === "true" && name === "OPENAI_API_KEY") return true
      if (
        /^(?:AWS|AZURE|GOOGLE|GCP|GCLOUD|VERTEX|OPENAI|ANTHROPIC|GEMINI|XAI|CLOUDFLARE|CF_AIG|SNOWFLAKE|AICORE|GITLAB|NPM_CONFIG)_/i.test(
          name,
        )
      ) {
        return false
      }
      return !/(?:^|_)(?:API_KEY|AUTHORIZATION|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/i.test(name)
    }),
  ),
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  OPENCODE_CONFIG_DIR: path.join(home, ".config", "opencode"),
  OPENCODE_CONFIG: undefined,
  OPENCODE_CONFIG_CONTENT: undefined,
  TMPDIR: temporary,
  ...(process.platform === "win32" ? { USERPROFILE: home, TMP: temporary, TEMP: temporary } : {}),
}

const child = Bun.spawn({
  cmd: [process.execPath, "test", "--only-failures", ...process.argv.slice(2)],
  env: environment,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const interrupt = () => child.kill("SIGINT")
const terminate = () => child.kill("SIGTERM")
process.once("SIGINT", interrupt)
process.once("SIGTERM", terminate)
const result = await child.exited
process.off("SIGINT", interrupt)
process.off("SIGTERM", terminate)

process.exitCode = result
