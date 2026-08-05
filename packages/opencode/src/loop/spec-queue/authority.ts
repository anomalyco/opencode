// The authority ceiling for unattended queue runs (loop-spec-queue design D4):
// edit, test, verify, and commit locally — stop before anything that leaves
// this machine or mutates a shared artifact.
//
// Own module so the boundary can be reviewed and adversarially tested without
// standing up the loop service. Patterns are matched by `Permission.evaluate`
// against the shell tool's per-command-node patterns (see
// `ShellTool.commandPatterns`): tree-sitter decomposes compound commands, so
// each node is checked independently and `a && b` cannot smuggle `b` past a
// rule that matches it.
//
// Wildcard semantics (core/util/wildcard): the pattern is anchored ^...$ with
// `*` → `.*` and dotall. A leading AND trailing `*` is therefore required to
// match a command node that merely CONTAINS the dangerous invocation — which
// is what defeats env-prefix (`FOO=1 git push`), flag-interposition
// (`git -c k=v push`), and path-qualified (`/usr/bin/git push`) forms.
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

const deny = (pattern: string): PermissionV1.Rule => ({ permission: "bash", pattern, action: "deny" })

/**
 * Deny rules applied to a queue loop's sessions (parent and every iteration
 * child). Deliberately fail-closed: a false positive costs one denied command
 * in an unattended run, a false negative ships something.
 */
export const QueueDenyRules: PermissionV1.Ruleset = [
  // Publishing a ref. `*git*push*` also covers `git -c …  push`, an env
  // prefix, an absolute path to git, and `git push` inside a substitution.
  deny("*git*push*"),
  deny("*git*tag*"),
  // History rewrites of shared refs and remote mutation.
  deny("*git*remote*"),
  // Forge operations.
  deny("*gh*release*"),
  deny("*gh*pr*merge*"),
  deny("*gh*workflow*run*"),
  deny("*gh*api*"),
  // Package publication.
  deny("*npm*publish*"),
  deny("*bun*publish*"),
  deny("*pnpm*publish*"),
  deny("*yarn*publish*"),
  deny("*cargo*publish*"),
  // Deploy surfaces in this repo and the fleet.
  deny("*deploy*"),
  deny("*fleet-deploy*"),
  deny("*publish.ts*"),
  deny("*script/release*"),
  // Remote execution: the boundary is meaningless if the model can run the
  // denied command on another host instead.
  deny("*ssh*"),
  deny("*scp*"),
  deny("*rsync*"),
  deny("*pct*"),
  deny("*systemctl*"),
  deny("*launchctl*"),
  // Credential exfiltration/laundering that would re-enable a push.
  deny("*credential*"),
  // `git config` can rewrite a remote URL or install a credential helper,
  // both of which turn a later allowed command into a push.
  deny("*git*config*"),
]

/**
 * Environment keys removed from the shell tool's env for sessions that deny
 * pushing (defence in depth, design D4: "deny-list plus no credentials").
 * Even if a pattern gap let a push command through, it must not be able to
 * authenticate.
 */
export const CredentialEnvKeys: readonly string[] = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_API_TOKEN",
  "GIT_ASKPASS",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "CARGO_REGISTRY_TOKEN",
]

/**
 * True when a ruleset denies pushing — the signal that this session is an
 * unattended run whose shell must also be credential-less.
 */
export function deniesPush(ruleset: PermissionV1.Ruleset | undefined): boolean {
  if (!ruleset) return false
  return ruleset.some((rule) => rule.action === "deny" && rule.pattern.includes("push"))
}

/**
 * Strips push credentials and forces git to fail rather than prompt. Applied
 * on top of the inherited environment.
 */
export function withoutCredentials(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const next = { ...env }
  for (const key of CredentialEnvKeys) delete next[key]
  // No interactive prompt, no askpass helper: a push that somehow reaches the
  // network fails to authenticate instead of hanging an unattended run.
  next["GIT_TERMINAL_PROMPT"] = "0"
  next["GIT_ASKPASS"] = "/bin/false"
  next["SSH_ASKPASS"] = "/bin/false"
  return next
}

export * as QueueAuthority from "./authority"
