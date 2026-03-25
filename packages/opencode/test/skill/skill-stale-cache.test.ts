import { afterEach, test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

afterEach(async () => {
  await Instance.disposeAll()
})

test("skill content updates after invalidate + re-read", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "my-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: my-skill
description: Original description.
---

# My Skill - Version 1

Original content here.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // First load — should see "Version 1"
      const skillsBefore = await Skill.all()
      expect(skillsBefore.length).toBe(1)
      expect(skillsBefore[0].description).toBe("Original description.")
      expect(skillsBefore[0].content).toContain("Version 1")

      // Edit the skill file on disk
      const skillFile = path.join(tmp.path, ".opencode", "skill", "my-skill", "SKILL.md")
      await Bun.write(
        skillFile,
        `---
name: my-skill
description: Updated description.
---

# My Skill - Version 2

Updated content with test1 label.
`,
      )

      // Invalidate the cache (simulates what FileWatcher triggers)
      await Skill.invalidate()

      // Now skills should reflect the updated file
      const skillsAfter = await Skill.all()
      expect(skillsAfter.length).toBe(1)
      expect(skillsAfter[0].description).toBe("Updated description.")
      expect(skillsAfter[0].content).toContain("Version 2")
      expect(skillsAfter[0].content).toContain("test1 label")
    },
  })
})

test("Skill.get() returns fresh content after invalidate", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "cached-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: cached-skill
description: A cached skill.
---

# Cached Skill

Initial instructions.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Skill.get("cached-skill")
      expect(before).toBeDefined()
      expect(before!.content).toContain("Initial instructions")

      // Edit the file
      const skillFile = path.join(tmp.path, ".opencode", "skill", "cached-skill", "SKILL.md")
      await Bun.write(
        skillFile,
        `---
name: cached-skill
description: An updated cached skill.
---

# Cached Skill

Updated instructions with new workflow.
`,
      )

      // Invalidate and re-fetch
      await Skill.invalidate()

      const after = await Skill.get("cached-skill")
      expect(after).toBeDefined()
      expect(after!.content).toContain("Updated instructions")
      expect(after!.description).toBe("An updated cached skill.")
    },
  })
})

test("newly added skill is discovered after invalidate", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "existing-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: existing-skill
description: Already exists.
---

# Existing Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Skill.all()
      expect(before.length).toBe(1)

      // Add a new skill on disk
      const newSkillDir = path.join(tmp.path, ".opencode", "skill", "new-skill")
      await Bun.write(
        path.join(newSkillDir, "SKILL.md"),
        `---
name: new-skill
description: Brand new skill.
---

# New Skill
`,
      )

      // Invalidate and re-fetch
      await Skill.invalidate()

      const after = await Skill.all()
      expect(after.length).toBe(2)
      expect(after.find((s) => s.name === "existing-skill")).toBeDefined()
      expect(after.find((s) => s.name === "new-skill")).toBeDefined()
      expect(after.find((s) => s.name === "new-skill")!.description).toBe("Brand new skill.")
    },
  })
})

test("deleted skill is removed after invalidate", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "doomed-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: doomed-skill
description: Will be deleted.
---

# Doomed Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Skill.all()
      expect(before.length).toBe(1)
      expect(before[0].name).toBe("doomed-skill")

      // Delete the skill file
      const fs = await import("fs/promises")
      await fs.rm(path.join(tmp.path, ".opencode", "skill", "doomed-skill"), { recursive: true })

      // Invalidate and re-fetch
      await Skill.invalidate()

      const after = await Skill.all()
      expect(after.length).toBe(0)
    },
  })
})
