import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { ConfigAgent } from "../../src/config/agent"
import { Permission } from "../../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"

// The personas this repo ships to its own agents. These are tracked files, not
// symlinks: `.opencode/agent/*.md` used to point into a `.skein/agents/`
// directory, every link dangled from the day the repo was renamed, and the
// shape was wrong anyway — a `.skein/` directory is local per-repo state, not a
// shared library. Nothing here may link into one again.
const repoRoot = path.resolve(import.meta.dir, "../../../..")
const agentDir = path.join(repoRoot, ".opencode", "agent")

function evaluate(rules: PermissionV1.Ruleset, permission: string) {
  return Permission.evaluate(permission, "*", rules).action
}

const loaded = await ConfigAgent.load(path.join(repoRoot, ".opencode"))

describe("repo personas", () => {
  test("no agent definition is a symlink, and every one resolves", () => {
    const entries = fs.readdirSync(agentDir, { withFileTypes: true }).filter((e) => e.name.endsWith(".md"))
    expect(entries.length).toBeGreaterThan(0)
    const links = entries.filter((e) => e.isSymbolicLink()).map((e) => e.name)
    expect(links).toEqual([])
    for (const entry of entries) {
      expect(fs.existsSync(path.join(agentDir, entry.name))).toBe(true)
    }
  })

  test("the roles the queue's gates delegate to are present as subagents", () => {
    for (const name of ["coder", "tester", "reviewer", "researcher", "persona-auditor"]) {
      const agent = loaded[name]
      expect(agent, `${name} should be a shipped persona`).toBeDefined()
      expect(agent.mode).toBe("subagent")
      expect(agent.description?.length ?? 0).toBeGreaterThan(0)
      expect(agent.prompt?.length ?? 0).toBeGreaterThan(0)
    }
  })

  // A persona's permissions have to match what its prompt tells it to do. Both
  // failures below present as a bad model rather than a bad config, which is
  // why they are pinned rather than left to review.
  test("an agent that must not change what it judges is denied write and edit", () => {
    for (const name of ["reviewer", "persona-auditor", "researcher"]) {
      const rules = Permission.fromConfig(loaded[name].permission ?? {})
      expect(evaluate(rules, "write"), `${name} write`).toBe("deny")
      expect(evaluate(rules, "edit"), `${name} edit`).toBe("deny")
    }
  })

  test("an agent that must run the suite is allowed bash", () => {
    for (const name of ["tester", "coder"]) {
      const rules = Permission.fromConfig(loaded[name].permission ?? {})
      expect(evaluate(rules, "bash"), `${name} bash`).toBe("allow")
    }
  })

  // The skein templates these were adapted from are written for skein's own Go
  // codebase and its file-token pipeline. Dropped in unchanged they would send
  // an agent looking for Go sources and writing reviews into `.skein/`.
  test("no persona points at a foreign codebase", () => {
    for (const [name, agent] of Object.entries(loaded)) {
      // The auditor is exempt: naming these two exact antipatterns is its job.
      if (name === "persona-auditor") continue
      const prompt = agent.prompt ?? ""
      expect(prompt, `${name} should not reference Go sources`).not.toMatch(/\bGo files\b|\.go\b/)
      expect(prompt, `${name} should not write into .skein/`).not.toMatch(/write[^.\n]{0,40}\.skein\//i)
    }
  })
})

// `write: deny` and `edit: deny` do not stop an agent that can run `bash`, and
// this is not hypothetical: on two live runs the reviewer announced it could not
// write its review "due to file-writing restrictions" and then wrote it anyway,
// with `cat > .skein/review-reviewer.md << EOF`.
//
// A prefix allowlist does not fix that. `cat*` matches `cat > f`, and
// `git diff*` matches `git diff HEAD > f` — any permitted prefix plus a redirect
// is a write. There is no pattern set over shell strings that makes a shell
// read-only, so the personas that DECIDE things do not get one.
describe("gate personas have no shell to mutate through", () => {
  test("reviewer and persona-auditor are denied bash outright", () => {
    for (const name of ["reviewer", "persona-auditor"]) {
      const rules = Permission.fromConfig(loaded[name].permission ?? {})
      for (const command of ["git diff HEAD", "cat x > y", "echo hi > review.md", "rm -rf x"]) {
        expect(evaluate(rules, "bash"), `${name} bash`).toBe("deny")
        expect(Permission.evaluate("bash", command, rules).action, `${name}: ${command}`).toBe("deny")
      }
      expect(evaluate(rules, "write"), `${name} write`).toBe("deny")
      expect(evaluate(rules, "edit"), `${name} edit`).toBe("deny")
    }
  })

  // They still have to be able to READ, or the guarantee is worthless because
  // the review is worthless.
  test("they can still read the code they judge", () => {
    for (const name of ["reviewer", "persona-auditor"]) {
      const rules = Permission.fromConfig(loaded[name].permission ?? {})
      for (const permission of ["read", "grep", "glob"]) {
        expect(evaluate(rules, permission), `${name} ${permission}`).not.toBe("deny")
      }
    }
  })

  // researcher is advisory — it never decides whether work ships, so a shell is
  // worth more than the guarantee. It is deliberately not in the list above.
  test("researcher keeps its shell", () => {
    const rules = Permission.fromConfig(loaded["researcher"].permission ?? {})
    expect(evaluate(rules, "bash")).toBe("allow")
  })
})
