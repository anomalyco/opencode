import type { ConfigPolicy } from "@opencode/schema/config/policy"

// Shared by the policy plugin tests and by clients that evaluate an organization's policy outside OpenCode, such as
// `@opencode/client-core`, so both are held to the same decisions.

const tool = (effect: ConfigPolicy.Effect, resource: string): ConfigPolicy.Info => ({
  action: "tool.use",
  resource,
  effect,
})

/** Organization `tool.use` statements and the permission checks they decide. */
export const toolPolicyCases: ReadonlyArray<{
  readonly name: string
  readonly policies: ConfigPolicy.Info[]
  readonly checks: ReadonlyArray<readonly [action: string, resources: string[], effect: ConfigPolicy.Effect]>
}> = [
  {
    name: "the last matching statement decides",
    policies: [tool("deny", "shell:*"), tool("allow", "shell:git *"), tool("deny", "shell:git push *")],
    checks: [
      ["shell", ["git status"], "allow"],
      ["shell", ["git push origin main"], "deny"],
      ["shell", ["ls"], "deny"],
      ["edit", ["notes.md"], "allow"],
    ],
  },
  {
    name: "statements match action:resource, and a trailing ' *' also matches no arguments",
    policies: [tool("deny", "shell:git push *")],
    checks: [
      ["shell", ["git push"], "deny"],
      ["shell", ["git push origin main"], "deny"],
      // Compound commands check several resources; any denied resource denies the operation.
      ["shell", ["git status", "git push"], "deny"],
      ["shell", ["git status"], "allow"],
      ["edit", ["git push"], "allow"],
    ],
  },
  {
    name: "a later allow lifts an earlier broad deny",
    policies: [tool("deny", "shell:*"), tool("allow", "shell:git status *")],
    checks: [
      ["shell", ["git status --short"], "allow"],
      ["shell", ["rm -rf /"], "deny"],
    ],
  },
  {
    name: "a bare wildcard denies every permission",
    policies: [tool("deny", "*")],
    checks: [
      ["question", ["*"], "deny"],
      ["read", ["/tmp/notes.txt"], "deny"],
      ["github_delete_repository", ["*"], "deny"],
    ],
  },
  {
    name: "external directories match their directory glob",
    policies: [tool("deny", "external_directory:*"), tool("allow", "external_directory:/tmp/*")],
    checks: [
      ["external_directory", ["/tmp/*"], "allow"],
      ["external_directory", ["/etc/*"], "deny"],
      ["read", ["/etc/passwd"], "allow"],
    ],
  },
]
