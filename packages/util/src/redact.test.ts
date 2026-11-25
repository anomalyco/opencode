import { describe, expect, test } from "bun:test"
import { isRedacted, markRedacted, REDACTED, redactSecrets } from "./redact.js"

const syntheticGithubOauth = "gho_FAKEFAKE0000111122223333444455556666"
const syntheticGithubPat = "github_pat_11AAAAAAA0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
const syntheticNpm = "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
const syntheticAnthropic = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
const syntheticOpenAi = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
const syntheticGoogle = "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345"
const syntheticAws = "AKIAIOSFODNN7EXAMPLE"
const syntheticSlack = "xoxb-1234567890-1234567890-FAKEFAKEFAKE"
const syntheticGitLab = "glpat-FAKEFAKEFAKEFAKEFAKE1234"
const syntheticPyPi = "pypi-AgEIcHlwaS5vcmcCJDFAKEFAKEFAKEFAKE"
const syntheticBearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKEPAYLOAD.FAKESIG=="

describe("redactSecrets", () => {
  test("redacts known token formats while preserving surrounding text", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      [`print this: ${syntheticNpm}`, `print this: ${REDACTED}`],
      [
        `export GH_TOKEN=${syntheticGithubOauth} && echo "$GH_TOKEN"`,
        `export GH_TOKEN=${REDACTED} && echo "$GH_TOKEN"`,
      ],
      [`token=${syntheticGithubPat}`, `token=${REDACTED}`],
      [`ghp_FAKEFAKE0000111122223333444455556666`, REDACTED],
      [`ghu_FAKEFAKE0000111122223333444455556666`, REDACTED],
      [`ghs_FAKEFAKE0000111122223333444455556666`, REDACTED],
      [`ghr_FAKEFAKE0000111122223333444455556666`, REDACTED],
      [`ANTHROPIC_API_KEY=${syntheticAnthropic}`, `ANTHROPIC_API_KEY=${REDACTED}`],
      [`OPENAI_API_KEY=${syntheticOpenAi}`, `OPENAI_API_KEY=${REDACTED}`],
      [`GOOGLE_API_KEY=${syntheticGoogle}`, `GOOGLE_API_KEY=${REDACTED}`],
      [`AWS_ACCESS_KEY_ID=${syntheticAws}`, `AWS_ACCESS_KEY_ID=${REDACTED}`],
      [`AWS_SESSION_KEY_ID=ASIAIOSFODNN7EXAMPLE`, `AWS_SESSION_KEY_ID=${REDACTED}`],
      [`SLACK_TOKEN=${syntheticSlack}`, `SLACK_TOKEN=${REDACTED}`],
      [`GITLAB_TOKEN=${syntheticGitLab}`, `GITLAB_TOKEN=${REDACTED}`],
      [`PYPI_TOKEN=${syntheticPyPi}`, `PYPI_TOKEN=${REDACTED}`],
      [`Authorization: Bearer ${syntheticBearer}`, `Authorization: Bearer ${REDACTED}`],
      [`Authorization: bearer ${syntheticBearer}`, `Authorization: bearer ${REDACTED}`],
      [`Authorization: BEARER ${syntheticBearer}`, `Authorization: BEARER ${REDACTED}`],
    ]
    for (const [input, expected] of cases) {
      expect(redactSecrets(input)).toBe(expected)
    }
  })

  test("redacts URL userinfo while keeping scheme, host, and path intact", () => {
    expect(
      redactSecrets(`git remote set-url origin https://user:${syntheticGithubOauth}@github.com/org/repo.git`),
    ).toBe(`git remote set-url origin https://${REDACTED}@github.com/org/repo.git`)
    expect(redactSecrets("http://admin:supersecret@127.0.0.1:8080/api?page=1")).toBe(
      `http://${REDACTED}@127.0.0.1:8080/api?page=1`,
    )
    expect(redactSecrets("redis://:cachepass@redis.internal:6379/0")).toBe(`redis://${REDACTED}@redis.internal:6379/0`)
    expect(redactSecrets(`https://${syntheticGithubOauth}@github.com/org/repo.git`)).toBe(
      `https://${REDACTED}@github.com/org/repo.git`,
    )
  })

  test("redacts PEM private key blocks and truncated headers", () => {
    const block = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEFAKEKEYDATA\n-----END RSA PRIVATE KEY-----\nafter"
    expect(redactSecrets(block)).toBe(`before\n${REDACTED}\nafter`)
    expect(redactSecrets("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(REDACTED)
  })

  test("leaves clean text, URLs without userinfo, and identifiers untouched", () => {
    const clean = [
      "explain how packages/cli/src/index.ts works",
      "https://github.com/anomalyco/opencode.git",
      "http://127.0.0.1:4096/api/v1/sessions",
      "https://registry.npmjs.org/@opencode/cli",
      "ssh://git@github.com/anomalyco/opencode.git",
      "user@example.com",
      "ses_01ABCDEFGHJKMNPQRSTVWXYZ01 msg_01ABCDEFGHJKMNPQRSTVWXYZ01",
      "Bearer token",
      "my-sk-not-a-secret-identifier-long-enough",
    ]
    for (const input of clean) {
      expect(redactSecrets(input)).toBe(input)
    }
  })
})

describe("markRedacted", () => {
  test("marks objects and arrays in place without affecting unmarked values", () => {
    const args = ["run", REDACTED]
    expect(markRedacted(args)).toBe(args)
    expect(isRedacted(args)).toBe(true)
    expect(isRedacted(["run", REDACTED])).toBe(false)
    expect(isRedacted("run")).toBe(false)
    expect(isRedacted(null)).toBe(false)
  })
})
