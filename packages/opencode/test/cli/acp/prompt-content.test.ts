import { describe, expect } from "bun:test"
import type { PromptResponse } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cliIt } from "../../lib/cli-process"
import { expectOk } from "./acp-test-client"
import { createAcpClient, initialize, newSession, verifierConfig } from "./helpers"

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

describe("opencode acp prompt content subprocess", () => {
  cliIt.live(
    "accepts embedded text resource image and file resource link prompt content",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writeFile(path.join(home, "README.md"), "# ACP content smoke\n"))
        const acp = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(promptContentConfig(llm.url)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)

        yield* llm.text("embedded resource accepted")
        expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
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

        yield* llm.text("image accepted")
        expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
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

        yield* llm.text("file link accepted")
        const linked = expectOk(
          yield* acp.request<PromptResponse>("session/prompt", {
            sessionId: session.sessionId,
            prompt: [
              { type: "text", text: "Use this linked file." },
              {
                type: "resource_link",
                uri: pathToFileURL(path.join(home, "README.md")).href,
                name: "README.md",
                mimeType: "text/markdown",
              },
            ],
          }),
        )

        expect(linked.stopReason).toBe("end_turn")
      }),
    60_000,
  )
})

function promptContentConfig(llmUrl: string) {
  const config = verifierConfig(llmUrl)
  return {
    ...config,
    provider: {
      test: {
        ...config.provider.test,
        models: Object.fromEntries(
          Object.entries(config.provider.test.models).map(([id, model]) => [
            id,
            {
              ...model,
              attachment: true,
              reasoning: true,
            },
          ]),
        ),
      },
    },
  }
}
