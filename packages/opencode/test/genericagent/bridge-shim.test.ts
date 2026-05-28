import { describe, expect, test } from "bun:test"
import path from "node:path"

const shimPath = path.resolve(import.meta.dir, "../../src/genericagent/python/bridge_shim.py")

async function runPython(script: string) {
  const proc = Bun.spawn(["python3", "-c", script], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  return stdout
}

describe("GenericAgent bridge shim", () => {
  test("adds a user turn when GenericAgent history only yields assistant messages", async () => {
    const stdout = await runPython(`
import importlib.util
import json
spec = importlib.util.spec_from_file_location("bridge_shim", ${JSON.stringify(shimPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
messages = module._ensure_user_turns(
  [{"role": "assistant", "content": "answer"}],
  "[SYSTEM] Current working directory: /repo/project\\n\\n这是什么项目？",
)
print(json.dumps(messages, ensure_ascii=False))
`)

    expect(JSON.parse(stdout)).toEqual([
      { role: "user", content: "这是什么项目？" },
      { role: "assistant", content: "answer" },
    ])
  })

  test("dedupes identical GenericAgent history logs while keeping newest order", async () => {
    const stdout = await runPython(`
import importlib.util
import json
import os
import tempfile
spec = importlib.util.spec_from_file_location("bridge_shim", ${JSON.stringify(shimPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as td:
  old = os.path.join(td, "model_responses_1.txt")
  new = os.path.join(td, "model_responses_2.txt")
  other = os.path.join(td, "model_responses_3.txt")
  open(old, "w", encoding="utf-8").write("same")
  open(new, "w", encoding="utf-8").write("same")
  open(other, "w", encoding="utf-8").write("other")
  rows = [(new, 3.0, "same", 1), (old, 2.0, "same", 1), (other, 1.0, "other", 1)]
  print(json.dumps([os.path.basename(row[0]) for row in module._dedupe_history_sessions(rows)]))
`)

    expect(JSON.parse(stdout)).toEqual(["model_responses_2.txt", "model_responses_3.txt"])
  })
})
