import { expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Glob } from "../src/glob.js"

for (const sync of [false, true]) {
  test(`${sync ? "sync" : "async"} scans ignore dependency trees without hiding other dot directories`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-glob-"))
    try {
      const kept = ["SKILL.md", "manual.md", "kept/SKILL.md", "kept/nested/SKILL.md", ".custom/SKILL.md"]
      const excluded = ["node_modules", ".git", "dist", ".cache"].flatMap((name) => [
        `${name}/SKILL.md`,
        `kept/${name}/pkg/SKILL.md`,
      ])
      for (const file of [...kept, ...excluded]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), "# skill")
      }
      const options = {
        cwd: root,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.cache/**"],
      }
      const files = sync ? Glob.scanSync("{*.md,**/SKILL.md}", options) : await Glob.scan("{*.md,**/SKILL.md}", options)
      expect(files.toSorted()).toEqual(kept.toSorted())
      expect(Glob.scanSync("{*.md,**/SKILL.md}", { cwd: root, dot: true })).toHaveLength(kept.length + excluded.length)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
