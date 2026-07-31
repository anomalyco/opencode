import { expect, test } from "bun:test"

test("README documents the local WebSocket gateway contract without credential values", async () => {
  const source = await Bun.file("README.md").text()

  expect(source).toContain("bun run start")
  expect(source).toContain("im.message.receive_v1")
  expect(source).toContain("单聊")
  expect(source).toContain("群聊")
  expect(source).toContain("@机器人")
  expect(source).toContain("发送消息")
  expect(source).toContain("WebSocket")
  expect(source).toContain("不需要公网回调")
  expect(source).toContain("DeepSeek")
  expect(source).toContain("FEISHU_DATA_DIRECTORY")
  expect(source).not.toContain("secret-canary")
  expect(source).not.toContain("cli_test")
})
