import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import os from "os"
import fs from "fs"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { SkillAdapter, parseSkillDirectory } from "../../src/extension/skills/adapter.js"

const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "global-test-"))
const testFsLayer = Layer.provideMerge(FSUtil.layer, NodeFileSystem.layer)
const testGlobalLayer = Global.layerWith({ config: tmpGlobal, home: path.join(tmpGlobal, "home") })
const fullLayer = Layer.merge(testFsLayer, testGlobalLayer)

describe("SkillAdapter", () => {
  it("parses skill directory with SKILL.md and preserves frontmatter and supporting files", () => {
    const files = ["SKILL.md", "scripts/run.py", "references/guide.md"]
    const contents: Record<string, string> = {
      "SKILL.md": "---\nname: Test Skill\ndescription: A test skill\nversion: 1.2.3\n---\n\nSkill content",
      "scripts/run.py": "print('running')",
      "references/guide.md": "# Guide",
    }

    const metadata = parseSkillDirectory("/fake/skill-demo", files, (f) => contents[f])

    expect(metadata.id).toBe("skill-demo")
    expect(metadata.name).toBe("Test Skill")
    expect(metadata.description).toBe("A test skill")
    expect(metadata.version).toBe("1.2.3")
    expect(metadata.supportingFiles).toEqual(["scripts/run.py", "references/guide.md"])
  })

  it("inspects a local skill directory and produces valid CIR", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-inspect-"))
    fs.writeFileSync(
      path.join(tmp, "SKILL.md"),
      "---\nname: Advanced Data Analyzer\ndescription: Performs deep data analysis\n---\n\n# Usage\nRun the scripts.",
    )
    fs.mkdirSync(path.join(tmp, "scripts"))
    fs.writeFileSync(path.join(tmp, "scripts", "analyze.py"), "# Python script")

    const cir = await Effect.runPromise(
      SkillAdapter.inspect(tmp).pipe(Effect.provide(fullLayer)),
    )

    expect(cir).toBeDefined()
    expect(cir?.name).toBe("Advanced Data Analyzer")
    expect(cir?.category).toBe("skill")
    expect(cir?.security?.safe).toBe(true)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("installs a skill into the target project scope and generates SKILL.md if absent", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "skill-src-"))
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "skill-proj-"))

    fs.writeFileSync(path.join(src, "README.md"), "# Custom Tool\nDoes things.")

    const result = await Effect.runPromise(
      SkillAdapter.install(
        {
          sourceUrlOrPath: src,
          targetScope: "project",
          overrideName: "custom-tool",
        },
        proj,
      ).pipe(Effect.provide(fullLayer)),
    )

    expect(result.success).toBe(true)
    const targetSkillMd = path.join(proj, ".opencode", "skills", "custom-tool", "SKILL.md")
    expect(fs.existsSync(targetSkillMd)).toBe(true)
    const content = fs.readFileSync(targetSkillMd, "utf8")
    expect(content).toContain("name: \"Custom Tool\"")

    fs.rmSync(src, { recursive: true, force: true })
    fs.rmSync(proj, { recursive: true, force: true })
  })
})
