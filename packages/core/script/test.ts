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

const args = process.argv.slice(2)
const postgres = args.includes("--postgres")
const passthrough = args.filter((arg) => arg !== "--postgres")

// The PostgreSQL suite needs a disposable server; a lane that silently skipped
// would look green while testing nothing.
if (postgres && !process.env.OPENCODE_PG_TEST_DSN) {
  console.error("--postgres needs OPENCODE_PG_TEST_DSN pointing at a disposable PostgreSQL database")
  process.exit(1)
}

const child = Bun.spawn({
  // The 30s default timeout matches cli and tui; npm.test's Git package installs ran past Bun's 5s default on Windows.
  //
  // Every suite here was written against SQLite's in-memory database, so the
  // run pins the sqlite build of the driver seam (#database, #dialect). The
  // PostgreSQL build runs through --postgres, which leaves the default
  // (PostgreSQL) build in place for test/postgres.test.ts.
  cmd: [
    process.execPath,
    "test",
    ...(postgres ? [] : ["--conditions=sqlite"]),
    "--only-failures",
    "--timeout=30000",
    ...passthrough,
  ],
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
