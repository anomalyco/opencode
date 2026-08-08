import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { FmLearning } = await import("../../../../.opencode/learning/fm-learning-core.js")

let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fm-learning-test-"))
  process.env.FM_LEARNING_HOME = home
  FmLearning.ensureDirs()
})

afterEach(() => {
  delete process.env.FM_LEARNING_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("classifySession", () => {
  test("proposes a skill candidate when the session wrote files", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "add a formatter to the repo", synthetic: false }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "write" }, { type: "tool", tool: "edit" }],
      },
    ]
    const { skills, memory } = FmLearning.classifySession({ messages, session: { title: "Add formatter" } })
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("add-formatter")
    expect(memory.length).toBe(0)
  })

  test("proposes a memory candidate for a durable preference", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "I prefer bun over npm for installs", synthetic: false }],
      },
    ]
    const { skills, memory } = FmLearning.classifySession({ messages, session: { title: "Setup" } })
    expect(memory.length).toBe(1)
    expect(memory[0].fact).toContain("prefer bun")
    expect(skills.length).toBe(0)
  })

  test("proposes nothing for a trivial read-only session", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "what does this function do?", synthetic: false }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "it parses config" }],
      },
    ]
    const { skills, memory } = FmLearning.classifySession({ messages, session: { title: "Question" } })
    expect(skills.length).toBe(0)
    expect(memory.length).toBe(0)
  })

  test("ignores synthetic parts when classifying", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "The following tool was executed by the user", synthetic: true }],
      },
    ]
    const { skills, memory } = FmLearning.classifySession({ messages, session: { title: "X" } })
    expect(skills.length).toBe(0)
    expect(memory.length).toBe(0)
  })
})

describe("staging and promotion", () => {
  test("capture writes a candidate to staging, never to the live library", () => {
    const candidate = {
      name: "add-formatter",
      description: "Repeatable procedure captured from a session: Add formatter",
      body: "# Add formatter\n",
      source: "session-capture",
      capturedAt: Date.now(),
    }
    FmLearning.writeJson(join(FmLearning.stagingSkills(), "add-formatter.json"), candidate)

    expect(existsSync(join(FmLearning.stagingSkills(), "add-formatter.json"))).toBe(true)
    expect(existsSync(join(FmLearning.liveSkills(), "add-formatter", "SKILL.md"))).toBe(false)
    expect(FmLearning.listCandidates("skills").length).toBe(1)
  })

  test("promoteSkill writes SKILL.md with frontmatter and marks the candidate promoted", () => {
    const candidate = {
      name: "add-formatter",
      description: "Repeatable procedure captured from a session: Add formatter",
      body: "# Add formatter\n\nSteps here.\n",
      source: "session-capture",
      capturedAt: Date.now(),
    }
    FmLearning.writeJson(join(FmLearning.stagingSkills(), "add-formatter.json"), candidate)
    expect(FmLearning.promoteCandidate("skills", "add-formatter")).toBe(true)

    const skill = readFileSync(join(FmLearning.liveSkills(), "add-formatter", "SKILL.md"), "utf8")
    expect(skill).toContain("name: add-formatter")
    expect(skill).toContain("description: Repeatable procedure")
    expect(skill).toContain("Steps here.")
    expect(existsSync(join(FmLearning.stagingSkills(), "add-formatter.json"))).toBe(false)
    expect(existsSync(join(FmLearning.stagingSkills(), "add-formatter.json.promoted"))).toBe(true)
  })

  test("promoteMemory appends a deduped fact line", () => {
    const candidate = { name: "prefer-bun", fact: "I prefer bun over npm for installs", source: "session-capture", capturedAt: Date.now() }
    FmLearning.writeJson(join(FmLearning.stagingMemory(), "prefer-bun.json"), candidate)

    expect(FmLearning.promoteCandidate("memory", "prefer-bun")).toBe(true)
    const facts = readFileSync(FmLearning.liveMemory(), "utf8")
    expect(facts).toContain("- I prefer bun over npm for installs")

    FmLearning.promoteMemory({ fact: "I prefer bun over npm for installs" })
    const again = readFileSync(FmLearning.liveMemory(), "utf8")
    expect(again.split("\n").filter((l) => l.includes("prefer bun")).length).toBe(1)
  })

  test("rejectCandidate marks the candidate rejected", () => {
    FmLearning.writeJson(join(FmLearning.stagingSkills(), "junk.json"), { name: "junk", description: "x" })
    FmLearning.removeCandidate("skills", "junk")
    expect(existsSync(join(FmLearning.stagingSkills(), "junk.json.rejected"))).toBe(true)
    expect(FmLearning.listCandidates("skills").length).toBe(0)
  })
})

describe("description budget", () => {
  test("trims descriptions over 200 chars", () => {
    const long = "x".repeat(250)
    const trimmed = FmLearning.trimDescription(long)
    expect(trimmed.length).toBeLessThanOrEqual(200)
  })

  test("keeps short descriptions intact", () => {
    expect(FmLearning.trimDescription("short description")).toBe("short description")
  })
})

describe("slugify", () => {
  test("produces a safe directory name", () => {
    expect(FmLearning.slugify("Add Formatter! (v2)")).toBe("add-formatter-v2")
    expect(FmLearning.slugify("!!!")).toBe("candidate")
  })
})
