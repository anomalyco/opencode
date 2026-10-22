import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { tmpdir } from "./fixture/tmpdir"

test.each(["root", "child"])("a permission-declined %s stays interrupted after a new process starts", async (kind) => {
  await using directory = await tmpdir("permission-restart-")
  const path = `${directory.path}/decline.db`
  const run = async (mode: "decline" | "recover") => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixture/permission-restart.ts`, mode, path, kind], {
      env: { ...process.env, OPENCODE_DB: undefined },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr, stdout).toBe("")
    expect(code).toBe(0)
    return Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          reason: Schema.NullOr(Schema.String),
          requests: Schema.Number,
          pending: Schema.Number,
          messages: Schema.Array(Schema.Unknown),
          error: Schema.NullOr(Schema.String),
          interruptionReason: Schema.NullOr(Schema.String),
          idle: Schema.NullOr(Schema.String),
          restarts: Schema.Number,
          notices: Schema.Array(
            Schema.Struct({ id: Schema.String, metadata: Schema.Struct({ state: Schema.String }) }),
          ),
        }),
      ),
    )(stdout.trim().split("\n").at(-1))
  }
  const declined = await run("decline")
  expect(declined.reason).toBe("user")
  expect(declined.requests).toBe(kind === "child" ? 2 : 1)
  expect(declined.pending).toBe(0)
  expect(declined.notices.map((notice) => notice.metadata.state)).toEqual(kind === "child" ? ["cancelled"] : [])
  // These projected facts render as Interrupted, before and after a cold read.
  expect(declined).toMatchObject({ error: "aborted", interruptionReason: null, idle: "interrupted", restarts: 0 })
  using database = new Database(path, { readonly: true })
  expect(database.query("SELECT id FROM session_v2 WHERE time_suspended IS NOT NULL").all()).toEqual([])
  expect(database.query("SELECT key FROM kv WHERE key LIKE 'job.background/%'").all()).toEqual([])
  database.close()
  const recovered = await run("recover")
  expect(recovered).toMatchObject({
    requests: 0,
    pending: 0,
    error: "aborted",
    interruptionReason: null,
    idle: "interrupted",
    restarts: 0,
  })
  expect(recovered.notices).toEqual(declined.notices)
  expect(recovered.messages).toEqual(declined.messages)
})
