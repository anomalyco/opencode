import { describe, expect, test } from "bun:test"
import { listSshConfigHosts, parseSshConfig, type SshConfigIo } from "./ssh-config"

function io(files: Record<string, string>, dirs: Record<string, string[]> = {}): SshConfigIo {
  return {
    readFile: (path) => files[path] ?? null,
    listDir: (path) => dirs[path] ?? [],
    home: () => "/home/dev",
  }
}

describe("parseSshConfig", () => {
  test("collects Host aliases and skips wildcard patterns", () => {
    const entries = parseSshConfig(
      [
        "# comment",
        "Host build staging",
        "  HostName build.internal",
        "Host *",
        "  User dev",
        "Host prod-?",
        'Host "quoted host"',
        "Host=eqform",
      ].join("\n"),
    )
    expect(entries).toEqual([
      { kind: "host", hosts: ["build", "staging"] },
      { kind: "host", hosts: ["quoted host"] },
      { kind: "host", hosts: ["eqform"] },
    ])
  })

  test("collects Include directives", () => {
    expect(parseSshConfig("Include config.d/*\nInclude ~/extra")).toEqual([
      { kind: "include", paths: ["config.d/*"] },
      { kind: "include", paths: ["~/extra"] },
    ])
  })
})

describe("listSshConfigHosts", () => {
  test("reads the main config and follows includes with globs", () => {
    const hosts = listSshConfigHosts(
      io(
        {
          "/home/dev/.ssh/config": ["Host main", "Include config.d/*.conf", "Include ~/.ssh/work"].join("\n"),
          "/home/dev/.ssh/config.d/a.conf": "Host alpha",
          "/home/dev/.ssh/config.d/b.conf": "Host beta main",
          "/home/dev/.ssh/work": "Host work-box",
        },
        { "/home/dev/.ssh/config.d": ["a.conf", "b.conf", "ignore.txt"] },
      ),
    )
    expect(hosts).toEqual(["main", "alpha", "beta", "work-box"])
  })

  test("returns an empty list when no config exists", () => {
    expect(listSshConfigHosts(io({}))).toEqual([])
  })

  test("survives include cycles", () => {
    const hosts = listSshConfigHosts(
      io({
        "/home/dev/.ssh/config": "Include loop\nHost top",
        "/home/dev/.ssh/loop": "Include config\nHost looped",
      }),
    )
    expect(hosts).toEqual(["looped", "top"])
  })
})
