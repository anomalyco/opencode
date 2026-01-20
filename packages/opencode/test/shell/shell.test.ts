import { expect, test, mock } from "bun:test"
import { Shell } from "../../src/shell/shell"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

test("Shell.preferred resolves from config", async () => {
  await using tmp = await tmpdir({
    config: {
      shell: "/custom/shell",
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const shell = await Shell.preferred()
      expect(shell).toBe("/custom/shell")
    },
  })
})

test("Shell.acceptable resolves from config", async () => {
  await using tmp = await tmpdir({
    config: {
      shell: "/custom/acceptable/shell",
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const shell = await Shell.acceptable()
      expect(shell).toBe("/custom/acceptable/shell")
    },
  })
})

test("Shell.preferred resolves from plugin", async () => {
  const originalTrigger = Plugin.trigger
  Plugin.trigger = mock(async (name, input, output) => {
    if (name === "shell.resolve") {
      output.shell = "/plugin/resolved/shell"
    }
  })

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const shell = await Shell.preferred()
        expect(shell).toBe("/plugin/resolved/shell")
        expect(Plugin.trigger).toHaveBeenCalledWith("shell.resolve", expect.anything(), expect.anything())
      },
    })
  } finally {
    Plugin.trigger = originalTrigger
  }
})

test("Shell.preferred falls back to environment/system", async () => {
  const originalEnvShell = process.env.SHELL
  process.env.SHELL = "/env/shell"

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const shell = await Shell.preferred()
        expect(shell).toBe("/env/shell")
      },
    })
  } finally {
    process.env.SHELL = originalEnvShell
  }
})
