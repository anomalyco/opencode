import { describe, expect, test } from "bun:test"
import {
  hasTerminalImageOutput,
  supportsTerminalImageOutput,
  terminalImageOutputFromFile,
  terminalImagePlacementOutput,
  terminalImagePath,
  terminalImageSector,
  terminalImageSectorFromOutput,
  terminalImageSizeFromFile,
  writeTerminalImageFileOutput,
  writeTerminalImageOutput,
} from "@/cli/cmd/tui/util/terminal-image"
import { tmpdir } from "../../fixture/fixture"

const image = "\x1b]1337;File=name=test.png;inline=1:aW1hZ2U=\x07"

describe("terminal image output", () => {
  test("detects iTerm2 OSC image payloads", () => {
    expect(hasTerminalImageOutput(image)).toBe(true)
    expect(hasTerminalImageOutput("plain text output")).toBe(false)
  })

  test("supports modern iTerm2 sessions", () => {
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }, "darwin")).toBe(
      true,
    )
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.9.20150512" }, "darwin"))
      .toBe(true)
    expect(supportsTerminalImageOutput({ ITERM_SESSION_ID: "w0t0p0:20260514_120000" }, "darwin")).toBe(true)
    expect(supportsTerminalImageOutput({ LC_TERMINAL: "iTerm2" }, "linux")).toBe(true)
  })

  test("rejects terminals without known iTerm2 OSC support", () => {
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }, "darwin")).toBe(
      false,
    )
    expect(supportsTerminalImageOutput({ TERM: "xterm-256color", COLORTERM: "truecolor" }, "linux")).toBe(false)
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "iTerm.app" }, "win32")).toBe(false)
  })

  test("rejects iTerm2 versions before inline images shipped", () => {
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.9.20150511" }, "darwin"))
      .toBe(false)
    expect(supportsTerminalImageOutput({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.8.9" }, "darwin")).toBe(
      false,
    )
  })

  test("does not assume tmux passes OSC image payloads through", () => {
    expect(
      supportsTerminalImageOutput(
        { TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0", TMUX: "/tmp/tmux-501/default,1,0" },
        "darwin",
      ),
    ).toBe(false)
  })

  test("only writes OSC images for supported terminal environments", async () => {
    const writes: string[] = []
    const write = async (raw: string) => {
      writes.push(raw)
    }

    expect(await writeTerminalImageOutput(image, { env: { TERM_PROGRAM: "Apple_Terminal" }, platform: "darwin", write }))
      .toBe(false)
    expect(await writeTerminalImageOutput("plain text", { env: { TERM_PROGRAM: "iTerm.app" }, platform: "darwin", write }))
      .toBe(false)
    expect(await writeTerminalImageOutput(image, { env: { TERM_PROGRAM: "iTerm.app" }, platform: "darwin", write })).toBe(
      true,
    )
    expect(writes).toEqual([image])
  })

  test("builds iTerm2 OSC image output from local image files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(`${dir}/image.png`, Buffer.from("image"))
        await Bun.write(`${dir}/image.txt`, "not an image")
        return dir
      },
    })

    expect(await terminalImageOutputFromFile(`${tmp.path}/missing.png`)).toBeUndefined()
    expect(await terminalImageOutputFromFile(`${tmp.path}/image.txt`)).toBeUndefined()
    expect(await terminalImageOutputFromFile(`${tmp.path}/image.png`)).toBe(
      "\x1b]1337;File=name=aW1hZ2UucG5n;inline=1;doNotMoveCursor=1:aW1hZ2U=\x07",
    )
    expect(await terminalImageOutputFromFile(`${tmp.path}/image.png`, { width: 40, height: 12 })).toBe(
      "\x1b]1337;File=name=aW1hZ2UucG5n;inline=1;doNotMoveCursor=1;width=40;height=12:aW1hZ2U=\x07",
    )
  })

  test("computes terminal-cell sectors from image dimensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const png = Buffer.alloc(24)
        Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0)
        png.writeUInt32BE(900, 16)
        png.writeUInt32BE(360, 20)
        await Bun.write(`${dir}/wide.png`, png)
        return dir
      },
    })

    expect(await terminalImageSizeFromFile(`${tmp.path}/wide.png`)).toEqual({ width: 900, height: 360 })
    expect(terminalImageSector({ width: 900, height: 360 }, { maxWidth: 80 })).toEqual({ columns: 80, rows: 16 })
    expect(terminalImageSector({ width: 900, height: 360 }, { maxWidth: 80, maxHeight: 8 })).toEqual({
      columns: 40,
      rows: 8,
    })
    expect(terminalImageSector({ width: 90, height: 36 }, { maxWidth: 80 })).toEqual({ columns: 10, rows: 2 })
  })

  test("marks explicit OSC cell dimensions as a render sector", () => {
    expect(
      terminalImageSectorFromOutput("\x1b]1337;File=name=test.png;inline=1;width=40;height=12:aW1hZ2U=\x07", {
        maxWidth: 80,
      }),
    ).toEqual({ columns: 40, rows: 12 })
    expect(
      terminalImageSectorFromOutput("\x1b]1337;File=name=test.png;inline=1;width=200;height=12:aW1hZ2U=\x07", {
        maxWidth: 80,
      }),
    ).toEqual({ columns: 80, rows: 12 })
    expect(
      terminalImageSectorFromOutput("\x1b]1337;File=name=test.png;inline=1;width=40;height=20:aW1hZ2U=\x07", {
        maxWidth: 80,
        maxHeight: 8,
      }),
    ).toEqual({ columns: 40, rows: 8 })
    expect(
      terminalImageSectorFromOutput("\x1b]1337;File=name=test.png;inline=1;width=40px;height=12:aW1hZ2U=\x07", {
        maxWidth: 80,
      }),
    ).toEqual({ columns: 80, rows: 12 })
    expect(terminalImageSectorFromOutput(image, { maxWidth: 80 })).toBeUndefined()
  })

  test("positions OSC image output inside a reserved terminal area", () => {
    expect(terminalImagePlacementOutput(image, { x: 4, y: 2, width: 8, height: 3 })).toBe(
      "\x1b7\x1b[3;5H\x1b[8X\x1b[4;5H\x1b[8X\x1b[5;5H\x1b[8X\x1b[3;5H" + image + "\x1b8",
    )
  })

  test("writes local image files only for supported terminal environments", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(`${dir}/image.png`, Buffer.from("image"))
        return dir
      },
    })
    const writes: string[] = []
    const write = async (raw: string) => {
      writes.push(raw)
    }

    expect(
      await writeTerminalImageFileOutput(`${tmp.path}/image.png`, {
        env: { TERM_PROGRAM: "Apple_Terminal" },
        platform: "darwin",
        write,
      }),
    ).toBe(false)
    expect(
      await writeTerminalImageFileOutput(`${tmp.path}/image.png`, {
        env: { TERM_PROGRAM: "iTerm.app" },
        platform: "darwin",
        display: { width: 20, height: 10 },
        placement: { x: 1, y: 1, width: 20, height: 10 },
        write,
      }),
    ).toBe(true)
    expect(writes).toEqual([
      "\x1b7" +
        Array.from({ length: 10 }, (_, index) => `\x1b[${index + 2};2H\x1b[20X`).join("") +
        "\x1b[2;2H\x1b]1337;File=name=aW1hZ2UucG5n;inline=1;doNotMoveCursor=1;width=20;height=10:aW1hZ2U=\x07\x1b8",
    ])
  })

  test("finds image paths from generic show_image inputs", () => {
    expect(terminalImagePath({ path: "/tmp/image.png" })).toBe("/tmp/image.png")
    expect(terminalImagePath({ filePath: "/tmp/image.png" })).toBe("/tmp/image.png")
    expect(terminalImagePath({ file_path: "/tmp/image.png" })).toBe("/tmp/image.png")
    expect(terminalImagePath({ path: 1 })).toBeUndefined()
  })
})
