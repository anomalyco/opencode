import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { OpenTool, __testing } from "../../src/tool/open"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const { classifyTarget, platformLauncher } = __testing

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const baseCtx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.open helpers", () => {
  test("classifyTarget recognises http(s)/file URLs", () => {
    const httpResult = classifyTarget("https://example.com/path")
    expect(httpResult.kind).toBe("url")

    const fileResult = classifyTarget("file:///C:/foo/bar.txt")
    expect(fileResult.kind).toBe("url")

    const ftpResult = classifyTarget("ftp://example.com/file.bin")
    expect(ftpResult.kind).toBe("url")
  })

  test("classifyTarget treats Windows drive letters as paths", () => {
    const r = classifyTarget("C:\\Users\\foo\\bar.txt")
    expect(r.kind).toBe("path")
  })

  test("classifyTarget treats relative paths as paths", () => {
    const r = classifyTarget("./build/report.html")
    expect(r.kind).toBe("path")
  })

  test("platformLauncher uses direct Windows file protocol handler for URLs", () => {
    const r = platformLauncher("https://example.com", false, "url", "win32")
    expect(r.cmd).toBe("rundll32.exe")
    expect(r.args).toEqual(["url.dll,FileProtocolHandler", "https://example.com"])
  })

  test("platformLauncher avoids cmd shell for Windows file targets", () => {
    const target = "C:\\tmp\\report & not-a-command.txt"
    const r = platformLauncher(target, false, "file", "win32")
    expect(r.cmd).toBe("rundll32.exe")
    expect(r.args).toEqual(["url.dll,FileProtocolHandler", target])
  })

  test("platformLauncher uses explorer for Windows directories", () => {
    const r = platformLauncher("C:\\tmp\\reports", false, "directory", "win32")
    expect(r.cmd).toBe("explorer.exe")
    expect(r.args).toEqual(["C:\\tmp\\reports"])
  })

  test("platformLauncher uses explorer /select for reveal+file on Windows", () => {
    const r = platformLauncher("C:\\foo\\bar.txt", true, "file", "win32")
    expect(r.cmd).toBe("explorer.exe")
    expect(r.args[0]).toBe("/select,C:\\foo\\bar.txt")
  })

  test("platformLauncher uses open -R on macOS reveal", () => {
    const r = platformLauncher("/tmp/file.bin", true, "file", "darwin")
    expect(r.cmd).toBe("open")
    expect(r.args).toEqual(["-R", "/tmp/file.bin"])
  })

  test("platformLauncher uses xdg-open on linux", () => {
    const r = platformLauncher("/tmp/file.bin", false, "file", "linux")
    expect(r.cmd).toBe("xdg-open")
    expect(r.args).toEqual(["/tmp/file.bin"])
  })
})

describe("tool.open", () => {
  it.live("rejects unsupported URL schemes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const toolInfo = yield* OpenTool
        const tool = yield* toolInfo.init()
        const exit = yield* Effect.exit(tool.execute({ target: "javascript:alert(1)" }, baseCtx))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("scheme")
        }
      }),
    ),
  )

  it.live("rejects nonexistent local paths", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const toolInfo = yield* OpenTool
        const tool = yield* toolInfo.init()
        const exit = yield* Effect.exit(
          tool.execute({ target: "definitely-not-a-real-file-xyz.txt" }, baseCtx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("does not exist")
        }
      }),
    ),
  )
})
