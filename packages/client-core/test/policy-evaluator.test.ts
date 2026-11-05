import { describe, expect } from "bun:test"
import type { ConfigPolicy } from "@opencode/schema/config/policy"
import { Effect } from "effect"
import { PolicyEvaluator } from "@opencode/client-core/policy-evaluator"
import { mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { withEnv } from "../../core/test/fixture/env"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { toolPolicyCases } from "../../core/test/fixture/policy-cases"
import { compatibilityCases, malformedCases } from "../../core/test/fixture/shell-parse-cases"

const acme = (...policies: ConfigPolicy.Info[]) => ({ organization: "Acme", policies })
const deny = (action: ConfigPolicy.Action, resource: string): ConfigPolicy.Info => ({
  action,
  resource,
  effect: "deny",
})
const allow = (action: ConfigPolicy.Action, resource: string): ConfigPolicy.Info => ({
  action,
  resource,
  effect: "allow",
})
const blocked = { effect: "deny" as const, message: "Blocked by Acme's policy" }

describe("PolicyEvaluator.check", () => {
  // The same cases run through OpenCode's own policy plugin in packages/core/test/config/policy.test.ts.
  for (const item of toolPolicyCases)
    it.effect(`decides tool.use like OpenCode: ${item.name}`, () =>
      Effect.gen(function* () {
        for (const [action, resources, effect] of item.checks)
          expect(
            yield* PolicyEvaluator.check(acme(...item.policies), { action, resources }),
            `${action}: ${resources.join(", ")}`,
          ).toEqual(effect === "deny" ? blocked : { effect })
      }),
    )

  it.effect("names the organization only when the sign-in knows it", () =>
    Effect.gen(function* () {
      expect(
        yield* PolicyEvaluator.check(
          { policies: [deny("tool.use", "shell:*")] },
          { action: "shell", resources: ["ls"] },
        ),
      ).toEqual({ effect: "deny", message: "Blocked by your organization's policy" })
    }),
  )

  it.effect("denies everything while a signed-in workspace's policy is unknown", () =>
    Effect.gen(function* () {
      const check = { action: "read", resources: ["notes.md"] }
      expect(yield* PolicyEvaluator.check({ organization: "Acme", policies: undefined }, check)).toEqual({
        effect: "deny",
        message: "Blocked until Acme's policy loads from OpenCode Console",
      })
      expect(
        yield* PolicyEvaluator.check(
          {
            organization: "Acme",
            policies: undefined,
            status: { message: "Sign in with SSO again to use Acme", url: "https://console.test/sso" },
          },
          check,
        ),
      ).toEqual({ effect: "deny", message: "Sign in with SSO again to use Acme: https://console.test/sso" })
    }),
  )

  it.effect("decides policy actions per resource with the last match", () =>
    Effect.gen(function* () {
      const workspace = acme(
        deny("websearch.use", "*"),
        allow("websearch.use", "exa"),
        deny("mcp.use", "github"),
        deny("skill.use", "deploy*"),
      )
      const check = (action: string, resources: string[]) => PolicyEvaluator.check(workspace, { action, resources })
      expect(yield* check("websearch.use", ["exa"])).toEqual({ effect: "allow" })
      expect(yield* check("websearch.use", ["opencode"])).toEqual(blocked)
      expect(yield* check("mcp.use", ["linear"])).toEqual({ effect: "allow" })
      expect(yield* check("mcp.use", ["linear", "github"])).toEqual(blocked)
      expect(yield* check("skill.use", ["deploy-prod"])).toEqual(blocked)
      // A tool named like a policy action is still only a tool.use check.
      expect(yield* check("mcp", ["github"])).toEqual({ effect: "allow" })
    }),
  )

  describe("shell commands", () => {
    // ShellParse's own vectors: every resource it extracts is checked, so denying any one of them denies the command.
    const cases = compatibilityCases.filter(
      ([, , env, expected]) => !Object.keys(env).length && expected.commands.length,
    )
    it.effect("checks every command ShellParse extracts", () =>
      Effect.gen(function* () {
        expect(cases.length).toBeGreaterThan(20)
        for (const [shell, command, , expected] of cases) {
          for (const item of expected.commands)
            expect(
              yield* PolicyEvaluator.check(acme(deny("tool.use", `shell:${item.resource}`)), {
                action: "shell",
                resources: [command],
                shell,
              }),
              `${shell}: ${command} -> ${item.resource}`,
            ).toEqual(blocked)
          expect(
            yield* PolicyEvaluator.check(acme(deny("tool.use", "shell:opencode-unmatched *")), {
              action: "shell",
              resources: [command],
              shell,
            }),
            `${shell}: ${command}`,
          ).toEqual({ effect: "allow" })
        }
      }),
    )

    it.effect("blocks a compound command when one part is denied", () =>
      Effect.gen(function* () {
        const workspace = acme(deny("tool.use", "shell:rm *"))
        expect(
          yield* PolicyEvaluator.check(workspace, { action: "shell", resources: ["echo ok && rm -rf ./probe"] }),
        ).toEqual(blocked)
        expect(
          yield* PolicyEvaluator.check(workspace, { action: "shell", resources: ["echo $(rm -rf ./probe)"] }),
        ).toEqual(blocked)
        expect(yield* PolicyEvaluator.check(workspace, { action: "shell", resources: ["echo rm -rf"] })).toEqual({
          effect: "allow",
        })
      }),
    )

    it.effect("fails closed on commands the scanner cannot analyze while a shell rule could apply", () =>
      Effect.gen(function* () {
        for (const [shell, command] of malformedCases) {
          const check = (...policies: ConfigPolicy.Info[]) =>
            PolicyEvaluator.check(acme(...policies), { action: "shell", resources: [command], shell })
          expect(yield* check(deny("tool.use", "shell:rm *")), command).toEqual(blocked)
          expect(yield* check(deny("tool.use", "*")), command).toEqual(blocked)
          // The command might change into a directory the policy keeps it out of.
          expect(yield* check(deny("tool.use", "external_directory:/etc/*")), command).toEqual(blocked)
          // No statement could deny a shell command, so there is nothing to enforce.
          expect(yield* check(deny("tool.use", "edit:*.env"), deny("mcp.use", "*")), command).toEqual({
            effect: "allow",
          })
          expect(yield* check(), command).toEqual({ effect: "allow" })
        }
      }),
    )

    it.effect("checks directories a command changes into outside the working directory", () =>
      Effect.gen(function* () {
        const check = (command: string) =>
          PolicyEvaluator.check(
            acme(deny("tool.use", "external_directory:*"), allow("tool.use", "external_directory:/tmp/*")),
            {
              action: "shell",
              resources: [command],
              directory: "/repo",
            },
          )
        expect(yield* check("cd /etc && cat passwd")).toEqual(blocked)
        expect(yield* check("cd ../other && ls")).toEqual(blocked)
        expect(yield* check("cd /tmp && ls")).toEqual({ effect: "allow" })
        expect(yield* check("cd src && ls")).toEqual({ effect: "allow" })
      }),
    )
  })

  describe("file paths", () => {
    it.effect("names files inside the working directory relative to it", () =>
      Effect.gen(function* () {
        const workspace = acme(deny("tool.use", "edit:*.env"), deny("tool.use", "read:secrets/*"))
        const check = (action: string, resource: string) =>
          PolicyEvaluator.check(workspace, { action, resources: [resource], directory: "/repo" })
        expect(yield* check("edit", "/repo/.env")).toEqual(blocked)
        expect(yield* check("edit", "config/prod.env")).toEqual(blocked)
        expect(yield* check("read", "/repo/secrets/key.pem")).toEqual(blocked)
        expect(yield* check("read", "/repo/src/secrets/key.pem")).toEqual({ effect: "allow" })
        expect(yield* check("edit", "/repo/src/index.ts")).toEqual({ effect: "allow" })
      }),
    )

    it.effect("checks the containing directory of files outside the working directory", () =>
      Effect.gen(function* () {
        const workspace = acme(deny("tool.use", "external_directory:/etc/*"))
        const check = (resource: string) =>
          PolicyEvaluator.check(workspace, { action: "read", resources: [resource], directory: "/repo" })
        expect(yield* check("/etc/hosts")).toEqual(blocked)
        expect(yield* check("../outside/notes.md")).toEqual({ effect: "allow" })
        expect(yield* check("/repo/notes.md")).toEqual({ effect: "allow" })
        // Without a working directory, this process's stands in.
        expect(yield* PolicyEvaluator.check(workspace, { action: "read", resources: ["/etc/hosts"] })).toEqual(blocked)
        expect(yield* PolicyEvaluator.check(workspace, { action: "shell", resources: ["cd /etc && ls"] })).toEqual(
          blocked,
        )
      }),
    )
  })

  describe("parity with OpenCode's file access", () => {
    it.effect("expands ~ to the home directory", () =>
      withEnv({ OPENCODE_TEST_HOME: "/home/ada" }, () =>
        Effect.gen(function* () {
          const workspace = acme(deny("tool.use", "external_directory:/home/ada/.ssh/*"))
          expect(
            yield* PolicyEvaluator.check(workspace, {
              action: "read",
              resources: ["~/.ssh/id_rsa"],
              directory: "/repo",
            }),
          ).toEqual(blocked)
          // ShellParse expands a command's ~ itself, from the OS home directory, as it does in OpenCode.
          expect(
            yield* PolicyEvaluator.check(acme(deny("tool.use", `external_directory:${os.homedir()}/.ssh/*`)), {
              action: "shell",
              resources: ["cd ~/.ssh && ls"],
              directory: "/repo",
            }),
          ).toEqual(blocked)
        }),
      ),
    )

    it.effect("keeps a file whose name starts with two dots inside the project", () =>
      Effect.gen(function* () {
        expect(
          yield* PolicyEvaluator.check(acme(deny("tool.use", "edit:..env")), {
            action: "edit",
            resources: ["/repo/..env"],
            directory: "/repo",
          }),
        ).toEqual(blocked)
      }),
    )

    it.effect("checks a directory read outside the project as that directory", () =>
      Effect.gen(function* () {
        const outside = (yield* tmpdirScoped("opencode-connect-outside-")).path
        const read = (...policies: ConfigPolicy.Info[]) =>
          PolicyEvaluator.check(acme(...policies), { action: "read", resources: [outside], directory: "/repo" })
        expect(yield* read(deny("tool.use", `external_directory:${outside}/*`))).toEqual(blocked)
        expect(
          yield* read(deny("tool.use", "external_directory:*"), allow("tool.use", `external_directory:${outside}/*`)),
        ).toEqual({ effect: "allow" })
      }),
    )

    it.effect("treats the whole repository as inside the project when run from a subdirectory", () =>
      Effect.gen(function* () {
        const repo = (yield* tmpdirScoped("opencode-connect-repo-")).path
        mkdirSync(path.join(repo, ".git"))
        mkdirSync(path.join(repo, "packages", "web"), { recursive: true })
        const directory = path.join(repo, "packages", "web")
        const check = (policy: ConfigPolicy.Info, action: string, resource: string) =>
          PolicyEvaluator.check(acme(policy), { action, resources: [resource], directory })
        expect(yield* check(deny("tool.use", "external_directory:*"), "read", "../../README.md")).toEqual({
          effect: "allow",
        })
        expect(yield* check(deny("tool.use", "external_directory:*"), "shell", "cd .. && ls")).toEqual({
          effect: "allow",
        })
        expect(yield* check(deny("tool.use", "read:../../README.md"), "read", path.join(repo, "README.md"))).toEqual(
          blocked,
        )
      }),
    )

    it.effect("checks where a command runs and where a search looks", () =>
      Effect.gen(function* () {
        const outside = (yield* tmpdirScoped("opencode-connect-outside-")).path
        const workspace = acme(deny("tool.use", `external_directory:${outside}/*`))
        const check = (action: string, resources: string[], at: string) =>
          PolicyEvaluator.check(workspace, { action, resources, directory: "/repo", path: at })
        expect(yield* check("shell", ["ls"], outside)).toEqual(blocked)
        expect(yield* check("glob", ["*.ts"], outside)).toEqual(blocked)
        expect(yield* check("grep", ["secret"], outside)).toEqual(blocked)
        expect(yield* check("glob", ["*.ts"], "/repo/src")).toEqual({ effect: "allow" })
      }),
    )
  })

  it.effect("refuses a raw tool.use check, whose input it can't parse", () =>
    Effect.gen(function* () {
      expect(
        (yield* PolicyEvaluator.check(acme(deny("tool.use", "shell:rm *")), {
          action: "tool.use",
          resources: ["shell:echo ok && rm -rf /"],
        })).effect,
      ).toBe("deny")
    }),
  )

  it.effect("checks a skill against both skill.use and the skill tool", () =>
    Effect.gen(function* () {
      const check = (policy: ConfigPolicy.Info) =>
        PolicyEvaluator.check(acme(policy), { action: "skill", resources: ["deploy"] })
      expect(yield* check(deny("skill.use", "deploy"))).toEqual(blocked)
      expect(yield* check(deny("tool.use", "skill:deploy"))).toEqual(blocked)
      expect(yield* check(deny("skill.use", "release"))).toEqual({ effect: "allow" })
    }),
  )

  it.effect("scans with the user's shell, so zsh-only expansion is caught", () =>
    withEnv({ SHELL: "/bin/zsh" }, () =>
      Effect.gen(function* () {
        expect(
          yield* PolicyEvaluator.check(acme(deny("tool.use", "shell:rm *")), {
            action: "shell",
            resources: ["echo ${(e):-\\$(rm -rf ./probe)}"],
          }),
        ).toEqual(blocked)
      }),
    ),
  )

  it.effect("runs a command it can't analyze when later allows lift every shell rule", () =>
    Effect.gen(function* () {
      const workspace = acme(
        deny("tool.use", "*"),
        allow("tool.use", "shell:*"),
        allow("tool.use", "external_directory:*"),
      )
      expect(yield* PolicyEvaluator.check(workspace, { action: "shell", resources: ['echo "unterminated'] })).toEqual({
        effect: "allow",
      })
      expect(yield* PolicyEvaluator.check(workspace, { action: "webfetch", resources: ["https://x.test"] })).toEqual(
        blocked,
      )
    }),
  )
})
