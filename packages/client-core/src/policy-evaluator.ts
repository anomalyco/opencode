export * as PolicyEvaluator from "./policy-evaluator.js"

import path from "node:path"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { ShellParse } from "@opencode/core/shell/parse"
import { IntegrationID } from "@opencode/schema/integration-id"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Effect, Result, Schema } from "effect"

/**
 * One check, in OpenCode's permission vocabulary. `action` is a policy action such as `mcp.use` or `skill.use`,
 * decided per resource, or a tool permission such as `shell`, `edit`, `read` or `external_directory`, matched
 * against `tool.use` statements as `<action>:<resource>`.
 */
export interface Input {
  readonly action: string
  readonly resources: readonly string[]
  /** The working directory. File and shell checks resolve paths against it and treat anything outside it as external. */
  readonly directory?: string
  /** The shell a `shell` command runs in, such as `bash` or `pwsh`. */
  readonly shell?: string
}

export type Decision = { readonly effect: "allow" } | { readonly effect: "deny"; readonly message: string }

const allow: Decision = { effect: "allow" }
// Tool checks whose resources are file paths, as OpenCode's file tools report them.
const FILE_ACTIONS = new Set(["read", "edit"])

/**
 * Decides a check against a workspace's policy statements with OpenCode's semantics: statements apply in order, the
 * last match wins, nothing matching allows, and a denial names the workspace.
 *
 * A shell command the portable scanner cannot analyze is denied while any statement could deny a shell command,
 * since its parts can't be checked; OpenCode refuses to run such a command at all.
 */
export const check = Effect.fn("PolicyEvaluator.check")(function* (
  workspace: { readonly organization?: string; readonly policies: readonly ConfigPolicy.Info[] },
  input: Input,
) {
  if (workspace.policies.length === 0) return allow
  const statements = ManagedPolicy.statements([
    ConfigIntegration.make({
      integrationID: IntegrationID.make("opencode"),
      connection: { type: "env", name: "OPENCODE_API_KEY" },
      organization: workspace.organization,
      info: { policies: workspace.policies },
    }),
  ])
  if (Schema.is(ConfigPolicy.Action)(input.action)) {
    const action = input.action
    return decide(
      input.resources
        .map((resource) => ManagedPolicy.match(statements, action, resource))
        .find((policy) => policy?.effect === "deny"),
    )
  }
  if (input.action === "shell") return yield* shell(statements, input)
  const directory = input.directory
  if (directory && FILE_ACTIONS.has(input.action)) {
    const targets = input.resources.map((resource) => target(directory, resource))
    return decide(
      ManagedPolicy.denying(
        statements,
        "external_directory",
        targets.flatMap((item) => item.external ?? []),
      ) ??
        ManagedPolicy.denying(
          statements,
          input.action,
          targets.map((item) => item.resource),
        ),
    )
  }
  return decide(ManagedPolicy.denying(statements, input.action, input.resources))
})

type Statement = ReturnType<typeof ManagedPolicy.statements>[number]

const shell = Effect.fnUntraced(function* (statements: Statement[], input: Input) {
  const directory = input.directory ?? process.cwd()
  const scanned = yield* Effect.forEach(input.resources, (command) =>
    ShellParse.scan(command, input.shell ?? "bash", directory).pipe(Effect.result),
  )
  if (scanned.some(Result.isFailure))
    return decide(
      statements.find((policy) => policy.action === "tool.use" && policy.effect === "deny" && couldMatchShell(policy)),
    )
  const parsed = scanned.filter(Result.isSuccess).map((item) => item.success)
  const external = input.directory
    ? parsed.flatMap((item) => item.directories.flatMap((entry) => target(directory, entry, true).external ?? []))
    : []
  return decide(
    ManagedPolicy.denying(statements, "external_directory", external) ??
      ManagedPolicy.denying(
        statements,
        "shell",
        parsed.flatMap((item) => item.commands.map((command) => command.resource)),
      ),
  )
})

function decide(policy: { readonly effect: ConfigPolicy.Effect; readonly message: string } | undefined): Decision {
  return policy?.effect === "deny" ? { effect: "deny", message: policy.message } : allow
}

/**
 * How OpenCode's file access names a path: relative to the working directory inside it, absolute outside it, where
 * the containing directory also needs `external_directory` approval.
 */
function target(directory: string, input: string, isDirectory = false) {
  const absolute = path.resolve(directory, input)
  const relative = path.relative(directory, absolute)
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return { resource: slash(relative || ".") }
  return {
    resource: slash(absolute),
    external: slash(path.join(isDirectory ? absolute : path.dirname(absolute), "*")),
  }
}

/** Whether a statement's resource pattern could match some `shell:` resource. */
function couldMatchShell(policy: Statement) {
  const literal = policy.resource.split(/[*?]/, 1)[0]
  return "shell:".startsWith(literal) || literal.startsWith("shell:")
}

function slash(value: string) {
  return value.replaceAll("\\", "/")
}
