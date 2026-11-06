import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { InputRenderable } from "@opentui/core"
import path from "node:path"
import { Schema } from "effect"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { DialogCodex } from "../../src/component/dialog-codex"
import { codexList, codexTransfer } from "../../src/util/codex"
import { renderLocal, session } from "../fixture/local"
import { tmpdir } from "../fixture/fixture"

test("Codex picker imports history without prompting and leaves source databases unchanged", async () => {
  await using home = await tmpdir()
  const state = new Database(path.join(home.path, "state_5.sqlite"))
  state.exec(`CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, rollout_path TEXT, created_at INTEGER,
    updated_at INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER, source TEXT)`)
  state
    .query("INSERT INTO threads VALUES (?, ?, ?, '', 1, 2, NULL, NULL, ?)")
    .run("thread", "Codex import fixture", home.path, "vscode")
  state
    .query("INSERT INTO threads VALUES (?, ?, ?, '', 3, 4, NULL, NULL, ?)")
    .run("child", "Hidden child", home.path, '{"subagent":{}}')
  state.close()
  const history = new Database(path.join(home.path, "thread_history_1.sqlite"))
  history.exec(`CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, status TEXT);
    CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_json TEXT, created_at_ms INTEGER,
      completed_at_ms INTEGER, rollout_ordinal INTEGER)`)
  history.query("INSERT INTO thread_turns VALUES ('thread', 'turn', 'completed')").run()
  const items = [
    { type: "userMessage", content: [{ type: "text", text: "Investigate the cache" }] },
    { type: "agentMessage", text: "I will inspect it." },
    {
      type: "commandExecution",
      command: "git status",
      cwd: home.path,
      status: "completed",
      aggregatedOutput: "clean",
      exitCode: 0,
    },
    {
      type: "mcpToolCall",
      tool: "lookup",
      status: "completed",
      result: { content: [{ type: "text", text: "found" }] },
    },
    { type: "reasoning", summary: "Private reasoning" },
    { type: "commandExecution", command: "unfinished", status: "inProgress" },
  ]
  items.forEach((item, index) =>
    history
      .query("INSERT INTO thread_items VALUES ('thread', 'turn', ?, ?, ?, ?)")
      .run(JSON.stringify(item), index + 1000, index + 1000, index),
  )
  history.close()
  const before = await Promise.all(
    ["state_5.sqlite", "thread_history_1.sqlite"].map((file) => Bun.file(path.join(home.path, file)).arrayBuffer()),
  )
  expect((await codexList(home.path)).map((thread) => thread.title)).toEqual(["Codex import fixture"])
  const imported: SessionTransfer.Data[] = []
  await using setup = await renderLocal({
    fetch: async (url, request) => {
      if (url.pathname === "/api/experimental/session/import" || url.pathname === "/api/session/import") {
        const transfer = Schema.decodeUnknownSync(SessionTransfer.Data)(await request.json())
        imported.push(transfer)
        return Response.json({
          data: { ...session(transfer.info.id, { providerID: "provider", id: "first" }), title: transfer.info.title },
        })
      }
      if (url.pathname.startsWith("/api/session/"))
        return Response.json({
          data: session(url.pathname.split("/").at(-1)!, { providerID: "provider", id: "first" }),
        })
    },
  })
  setup.dialog.replace(() => <DialogCodex home={home.path} />)
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Codex import fixture") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("取り込んで開く"))
  expect(setup.captureCharFrame()).not.toContain("モデルを変更")
  await Bun.sleep(10)
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    return setup.route.data.type === "session"
  })
  expect(imported).toHaveLength(1)
  expect(imported[0].messages.map((message) => message.type)).toEqual(["user", "assistant", "system", "system"])
  expect(JSON.stringify(Schema.encodeSync(SessionTransfer.Data)(imported[0]))).toContain("clean")
  expect(JSON.stringify(Schema.encodeSync(SessionTransfer.Data)(imported[0]))).not.toContain("unfinished")
  const rollout = path.join(home.path, "legacy.jsonl")
  await Bun.write(
    rollout,
    [
      { type: "session_meta", payload: { id: "legacy" } },
      { type: "event_msg", payload: { type: "user_message", message: "Do not duplicate this" } },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Legacy question" }] },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Legacy answer" }],
        },
      },
      { type: "response_item", payload: { type: "function_call_output", output: "Legacy result" } },
    ]
      .map((entry) => JSON.stringify({ timestamp: "2026-10-13T00:00:00Z", ...entry }))
      .join("\n"),
  )
  const legacy = await codexTransfer(
    home.path,
    { ...(await codexList(home.path))[0], id: "legacy", rollout_path: rollout },
    {
      agent: imported[0].info.agent!,
      model: imported[0].info.model!,
    },
  )
  expect(legacy.messages.map((message) => message.type)).toEqual(["user", "assistant", "system"])
  expect(JSON.stringify(Schema.encodeSync(SessionTransfer.Data)(legacy))).not.toContain("Do not duplicate this")
  const after = await Promise.all(
    ["state_5.sqlite", "thread_history_1.sqlite"].map((file) => Bun.file(path.join(home.path, file)).arrayBuffer()),
  )
  expect(after.map((data) => new Uint8Array(data))).toEqual(before.map((data) => new Uint8Array(data)))
})
