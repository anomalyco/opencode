import { expect, test } from "bun:test"
import path from "path"

test("node sidecar build injects the opencode version", async () => {
  const source = await Bun.file(path.join(import.meta.dir, "../../script/build-node.ts")).text()
  const defineBlock = source.match(/define:\s*{(?<body>[\s\S]*?)\n\s*},\n\s*files:/)?.groups?.body

  expect(defineBlock).toContain("OPENCODE_VERSION")
  expect(defineBlock).toContain("Script.version")
})
