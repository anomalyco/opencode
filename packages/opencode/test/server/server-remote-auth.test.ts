import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { RemoteAuth } from "../../src/server/remote-auth"
import { tmpdir } from "../fixture/fixture"

describe("remote server auth", () => {
  test("keeps the remote app script on the current public path", async () => {
    const token = RemoteAuth.create({
      directory: process.cwd(),
      sessionID: "ses_test",
    })
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "tailnet",
      remotePair: {
        directory: process.cwd(),
        sessionID: "ses_test",
      },
    })

    const response = await app.fetch(new Request(`http://localhost/remote?token=${token.token}&sessionID=ses_test`), {
      server: {
        requestIP: () => ({
          address: "127.0.0.1",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain(`src="?token=${token.token}&amp;sessionID=ses_test&amp;app=1"`)
    expect(body).toContain('data-tab-panel="chat"')
    expect(body).toContain('data-tab="logs"')
    expect(body).toContain('id="command-menu"')
    expect(body).toContain('id="attach-button"')
  })

  test("serves the remote app script from the root route when requested", async () => {
    const token = RemoteAuth.create({
      directory: process.cwd(),
    })
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "tailnet",
    })

    const response = await app.fetch(new Request(`http://localhost/remote?token=${token.token}&app=1`), {
      server: {
        requestIP: () => ({
          address: "127.0.0.1",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/javascript")
    const body = await response.text()
    expect(body).toContain("connectEvents()")
    expect(body).toContain("window.visualViewport")
    expect(body).toContain("keyboard-open")
  })

  test("redirects bare remote pages to a tokenized pairing URL when defaults are available", async () => {
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "tailnet",
      remotePair: {
        directory: process.cwd(),
        sessionID: "ses_test",
      },
    })

    const response = await app.fetch(new Request("http://localhost/remote"), {
      server: {
        requestIP: () => ({
          address: "127.0.0.1",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(302)
    const location = response.headers.get("location")
    expect(location?.startsWith("?")).toBe(true)
    expect(location).toContain("token=")
    expect(location).toContain("sessionID=ses_test")
  })

  test("does not trigger a browser basic-auth challenge for remote mode without credentials", async () => {
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "tailnet",
    })

    const response = await app.fetch(new Request("http://localhost/remote"), {
      server: {
        requestIP: () => ({
          address: "127.0.0.1",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("Pairing URL"),
    })
  })

  test("accepts remote bearer tokens on dedicated remote servers outside the old allowlist", async () => {
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "lan",
    })
    const token = RemoteAuth.create({
      directory: process.cwd(),
    })

    const response = await app.fetch(
      new Request(`http://localhost/remote/pair?token=${token.token}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          directory: process.cwd(),
        }),
      }),
      {
        server: {
          requestIP: () => ({
            address: "192.168.1.44",
            family: "IPv4",
            port: 1234,
          }),
        },
      },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      directory: process.cwd(),
      token: expect.any(String),
      url: expect.any(String),
    })
  })

  test("rejects remote bearer tokens on non-remote routes", async () => {
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "lan",
    })
    const token = RemoteAuth.create({
      directory: process.cwd(),
    })

    const response = await app.fetch(new Request(`http://localhost/agent?token=${token.token}`), {
      server: {
        requestIP: () => ({
          address: "192.168.1.44",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("Missing remote token"),
    })
  })

  test("accepts remote bearer tokens on remote command routes", async () => {
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "lan",
    })
    const token = RemoteAuth.create({
      directory: process.cwd(),
    })

    const response = await app.fetch(new Request(`http://localhost/command?token=${token.token}`), {
      server: {
        requestIP: () => ({
          address: "192.168.1.44",
          family: "IPv4",
          port: 1234,
        }),
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.any(Array))
  })

  test("rejects scope changes when regenerating a remote token", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "lan",
    })
    const token = RemoteAuth.create({
      directory: tmp.path,
      sessionID: "ses_123",
    })

    const response = await app.fetch(
      new Request(`http://localhost/remote/pair?token=${token.token}&sessionID=ses_123`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          directory: other.path,
          sessionID: "ses_456",
        }),
      }),
      {
        server: {
          requestIP: () => ({
            address: "192.168.1.44",
            family: "IPv4",
            port: 1234,
          }),
        },
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      name: "RemoteAuthScopeError",
    })
  })

  test("rejects header directory overrides for remote bearer tokens", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const token = RemoteAuth.create({
      directory: tmp.path,
    })
    const app = Server.createApp({
      passwordOverride: "pw",
      usernameOverride: "opencode",
      remoteMode: "lan",
    })

    const response = await app.fetch(
      new Request("http://localhost/session?directory=" + encodeURIComponent(tmp.path), {
        headers: {
          authorization: `Bearer ${token.token}`,
          "x-opencode-directory": other.path,
        },
      }),
      {
        server: {
          requestIP: () => ({
            address: "192.168.1.44",
            family: "IPv4",
            port: 1234,
          }),
        },
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      name: "RemoteAuthScopeError",
    })
  })
})
