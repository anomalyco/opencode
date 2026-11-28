import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "@opencode/core/shell/parse"

// Directory arguments of cd-style commands are relative to the directory the shell is in when
// the command runs. A chain like `cd a && cd ../b` must resolve ../b against a, not against the
// invocation cwd, otherwise the external_directory prompt asks for a sibling of the project
// that the command never touches (anomalyco/opencode#57515). Entries stay relative to the
// invocation cwd — the caller resolves them there — but a chained entry is rebased so it still
// names the directory the command actually touches.
describe("ShellParse cd chains", () => {
  test.each(["bash", "zsh"])(`resolves chained relative cd against the running directory: %s`, async (shell) => {
    const command = "cd /tmp/oc-repro/project/layer-a && ls; echo done; cd ../layer-b && ls"
    const expected = {
      commands: [
        { resource: "ls", save: "ls *" },
        { resource: "echo done", save: "echo *" },
        { resource: "ls", save: "ls *" },
      ],
      directories: ["/tmp/oc-repro/project/layer-a", "layer-b"],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/tmp/oc-repro/project"))).toEqual(expected)
  })

  test.each(["bash", "zsh"])(`keeps a single relative cd unchanged: %s`, async (shell) => {
    const expected = {
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["../outside"],
    }
    expect(await Effect.runPromise(ShellParse.scan("cd ../outside && git status", shell, "/workspace"))).toEqual(
      expected,
    )
  })

  test.each(["bash", "zsh"])(`restores the directory across pushd/popd: %s`, async (shell) => {
    const command = "pushd a && cd b && popd && cd c"
    const expected = {
      commands: [{ resource: "popd", save: "popd *" }],
      directories: ["a", "a/b", "c"],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))).toEqual(expected)
  })

  test.each(["bash", "zsh"])(`does not pop the stack for popd rotation operands: %s`, async (shell) => {
    const command = "pushd a && popd +0 && cd b"
    const expected = {
      commands: [{ resource: "popd +0", save: "popd *" }],
      directories: ["a", "a/b"],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))).toEqual(expected)
  })

  test.each(["bash", "zsh"])(`does not change the running directory for pushd -n: %s`, async (shell) => {
    const command = "cd sub && pushd -n /tmp && cd sibling && popd && cd next"
    const expected = {
      commands: [{ resource: "popd", save: "popd *" }],
      directories: ["sub", "/tmp", "sub/sibling", "../tmp/next"],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))).toEqual(expected)
  })

  test.each(["bash", "zsh"])(`does not advance the directory for dynamic cd targets: %s`, async (shell) => {
    const command = "cd $TARGET && cd ../sibling"
    const expected = {
      commands: [{ resource: "cd $TARGET", save: "cd *" }],
      directories: ["../sibling"],
    }
    expect(await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))).toEqual(expected)
  })
})
