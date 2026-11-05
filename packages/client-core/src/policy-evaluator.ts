export * as PolicyEvaluator from "./policy-evaluator.js"

import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { ShellParse } from "@opencode/core/shell/parse"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { IntegrationID } from "@opencode/schema/integration-id"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Effect, Result, Schema } from "effect"

/**
 * One check, in OpenCode's permission vocabulary. `action` is a policy action such as `mcp.use` or `skill.use`,
 * decided per resource, or a tool permission such as `shell`, `edit`, `read`, `glob` or `external_directory`, matched
 * against `tool.use` statements as `<action>:<resource>`.
 */
export interface Input {
  readonly action: string
  readonly resources: readonly string[]
  /**
   * The harness's working directory, defaulting to this process's. Paths resolve against it, and anything outside it
   * and its repository needs `external_directory`.
   */
  readonly directory?: string
  /** Where a `shell` command runs, or where `glob` and `grep` search, when that isn't the working directory. */
  readonly path?: string
  /** The shell a `shell` command runs in, such as `zsh` or `pwsh`. Defaults to `$SHELL`. */
  readonly shell?: string
}

/**
 * The workspace a check runs for. `policies` is `undefined` while they are unknown, such as before the first fetch,
 * and `status` says why the sign-in needs the member, such as an expired SSO session.
 */
export interface Workspace {
  readonly organization?: string
  readonly policies: readonly ConfigPolicy.Info[] | undefined
  readonly status?: { readonly message: string; readonly url?: string }
}

export type Decision = { readonly effect: "allow" } | { readonly effect: "deny"; readonly message: string }

const allow: Decision = { effect: "allow" }

/**
 * Decides a check against a workspace's policy statements with OpenCode's semantics: statements apply in order, the
 * last match wins, nothing matching allows, and a denial names the workspace. Tool checks name files and directories
 * the way OpenCode's tools do, including the `external_directory` check for anything outside the project.
 *
 * A shell command the portable scanner cannot analyze is denied while any statement could deny a shell command or
 * directory, since its parts can't be checked; OpenCode refuses to run such a command at all. A signed-in workspace
 * whose policy hasn't loaded denies everything until it does.
 */
export const check = Effect.fn("PolicyEvaluator.check")(function* (workspace: Workspace, input: Input) {
  if (!workspace.policies) return pending(workspace)
  if (workspace.policies.length === 0) return allow
  const statements = ManagedPolicy.statements([
    ConfigIntegration.make({
      integrationID: IntegrationID.make("opencode"),
      connection: { type: "env", name: "OPENCODE_API_KEY" },
      organization: workspace.organization,
      info: { policies: workspace.policies },
    }),
  ])
  // `tool.use` resources carry the tool's raw input, which must be parsed before it can be checked.
  if (input.action === "tool.use")
    return { effect: "deny" as const, message: 'Check tool calls by tool name, such as "shell", not "tool.use"' }
  if (Schema.is(ConfigPolicy.Action)(input.action)) return decide(matching(statements, input.action, input.resources))

  const location = locate(input.directory ?? process.cwd())
  if (input.action === "shell") return yield* shell(statements, location, input)
  if (input.action === "read" || input.action === "edit") {
    const targets = input.resources.map((resource) =>
      target(location, resource, input.action === "edit" ? "file" : undefined),
    )
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
  if (input.action === "glob" || input.action === "grep") {
    const searched = target(location, input.path ?? ".", input.action === "glob" ? "directory" : undefined)
    return decide(
      ManagedPolicy.denying(statements, "external_directory", searched.external ? [searched.external] : []) ??
        ManagedPolicy.denying(statements, input.action, input.resources),
    )
  }
  // A skill needs both its `skill.use` statement and the `skill` tool permission, as in OpenCode.
  if (input.action === "skill")
    return decide(
      matching(statements, "skill.use", input.resources) ?? ManagedPolicy.denying(statements, "skill", input.resources),
    )
  return decide(ManagedPolicy.denying(statements, input.action, input.resources))
})

type Statement = ReturnType<typeof ManagedPolicy.statements>[number]
type Location = { readonly directory: string; readonly root?: string }

const shell = Effect.fnUntraced(function* (statements: Statement[], location: Location, input: Input) {
  const cwd = target(location, input.path ?? ".", "directory")
  const scanned = yield* Effect.forEach(input.resources, (command) =>
    ShellParse.scan(
      command,
      input.shell ?? process.env.SHELL ?? (process.platform === "win32" ? "powershell" : "sh"),
      cwd.absolute,
    ).pipe(Effect.result),
  )
  if (scanned.some(Result.isFailure))
    return decide(
      statements.find((policy, index) =>
        ["shell:", "external_directory:"].some((prefix) => activeDeny(statements, policy, index, prefix)),
      ),
    )
  const parsed = scanned.filter(Result.isSuccess).map((item) => item.success)
  const directories = parsed.flatMap((item) =>
    item.directories.map((entry) =>
      target(location, FSUtil.resolvePath(cwd.absolute, entry, Global.Path.home), "directory"),
    ),
  )
  return decide(
    ManagedPolicy.denying(
      statements,
      "external_directory",
      [cwd, ...directories].flatMap((item) => item.external ?? []),
    ) ??
      ManagedPolicy.denying(
        statements,
        "shell",
        parsed.flatMap((item) => item.commands.map((command) => command.resource)),
      ),
  )
})

function matching(statements: Statement[], action: ConfigPolicy.Action, resources: readonly string[]) {
  return resources
    .map((resource) => ManagedPolicy.match(statements, action, resource))
    .find((policy) => policy?.effect === "deny")
}

function decide(policy: { readonly effect: ConfigPolicy.Effect; readonly message: string } | undefined): Decision {
  return policy?.effect === "deny" ? { effect: "deny", message: policy.message } : allow
}

function pending(workspace: Workspace): Decision {
  if (workspace.status)
    return {
      effect: "deny",
      message: workspace.status.url ? `${workspace.status.message}: ${workspace.status.url}` : workspace.status.message,
    }
  return {
    effect: "deny",
    message: `Blocked until ${workspace.organization ?? "your organization"}'s policy loads from OpenCode Console`,
  }
}

/** The working directory and the repository around it, which OpenCode also treats as inside the project. */
function locate(directory: string): Location {
  const absolute = path.resolve(directory)
  // The same markers and walk as `Project.root`, without its runtime dependencies.
  for (let current = absolute; ; current = path.dirname(current)) {
    if ([".git", ".hg"].some((marker) => existsSync(path.join(current, marker))))
      return { directory: absolute, root: current }
    if (path.dirname(current) === current) return { directory: absolute }
  }
}

/**
 * How OpenCode's `FileAccess` names a path: relative to the working directory inside the project, absolute outside
 * it, where its directory (the path itself when it is one) also needs `external_directory`.
 */
function target(location: Location, input: string, kind: "file" | "directory" | undefined) {
  const absolute = FSUtil.resolvePath(location.directory, input, Global.Path.home)
  const root = location.root
  const internal =
    FSUtil.contains(location.directory, absolute) ||
    (root !== undefined && root !== path.parse(root).root && FSUtil.contains(root, absolute))
  if (internal) return { absolute, resource: slash(path.relative(location.directory, absolute) || ".") }
  const directory =
    (kind ?? (statSync(absolute, { throwIfNoEntry: false })?.isDirectory() ? "directory" : "file")) === "directory"
      ? absolute
      : path.dirname(absolute)
  return { absolute, resource: slash(absolute), external: slash(path.join(directory, "*")) }
}

/**
 * Whether the deny at `index` could match some resource starting with `prefix` and isn't lifted for all of them by a
 * later allow, as the Console writes an "only" rule: deny everything, then allow `shell:*`.
 */
function activeDeny(statements: Statement[], policy: Statement, index: number, prefix: string) {
  if (policy.action !== "tool.use" || policy.effect !== "deny" || !couldMatch(policy.resource, prefix)) return false
  return !statements
    .slice(index + 1)
    .some(
      (later) =>
        later.action === "tool.use" &&
        later.effect === "allow" &&
        (later.resource === "*" || fold(later.resource) === fold(`${prefix}*`)),
    )
}

/** Whether a resource pattern could match some resource starting with `prefix`. */
function couldMatch(pattern: string, prefix: string) {
  const literal = fold(pattern.split(/[*?]/, 1)[0])
  return fold(prefix).startsWith(literal) || literal.startsWith(fold(prefix))
}

// `Wildcard.match` ignores case on Windows.
function fold(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value
}

function slash(value: string) {
  return value.replaceAll("\\", "/")
}
