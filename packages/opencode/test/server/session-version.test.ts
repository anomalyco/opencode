import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { $ } from "bun"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"

Log.init({ print: false })

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}

async function repo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "numeral-session-version-"))
  await $`git init --initial-branch=dev ${dir}`.env(env).quiet()
  await fs.writeFile(path.join(dir, "README.md"), "hello\n")
  await $`git add README.md`.cwd(dir).env(env).quiet()
  await $`git commit -m init`.cwd(dir).env(env).quiet()
  return dir
}

async function cleanup(directory: string) {
  await Instance.provide({
    directory,
    fn: async () => {
      await Instance.dispose()
    },
  }).catch(() => undefined)
  await fs.rm(directory, { recursive: true, force: true })
}

describe("session version routes", () => {
  test("creates a child version and returns the family", async () => {
    const directory = await repo()
    const app = Server.App()
    const headers = {
      "Content-Type": "application/json",
      "x-opencode-directory": directory,
    }

    try {
      const created = await app.fetch(new Request("http://localhost/session", { method: "POST", headers, body: "{}" }))
      const root = await created.json()

      await app.fetch(new Request(`http://localhost/session/${root.id}/select`, { method: "POST", headers }))

      const versioned = await app.fetch(
        new Request(`http://localhost/session/${root.id}/version`, { method: "POST", headers }),
      )
      const child = await versioned.json()

      expect(versioned.status).toBe(200)
      expect(child.parentID).toBe(root.id)
      expect(child.lineage?.number).toBe(2)
      expect(child.git?.branch).toContain(child.id)

      const vcsRes = await app.fetch(new Request("http://localhost/vcs", { headers }))
      const vcs = await vcsRes.json()
      expect(vcs.branch).toBe(child.git?.branch)

      const familyRes = await app.fetch(new Request(`http://localhost/session/${child.id}/family`, { headers }))
      const family = await familyRes.json()

      expect(familyRes.status).toBe(200)
      expect(family.map((item: { id: string }) => item.id)).toEqual([root.id, child.id])
      expect(family[0]?.lineage?.latestID).toBe(child.id)
    } finally {
      await cleanup(directory)
    }
  })

  test("saves the active version before switching", async () => {
    const directory = await repo()
    const app = Server.App()
    const headers = {
      "Content-Type": "application/json",
      "x-opencode-directory": directory,
    }

    try {
      const created = await app.fetch(new Request("http://localhost/session", { method: "POST", headers, body: "{}" }))
      const root = await created.json()

      await app.fetch(new Request(`http://localhost/session/${root.id}/select`, { method: "POST", headers }))

      const versioned = await app.fetch(
        new Request(`http://localhost/session/${root.id}/version`, { method: "POST", headers }),
      )
      const child = await versioned.json()

      await fs.writeFile(path.join(directory, "README.md"), "child\n")

      const selected = await app.fetch(
        new Request(`http://localhost/session/${root.id}/select`, { method: "POST", headers }),
      )
      expect(selected.status).toBe(200)

      const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(directory).env(env).text()).trim()
      const current = await fs.readFile(path.join(directory, "README.md"), "utf8")
      const saved = await $`git show ${`numeral/${child.id}`}:README.md`.cwd(directory).env(env).text()

      expect(branch).toBe("dev")
      expect(current).toBe("hello\n")
      expect(saved.trim()).toBe("child")
    } finally {
      await cleanup(directory)
    }
  })
})
