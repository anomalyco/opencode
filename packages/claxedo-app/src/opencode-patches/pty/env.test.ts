import { describe, expect, test } from "bun:test"
import { buildSafeEnv, getLocale } from "./env"

describe("buildSafeEnv", () => {
  // --- Allowlist: shell core ---
  test("passes PATH", () => {
    const out = buildSafeEnv({ PATH: "/usr/bin" })
    expect(out.PATH).toBe("/usr/bin")
  })

  test("passes HOME", () => {
    const out = buildSafeEnv({ HOME: "/home/user" })
    expect(out.HOME).toBe("/home/user")
  })

  test("passes SHELL", () => {
    const out = buildSafeEnv({ SHELL: "/bin/bash" })
    expect(out.SHELL).toBe("/bin/bash")
  })

  test("passes TERM", () => {
    const out = buildSafeEnv({ TERM: "xterm-256color" })
    expect(out.TERM).toBe("xterm-256color")
  })

  test("passes USER", () => {
    const out = buildSafeEnv({ USER: "alice" })
    expect(out.USER).toBe("alice")
  })

  test("passes SHLVL", () => {
    const out = buildSafeEnv({ SHLVL: "2" })
    expect(out.SHLVL).toBe("2")
  })

  // --- Allowlist: localization ---
  test("passes LANG", () => {
    const out = buildSafeEnv({ LANG: "en_US.UTF-8" })
    expect(out.LANG).toBe("en_US.UTF-8")
  })

  test("passes LC_ALL", () => {
    const out = buildSafeEnv({ LC_ALL: "C.UTF-8" })
    expect(out.LC_ALL).toBe("C.UTF-8")
  })

  test("passes TZ", () => {
    const out = buildSafeEnv({ TZ: "America/New_York" })
    expect(out.TZ).toBe("America/New_York")
  })

  // --- Allowlist: SSH ---
  test("passes SSH_AUTH_SOCK", () => {
    const out = buildSafeEnv({ SSH_AUTH_SOCK: "/tmp/ssh-agent.sock" })
    expect(out.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent.sock")
  })

  // --- Allowlist: language managers ---
  test("passes NVM_DIR", () => {
    const out = buildSafeEnv({ NVM_DIR: "/home/user/.nvm" })
    expect(out.NVM_DIR).toBe("/home/user/.nvm")
  })

  test("passes GOPATH", () => {
    const out = buildSafeEnv({ GOPATH: "/home/user/go" })
    expect(out.GOPATH).toBe("/home/user/go")
  })

  test("passes CARGO_HOME", () => {
    const out = buildSafeEnv({ CARGO_HOME: "/home/user/.cargo" })
    expect(out.CARGO_HOME).toBe("/home/user/.cargo")
  })

  // --- Allowlist: proxies ---
  test("passes HTTP_PROXY", () => {
    const out = buildSafeEnv({ HTTP_PROXY: "http://proxy:8080" })
    expect(out.HTTP_PROXY).toBe("http://proxy:8080")
  })

  test("passes lowercase http_proxy", () => {
    const out = buildSafeEnv({ http_proxy: "http://proxy:8080" })
    expect(out.http_proxy).toBe("http://proxy:8080")
  })

  // --- Allowlist: Homebrew ---
  test("passes HOMEBREW_PREFIX", () => {
    const out = buildSafeEnv({ HOMEBREW_PREFIX: "/opt/homebrew" })
    expect(out.HOMEBREW_PREFIX).toBe("/opt/homebrew")
  })

  // --- Allowlist: XDG ---
  test("passes XDG_CONFIG_HOME", () => {
    const out = buildSafeEnv({ XDG_CONFIG_HOME: "/home/user/.config" })
    expect(out.XDG_CONFIG_HOME).toBe("/home/user/.config")
  })

  // --- Allowlist: editor ---
  test("passes EDITOR", () => {
    const out = buildSafeEnv({ EDITOR: "vim" })
    expect(out.EDITOR).toBe("vim")
  })

  // --- Allowlist: SSL ---
  test("passes NODE_EXTRA_CA_CERTS", () => {
    const out = buildSafeEnv({ NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem" })
    expect(out.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/extra.pem")
  })

  // --- Allowlist: Git ---
  test("passes GIT_SSH_COMMAND", () => {
    const out = buildSafeEnv({ GIT_SSH_COMMAND: "ssh -i ~/.ssh/key" })
    expect(out.GIT_SSH_COMMAND).toBe("ssh -i ~/.ssh/key")
  })

  // --- Allowlist: cloud ---
  test("passes AWS_PROFILE", () => {
    const out = buildSafeEnv({ AWS_PROFILE: "dev" })
    expect(out.AWS_PROFILE).toBe("dev")
  })

  test("passes DOCKER_HOST", () => {
    const out = buildSafeEnv({ DOCKER_HOST: "unix:///var/run/docker.sock" })
    expect(out.DOCKER_HOST).toBe("unix:///var/run/docker.sock")
  })

  // --- Allowlist: SDKs ---
  test("passes JAVA_HOME", () => {
    const out = buildSafeEnv({ JAVA_HOME: "/usr/lib/jvm/java-17" })
    expect(out.JAVA_HOME).toBe("/usr/lib/jvm/java-17")
  })

  // --- Allowlist: Windows ---
  test("passes COMSPEC", () => {
    const out = buildSafeEnv({ COMSPEC: "C:\\Windows\\system32\\cmd.exe" })
    expect(out.COMSPEC).toBe("C:\\Windows\\system32\\cmd.exe")
  })

  // --- Allowlist: macOS ---
  test("passes __CF_USER_TEXT_ENCODING", () => {
    const out = buildSafeEnv({ __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0" })
    expect(out.__CF_USER_TEXT_ENCODING).toBe("0x1F5:0x0:0x0")
  })

  // --- Allowlist: terminal metadata ---
  test("passes TERM_PROGRAM", () => {
    const out = buildSafeEnv({ TERM_PROGRAM: "iTerm.app" })
    expect(out.TERM_PROGRAM).toBe("iTerm.app")
  })

  test("passes COLORTERM", () => {
    const out = buildSafeEnv({ COLORTERM: "truecolor" })
    expect(out.COLORTERM).toBe("truecolor")
  })

  test("passes GHOSTTY_RESOURCES_DIR", () => {
    const out = buildSafeEnv({ GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" })
    expect(out.GHOSTTY_RESOURCES_DIR).toBe("/usr/share/ghostty")
  })

  // --- Allowlist: misc ---
  test("passes DISPLAY", () => {
    const out = buildSafeEnv({ DISPLAY: ":0" })
    expect(out.DISPLAY).toBe(":0")
  })

  test("passes NO_COLOR", () => {
    const out = buildSafeEnv({ NO_COLOR: "1" })
    expect(out.NO_COLOR).toBe("1")
  })

  // --- Prefix matching ---
  test("passes OPENCODE_FOO via prefix", () => {
    const out = buildSafeEnv({ OPENCODE_FOO: "bar" })
    expect(out.OPENCODE_FOO).toBe("bar")
  })

  test("passes OPENCODE_TERMINAL via prefix", () => {
    const out = buildSafeEnv({ OPENCODE_TERMINAL: "1" })
    expect(out.OPENCODE_TERMINAL).toBe("1")
  })

  test("passes CLAXEDO_PORT via prefix", () => {
    const out = buildSafeEnv({ CLAXEDO_PORT: "7860" })
    expect(out.CLAXEDO_PORT).toBe("7860")
  })

  test("passes CLAXEDO_FOO via default prefix", () => {
    const out = buildSafeEnv({ CLAXEDO_FOO: "baz" })
    expect(out.CLAXEDO_FOO).toBe("baz")
  })

  test("custom prefix passes matching vars", () => {
    const out = buildSafeEnv({ MYAPP_KEY: "val" }, { customPrefix: "MYAPP" })
    expect(out.MYAPP_KEY).toBe("val")
  })

  test("custom prefix does not match without underscore", () => {
    const out = buildSafeEnv({ MYAPPKEY: "val" }, { customPrefix: "MYAPP" })
    expect(out.MYAPPKEY).toBeUndefined()
  })

  // --- Unknown vars blocked ---
  test("blocks RANDOM_FOO", () => {
    const out = buildSafeEnv({ RANDOM_FOO: "bar" })
    expect(out.RANDOM_FOO).toBeUndefined()
  })

  test("blocks MY_CUSTOM_VAR", () => {
    const out = buildSafeEnv({ MY_CUSTOM_VAR: "test" })
    expect(out.MY_CUSTOM_VAR).toBeUndefined()
  })

  // --- Secret exclusion ---
  test("blocks DATABASE_URL", () => {
    const out = buildSafeEnv({ DATABASE_URL: "postgres://..." })
    expect(out.DATABASE_URL).toBeUndefined()
  })

  test("blocks AWS_SECRET_ACCESS_KEY", () => {
    const out = buildSafeEnv({ AWS_SECRET_ACCESS_KEY: "secret" })
    expect(out.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test("blocks GH_TOKEN", () => {
    const out = buildSafeEnv({ GH_TOKEN: "ghp_xxx" })
    expect(out.GH_TOKEN).toBeUndefined()
  })

  test("blocks GITHUB_TOKEN", () => {
    const out = buildSafeEnv({ GITHUB_TOKEN: "ghp_xxx" })
    expect(out.GITHUB_TOKEN).toBeUndefined()
  })

  test("blocks API_KEY", () => {
    const out = buildSafeEnv({ API_KEY: "sk-xxx" })
    expect(out.API_KEY).toBeUndefined()
  })

  test("blocks SECRET_KEY", () => {
    const out = buildSafeEnv({ SECRET_KEY: "very-secret" })
    expect(out.SECRET_KEY).toBeUndefined()
  })

  test("blocks NPM_TOKEN", () => {
    const out = buildSafeEnv({ NPM_TOKEN: "npm_xxx" })
    expect(out.NPM_TOKEN).toBeUndefined()
  })

  // --- Build-time var exclusion ---
  test("blocks VITE_API_URL", () => {
    const out = buildSafeEnv({ VITE_API_URL: "http://localhost" })
    expect(out.VITE_API_URL).toBeUndefined()
  })

  test("blocks NEXT_PUBLIC_API", () => {
    const out = buildSafeEnv({ NEXT_PUBLIC_API: "http://localhost" })
    expect(out.NEXT_PUBLIC_API).toBeUndefined()
  })

  test("blocks REACT_APP_KEY", () => {
    const out = buildSafeEnv({ REACT_APP_KEY: "abc" })
    expect(out.REACT_APP_KEY).toBeUndefined()
  })

  test("blocks NUXT_PUBLIC_BASE", () => {
    const out = buildSafeEnv({ NUXT_PUBLIC_BASE: "/" })
    expect(out.NUXT_PUBLIC_BASE).toBeUndefined()
  })

  // --- Deny list ---
  test("blocks NODE_OPTIONS even though it looks harmless", () => {
    const out = buildSafeEnv({ NODE_OPTIONS: "--max-old-space-size=4096" })
    expect(out.NODE_OPTIONS).toBeUndefined()
  })

  test("blocks ELECTRON_RUN_AS_NODE", () => {
    const out = buildSafeEnv({ ELECTRON_RUN_AS_NODE: "1" })
    expect(out.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  test("blocks NODE_PATH", () => {
    const out = buildSafeEnv({ NODE_PATH: "/some/path" })
    expect(out.NODE_PATH).toBeUndefined()
  })

  // --- Windows case-insensitive matching ---
  test("Windows: case-insensitive allowlist match (lowercase path)", () => {
    const out = buildSafeEnv({ path: "/usr/bin" }, { platform: "win32" })
    expect(out.path).toBe("/usr/bin")
  })

  test("Windows: case-insensitive allowlist match (mixed case Home)", () => {
    const out = buildSafeEnv({ Home: "C:\\Users\\alice" }, { platform: "win32" })
    expect(out.Home).toBe("C:\\Users\\alice")
  })

  test("Windows: case-insensitive deny list (node_options lowercase)", () => {
    const out = buildSafeEnv({ node_options: "--inspect" }, { platform: "win32" })
    expect(out.node_options).toBeUndefined()
  })

  test("Windows: case-insensitive prefix match (opencode_foo lowercase)", () => {
    const out = buildSafeEnv({ opencode_foo: "bar" }, { platform: "win32" })
    expect(out.opencode_foo).toBe("bar")
  })

  // --- Undefined values filtered ---
  test("skips entries with undefined values", () => {
    const out = buildSafeEnv({ PATH: undefined, HOME: "/home/user" })
    expect(out.PATH).toBeUndefined()
    expect(out.HOME).toBe("/home/user")
  })

  test("output contains only string values", () => {
    const out = buildSafeEnv({
      PATH: "/usr/bin",
      HOME: "/home/user",
      SHELL: "/bin/bash",
      UNKNOWN: "val",
      EMPTY: undefined,
    })
    for (const val of Object.values(out)) {
      expect(typeof val).toBe("string")
    }
  })

  // --- Empty env ---
  test("empty env returns empty object", () => {
    const out = buildSafeEnv({})
    expect(Object.keys(out)).toHaveLength(0)
  })

  // --- Multiple vars at once ---
  test("passes multiple allowed vars and blocks unknown", () => {
    const out = buildSafeEnv({
      PATH: "/usr/bin",
      HOME: "/home/user",
      SHELL: "/bin/bash",
      OPENCODE_DEBUG: "1",
      SECRET_KEY: "xxx",
      NODE_OPTIONS: "--inspect",
      RANDOM: "nope",
    })
    expect(out.PATH).toBe("/usr/bin")
    expect(out.HOME).toBe("/home/user")
    expect(out.SHELL).toBe("/bin/bash")
    expect(out.OPENCODE_DEBUG).toBe("1")
    expect(out.SECRET_KEY).toBeUndefined()
    expect(out.NODE_OPTIONS).toBeUndefined()
    expect(out.RANDOM).toBeUndefined()
  })
})

describe("getLocale", () => {
  test("returns LANG if it contains UTF-8", () => {
    expect(getLocale({ LANG: "en_US.UTF-8" })).toBe("en_US.UTF-8")
  })

  test("returns LC_ALL if it contains UTF-8 (takes priority)", () => {
    expect(getLocale({ LC_ALL: "C.UTF-8", LANG: "en_US.UTF-8" })).toBe("C.UTF-8")
  })

  test("returns LANG when LC_ALL is not UTF-8", () => {
    expect(getLocale({ LC_ALL: "C", LANG: "en_US.UTF-8" })).toBe("en_US.UTF-8")
  })

  test("handles lowercase utf-8", () => {
    expect(getLocale({ LANG: "en_GB.utf-8" })).toBe("en_GB.utf-8")
  })

  test("handles utf8 without hyphen", () => {
    expect(getLocale({ LANG: "ja_JP.utf8" })).toBe("ja_JP.utf8")
  })

  test("returns default when LANG has no UTF-8", () => {
    expect(getLocale({ LANG: "C" })).toBe("en_US.UTF-8")
  })

  test("returns default when env is empty", () => {
    expect(getLocale({})).toBe("en_US.UTF-8")
  })

  test("returns default when LANG is undefined", () => {
    expect(getLocale({ LANG: undefined })).toBe("en_US.UTF-8")
  })
})
