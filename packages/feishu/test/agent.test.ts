import { expect, test } from "bun:test"

test("feishu-chat agent is hidden and denies every tool and permission", async () => {
  const source = await Bun.file("../../.opencode/agent/feishu-chat.md").text()
  const frontmatter = source.split("---")[1]

  expect(frontmatter).toContain("mode: primary")
  expect(frontmatter).toContain("hidden: true")
  expect(frontmatter).toContain('"*": false')
  expect(frontmatter).toContain('"*": deny')
  expect(source).toContain("纯文本")
  expect(source).toContain("文件、终端、数据库、Skill、MCP、网络工具和项目修改能力均不可用")
  expect(source).not.toContain("inventory_query")
})
