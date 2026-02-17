import { describe, expect, test } from "bun:test"
import { AppleContainer } from "../../src/container/apple"

describe("AppleContainer.enabled", () => {
  test("enables on darwin arm64 release", () => {
    expect(
      AppleContainer.enabled({
        platform: "darwin",
        arch: "arm64",
        disable: false,
        force: false,
        local: false,
      }),
    ).toBe(true)
  })

  test("disable flag wins", () => {
    expect(
      AppleContainer.enabled({
        platform: "darwin",
        arch: "arm64",
        disable: true,
        force: true,
        local: false,
      }),
    ).toBe(false)
  })

  test("force flag bypasses platform gate", () => {
    expect(
      AppleContainer.enabled({
        platform: "linux",
        arch: "x64",
        disable: false,
        force: true,
        local: false,
      }),
    ).toBe(true)
  })
})

describe("AppleContainer command construction", () => {
  test("builds publish mapping", () => {
    expect(
      AppleContainer.publish({
        host: "0.0.0.0",
        hostPort: 4096,
        containerPort: 4096,
      }),
    ).toBe("4096:4096")

    expect(
      AppleContainer.publish({
        host: "127.0.0.1",
        hostPort: 4096,
        containerPort: 4096,
      }),
    ).toBe("127.0.0.1:4096:4096")
  })

  test("builds serve args", () => {
    expect(
      AppleContainer.serve({
        port: 4096,
        mdns: true,
        mdnsDomain: "opencode.local",
        cors: ["https://app.example.com"],
      }),
    ).toEqual([
      "serve",
      "--hostname",
      "0.0.0.0",
      "--port",
      "4096",
      "--mdns",
      "--mdns-domain",
      "opencode.local",
      "--cors",
      "https://app.example.com",
    ])
  })

  test("builds full run command", () => {
    const cmd = AppleContainer.run({
      name: "opencode-test",
      image: "kalilinux/kali-rolling",
      cwd: "/tmp/project",
      publish: "127.0.0.1:4123:4123",
      mounts: ["/tmp/project", "/tmp/opencode"],
      env: ["OPENCODE_SERVER_PASSWORD=secret"],
      binary: "/tmp/opencode/opencode-linux-arm64-v1.0.0",
      serve: ["serve", "--hostname", "0.0.0.0", "--port", "4123"],
    })

    expect(cmd).toContain("container")
    expect(cmd).toContain("run")
    expect(cmd).toContain("--detach")
    expect(cmd).toContain("--rm")
    expect(cmd).toContain("kalilinux/kali-rolling")
    expect(cmd).toContain("/tmp/opencode/opencode-linux-arm64-v1.0.0")
    expect(cmd).toContain("127.0.0.1:4123:4123")
    expect(cmd).toContain("OPENCODE_SERVER_PASSWORD=secret")
    expect(cmd).toContain("/tmp/project:/tmp/project")
  })

  test("mounts are deduplicated", () => {
    const list = AppleContainer.mounts({
      directory: "/tmp/project",
      binary: "/tmp/project/bin/opencode-linux-arm64",
    })
    expect(new Set(list).size).toBe(list.length)
    expect(list).toContain("/tmp/project")
    expect(list).toContain("/tmp/project/bin")
  })
})
