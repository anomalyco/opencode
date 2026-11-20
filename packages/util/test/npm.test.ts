import { describe, expect, test } from "bun:test"
import { Npm } from "../src/npm.js"

describe("Npm.nonInteractiveGitEnv", () => {
  test("sets non-interactive git, GCM, and SSH variables while preserving caller env", () => {
    const env = Npm.nonInteractiveGitEnv({
      PATH: "/usr/bin",
      CUSTOM_VAR: "kept",
    })

    expect(env.PATH).toBe("/usr/bin")
    expect(env.CUSTOM_VAR).toBe("kept")
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.GCM_INTERACTIVE).toBe("never")
    expect(env.GIT_ASKPASS).toBe("")
    expect(env.SSH_ASKPASS).toBe("")
    expect(env.SSH_ASKPASS_REQUIRE).toBe("never")
    expect(env.GIT_SSH_COMMAND).toBe("ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new")
  })

  test("overrides interactive prompt env vars from the caller environment", () => {
    const env = Npm.nonInteractiveGitEnv({
      GIT_TERMINAL_PROMPT: "1",
      GCM_INTERACTIVE: "always",
      GIT_ASKPASS: "/usr/bin/ssh-askpass",
      SSH_ASKPASS: "/usr/bin/ssh-askpass",
      SSH_ASKPASS_REQUIRE: "force",
    })

    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.GCM_INTERACTIVE).toBe("never")
    expect(env.GIT_ASKPASS).toBe("")
    expect(env.SSH_ASKPASS).toBe("")
    expect(env.SSH_ASKPASS_REQUIRE).toBe("never")
  })

  test("preserves an explicit GIT_SSH_COMMAND from the environment", () => {
    const env = Npm.nonInteractiveGitEnv({
      GIT_SSH_COMMAND: "ssh -i /custom/key",
    })

    expect(env.GIT_SSH_COMMAND).toBe("ssh -i /custom/key")
  })

  test("omits GIT_SSH_COMMAND when git config defines core.sshCommand", () => {
    const env = Npm.nonInteractiveGitEnv({}, true)

    expect(env.GIT_SSH_COMMAND).toBeUndefined()
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.GCM_INTERACTIVE).toBe("never")
  })
})
