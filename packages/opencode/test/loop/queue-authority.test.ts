// Adversarial review of the unattended queue loop's authority ceiling
// (loop-spec-queue task 4.2 / design D4).
//
// This is the review, executable: every bypass shape is run through the REAL
// pattern derivation the shell tool uses (`ShellTool.commandPatterns` — the
// same parse/commands/source primitives as `collect`) and the REAL deny
// ruleset applied to queue sessions, then evaluated by the REAL
// `Permission.evaluate`. A shape that reaches `allow`/`ask` here reaches it in
// production too.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Permission } from "@/permission"
import { commandPatterns } from "@/tool/shell"
import { QueueDenyRules, CredentialEnvKeys, deniesPush, withoutCredentials } from "@/loop/spec-queue/authority"

/** Derives the shell tool's patterns for a command, then asks: is it denied? */
async function denied(command: string): Promise<{ patterns: string[]; denied: boolean }> {
  const patterns = await Effect.runPromise(commandPatterns(command))
  const anyDenied = patterns.some((pattern) => Permission.evaluate("bash", pattern, QueueDenyRules).action === "deny")
  return { patterns, denied: anyDenied }
}

describe("queue authority boundary — bypass attempts", () => {
  // Each entry is an attempt to get a push (or equivalent egress) past the
  // ceiling. All MUST be denied.
  const attempts: Array<[label: string, command: string]> = [
    ["plain push", "git push origin main"],
    ["push with force", "git push --force origin dev"],
    ["compound with &&", "bun test && git push origin main"],
    ["compound with ;", "echo ok; git push"],
    ["compound with ||", "false || git push"],
    ["subshell", "(cd /tmp && git push origin main)"],
    ["command substitution", 'echo "$(git push origin main)"'],
    ["backtick substitution", "echo `git push`"],
    ["pipeline", "echo hi | git push"],
    ["env prefix", "GIT_TRACE=1 git push origin main"],
    ["flag interposition", "git -c http.extraheader=x push origin main"],
    ["absolute path to git", "/usr/bin/git push origin main"],
    ["config rewrite then push", "git config remote.origin.url x && git push"],
    ["credential helper install", "git config --global credential.helper store"],
    ["remote mutation", "git remote set-url origin git@github.com:x/y.git"],
    ["tagging", "git tag skein-v1.0.0"],
    ["gh release", "gh release create v1.0.0"],
    ["gh pr merge", "gh pr merge 123 --squash"],
    ["gh api as push", "gh api -X POST /repos/x/y/git/refs"],
    ["gh workflow dispatch", "gh workflow run skein-release.yml"],
    ["npm publish", "npm publish --access public"],
    ["bun publish", "bun publish"],
    ["deploy script", "./script/deploy.sh"],
    ["fleet deploy", "~/dev/llama-skein/scripts/fleet-deploy.sh"],
    ["publish.ts", "bun run packages/opencode/script/publish.ts"],
    ["remote execution via ssh", "ssh m5 'cd repo && git push'"],
    ["remote execution via ssh -o", "ssh -o StrictHostKeyChecking=no z4 git push"],
    ["scp a script out", "scp payload.sh m5:/tmp/"],
    ["rsync out", "rsync -a . m5:/tmp/repo"],
    ["systemctl on fleet", "systemctl --user restart llama-swap"],
    ["nohup wrapper", "nohup git push origin main &"],
    ["timeout wrapper", "timeout 60 git push"],
    ["env -i wrapper", "env -i git push"],
    ["xargs indirection", "echo origin | xargs git push"],
    ["find -exec", "find . -name x -exec git push \\;"],
  ]

  for (const [label, command] of attempts) {
    test(`denies: ${label}`, async () => {
      const result = await denied(command)
      expect(result.denied).toBe(true)
    })
  }

  // Documented residual gaps: shapes the PATTERN layer cannot catch, which is
  // exactly why the credential-less environment (4.3) is mandatory rather
  // than optional. These assertions pin the known weakness so a future change
  // that closes it fails loudly instead of silently drifting.
  const residual: Array<[label: string, command: string]> = [
    ["opaque wrapper script that pushes internally", "./tools/ship.sh"],
    ["heredoc-written script then executed", "bash /tmp/generated.sh"],
    ["make target that pushes", "make release"],
  ]

  for (const [label, command] of residual) {
    test(`RESIDUAL (pattern layer cannot see intent): ${label}`, async () => {
      const result = await denied(command)
      // Not denied by patterns — mitigated by withoutCredentials(), which
      // removes the tokens/agent the inner push would need.
      expect(result.denied).toBe(false)
    })
  }

  test("ordinary queue work is still permitted", async () => {
    for (const command of [
      "bun test",
      "bun run typecheck",
      "git status --porcelain",
      "git add -A",
      "git commit -m 'feat: work'",
      "git checkout -b loop/my-change",
      "git log -1 --name-only",
    ]) {
      const result = await denied(command)
      expect(result.denied).toBe(false)
    }
  })
})

describe("credential-less environment (defence in depth)", () => {
  test("deniesPush recognises the queue ruleset and not an ordinary one", () => {
    expect(deniesPush(QueueDenyRules)).toBe(true)
    expect(deniesPush([{ permission: "bash", pattern: "*", action: "allow" }])).toBe(false)
    expect(deniesPush(undefined)).toBe(false)
  })

  test("push credentials are stripped and git is forced to fail rather than prompt", () => {
    const env = withoutCredentials({
      GITHUB_TOKEN: "ghp_secret",
      GH_TOKEN: "gh_secret",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      NPM_TOKEN: "npm_secret",
      PATH: "/usr/bin",
    })
    for (const key of CredentialEnvKeys) {
      if (key === "GIT_ASKPASS") continue
      expect(env[key]).toBeUndefined()
    }
    expect(env["PATH"]).toBe("/usr/bin")
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0")
    expect(env["GIT_ASKPASS"]).toBe("/bin/false")
    expect(env["SSH_ASKPASS"]).toBe("/bin/false")
  })
})

describe("an unattended session is self-sufficient on permissions", () => {
  // A queue run has nobody at the keyboard. If the first tool that would have
  // prompted parks the run, "relentless" is a lie — so a session carrying the
  // deny ceiling auto-approves what that ceiling permits, regardless of the
  // user's global auto-mode toggle. The ceiling is the control, not the prompt.
  test("the deny ceiling is what marks a session unattended", () => {
    expect(deniesPush(QueueDenyRules)).toBe(true)
    // An ordinary session is never treated as unattended by accident.
    expect(deniesPush([])).toBe(false)
    expect(deniesPush([{ permission: "bash", pattern: "rm -rf *", action: "deny" }])).toBe(false)
    expect(deniesPush([{ permission: "bash", pattern: "*", action: "allow" }])).toBe(false)
  })

  test("auto-approval never extends to the denied commands themselves", async () => {
    for (const command of ["git push origin main", "gh release create v1", "ssh m5 git push"]) {
      const result = await denied(command)
      expect(result.denied).toBe(true)
    }
  })
})
