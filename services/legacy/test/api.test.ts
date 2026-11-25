import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair } from "jose"
import api from "../src/api"

const oidc = await generateKeyPair("RS256")
const app = await generateKeyPair("RS256", { extractable: true })
const jwk = { ...(await exportJWK(oidc.publicKey)), kid: "test", alg: "RS256", use: "sig" }
const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: await exportPKCS8(app.privateKey) }

const token = () =>
  new SignJWT({ repository: "octocat/my-repo", repository_id: "456789" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://token.actions.githubusercontent.com")
    .setAudience("opencode-github-action")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(oidc.privateKey)

const mockGitHub = (installation: Response) => {
  const original = globalThis.fetch
  spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new Request(input).url
    if (url === "https://token.actions.githubusercontent.com/.well-known/jwks")
      return Promise.resolve(Response.json({ keys: [jwk] }))
    if (url === "https://api.github.com/repos/octocat/my-repo/installation") return Promise.resolve(installation)
    return original(input, init)
  }) as typeof fetch)
}

const exchange = async () =>
  api.request(
    "https://api.opencode.ai/exchange_github_app_token",
    { method: "POST", headers: { Authorization: `Bearer ${await token()}` } },
    env,
  )

describe("exchange_github_app_token", () => {
  afterEach(() => {
    ;(globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore()
  })

  test("returns 404 with install instructions when the app is not installed", async () => {
    mockGitHub(Response.json({ message: "Not Found" }, { status: 404 }))
    const response = await exchange()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error:
        "The OpenCode GitHub App is not installed on octocat/my-repo. Install it at https://github.com/apps/opencode-agent",
    })
  })

  test("returns 502 when GitHub fails", async () => {
    mockGitHub(Response.json({ message: "Server Error" }, { status: 500 }))
    const response = await exchange()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "Failed to exchange GitHub App token for octocat/my-repo" })
  })
})
