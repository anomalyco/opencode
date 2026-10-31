import { expect, test } from "bun:test"
import { join } from "node:path"

const fixtures = join(import.meta.dir, "fixtures/optional-peers")

test("token auth works without the optional AWS and Google auth peers", async () => {
  const child = Bun.spawn([process.execPath, "--preload", join(fixtures, "hide.ts"), join(fixtures, "run.ts")], {
    env: { ...process.env, AWS_BEARER_TOKEN_BEDROCK: undefined, GOOGLE_VERTEX_API_KEY: undefined },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect({ exitCode, stderr: stderr.trim().split("\n") }).toEqual({
    exitCode: 0,
    stderr: [
      "step bedrock bearer",
      "step vertex access token",
      "step bedrock default chain",
      "loaded @aws-sdk/credential-providers",
      "step vertex adc",
      "loaded google-auth-library",
    ],
  })
  const stopped = { tag: "AI.Error", reason: "InvalidRequest", message: "stopped after auth" }
  expect(JSON.parse(stdout)).toEqual({
    errors: {
      bedrockBearer: stopped,
      vertexAccessToken: stopped,
      bedrockDefaultChain: {
        tag: "AI.Error",
        reason: "Authentication",
        message:
          "Bedrock SigV4 signing with the AWS default credential chain needs @aws-sdk/credential-providers; install it, or pass an apiKey (bearer token) or explicit credentials",
      },
      vertexADC: {
        tag: "AI.Error",
        reason: "Authentication",
        message:
          "Google Vertex Application Default Credentials need google-auth-library; install it, or pass an accessToken or apiKey",
      },
    },
    authorization: ["Bearer bedrock-token", "Bearer vertex-token"],
  })
})
