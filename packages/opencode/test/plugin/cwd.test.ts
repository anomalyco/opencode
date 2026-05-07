import { afterEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { getCwd, setCwd, resetCwd, CwdEvent } from "../../plugin/shell-mode/cwd"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  resetCwd()
  await Instance.disposeAll()
})

// setCwd needs Instance context because it publishes a Bus event.
// All tests use withInstance to satisfy that requirement.
async function withInstance(fn: () => Promise<void>): Promise<void> {
  await using tmp = await tmpdir()
  await Instance.provide({ directory: tmp.path, fn })
}

describe("setCwd / getCwd — unit", () => {
  test("absolute path is stored and returned", async () => {
    await withInstance(async () => {
      setCwd("/tmp")
      expect(getCwd()).toBe("/tmp")
    })
  })

  test("tilde is expanded to home directory", async () => {
    await withInstance(async () => {
      setCwd("~/projects")
      expect(getCwd()).toBe(path.join(os.homedir(), "projects"))
    })
  })

  test("bare tilde expands to home directory", async () => {
    await withInstance(async () => {
      setCwd("~")
      expect(getCwd()).toBe(os.homedir())
    })
  })

  test("relative path resolves against current cwd", async () => {
    await withInstance(async () => {
      setCwd("/workspace")
      setCwd("subdir")
      expect(getCwd()).toBe("/workspace/subdir")
    })
  })

  test("chained relative cds accumulate correctly", async () => {
    await withInstance(async () => {
      setCwd("/workspace")
      setCwd("a")
      setCwd("b")
      expect(getCwd()).toBe("/workspace/a/b")
    })
  })

  test(".. resolves against current cwd", async () => {
    await withInstance(async () => {
      setCwd("/workspace/a/b")
      setCwd("..")
      expect(getCwd()).toBe("/workspace/a")
    })
  })
})

// LAC-742 regression: getCwd defaults to Instance.directory before any cd
describe("getCwd default — LAC-742 regression", () => {
  test("defaults to Instance.directory before any setCwd", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(getCwd()).toBe(tmp.path)
      },
    })
  })

  test("resetCwd restores fallback to Instance.directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setCwd("/tmp")
        expect(getCwd()).toBe("/tmp")
        resetCwd()
        expect(getCwd()).toBe(tmp.path)
      },
    })
  })
})

// LAC-742 regression: tool path resolution uses updated cwd
describe("tool path resolution — LAC-742 regression", () => {
  test("after cd /tmp, getCwd() is /tmp (bash tool base)", async () => {
    await withInstance(async () => {
      setCwd("/tmp")
      expect(getCwd()).toBe("/tmp")
      expect(path.resolve(getCwd(), "relative-file.txt")).toBe("/tmp/relative-file.txt")
    })
  })

  test("relative tool path resolves against updated cwd, not Instance.directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(getCwd()).toBe(tmp.path)
        setCwd("/tmp")
        expect(getCwd()).toBe("/tmp")
        expect(getCwd()).not.toBe(tmp.path)
      },
    })
  })
})

// LAC-742 regression: CwdEvent.Updated bus event
describe("CwdEvent.Updated — LAC-742 regression", () => {
  test("published when cwd changes", async () => {
    await using tmp = await tmpdir()
    const received: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Bus.subscribe(CwdEvent.Updated, (evt) => {
          received.push(evt.properties.cwd)
        })
        await Bun.sleep(10)

        setCwd("/tmp")
        await Bun.sleep(10)

        expect(received).toEqual(["/tmp"])
        unsub()
      },
    })
  })

  test("not published when same cwd is set again", async () => {
    await using tmp = await tmpdir()
    const received: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Bus.subscribe(CwdEvent.Updated, (evt) => {
          received.push(evt.properties.cwd)
        })
        await Bun.sleep(10)

        setCwd("/tmp")
        setCwd("/tmp")
        await Bun.sleep(10)

        expect(received).toEqual(["/tmp"])
        unsub()
      },
    })
  })

  test("published for each distinct cd destination", async () => {
    await using tmp = await tmpdir()
    const received: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Bus.subscribe(CwdEvent.Updated, (evt) => {
          received.push(evt.properties.cwd)
        })
        await Bun.sleep(10)

        setCwd("/tmp")
        setCwd("/var")
        await Bun.sleep(10)

        expect(received).toEqual(["/tmp", "/var"])
        unsub()
      },
    })
  })
})
