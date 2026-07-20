import type { PromptResponse } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createAcpFixture, expectOk, initialize, newSession } from "./subprocess"

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

describe("acp prompt content subprocess", () => {
  test("accepts embedded text resource image and file resource link prompt content", async () => {
    await using fixture = await createAcpFixture()
    await Bun.write(path.join(fixture.home, "README.md"), "# ACP content smoke\n")
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "Use this embedded resource." },
          {
            type: "resource",
            resource: { uri: "file:///context.txt", mimeType: "text/plain", text: "embedded context" },
          },
        ],
      }),
    )

    expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "Use this image." },
          {
            type: "image",
            mimeType: "image/png",
            data: tinyPng,
          },
        ],
      }),
    )

    const linked = expectOk(
      await acp.request<PromptResponse>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "Use this linked file." },
          {
            type: "resource_link",
            uri: pathToFileURL(path.join(fixture.home, "README.md")).href,
            name: "README.md",
            mimeType: "text/markdown",
          },
        ],
      }),
    )

    expect(linked.stopReason).toBe("end_turn")
    expect(fixture.llm.requests.length).toBeGreaterThanOrEqual(3)
  }, 60_000)
})
