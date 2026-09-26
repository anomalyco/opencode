import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  VoiceRecorder,
  buildTranscribeShellCommand,
  ffmpegArgs,
  findRecorder,
  shouldDiscardTap,
  soxArgs,
  transcribeAudio,
  VOICE_FILE_PLACEHOLDER,
  VOICE_MAX_RECORD_MS,
  VOICE_MIN_HOLD_MS,
} from "../../src/component/prompt/voice"

const originalPath = process.env.PATH
afterEach(() => {
  process.env.PATH = originalPath
})

function fakeBinDir(files: Record<string, string>): string {
  const dir = mkdtempDir()
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name)
    writeFileSync(path, body, { mode: 0o755 })
    chmodSync(path, 0o755)
  }
  return dir
}

function mkdtempDir(): string {
  return mkdtempSync(join(tmpdir(), "opencode-voice-test-"))
}

describe("component.prompt.voice", () => {
  describe("ffmpegArgs", () => {
    test("uses avfoundation on darwin", () => {
      const args = ffmpegArgs("darwin", "/tmp/a.wav")
      expect(args).toContain("avfoundation")
      expect(args.at(-1)).toBe("/tmp/a.wav")
    })

    test("uses dshow on win32", () => {
      const args = ffmpegArgs("win32", "/tmp/a.wav")
      expect(args).toContain("dshow")
      expect(args.at(-1)).toBe("/tmp/a.wav")
    })

    test("uses pulse on linux", () => {
      const args = ffmpegArgs("linux", "/tmp/a.wav")
      expect(args).toContain("pulse")
      expect(args.at(-1)).toBe("/tmp/a.wav")
    })
  })

  describe("soxArgs", () => {
    test("records 16k mono to the output file", () => {
      expect(soxArgs("/tmp/a.wav")).toEqual(["-r", "16000", "-c", "1", "/tmp/a.wav"])
    })
  })

  describe("findRecorder", () => {
    test("prefers ffmpeg over rec", () => {
      const dir = fakeBinDir({ ffmpeg: "#!/bin/sh\n", rec: "#!/bin/sh\n" })
      process.env.PATH = dir
      expect(findRecorder("linux")?.command).toBe("ffmpeg")
      rmSync(dir, { recursive: true })
    })

    test("falls back to sox rec", () => {
      const dir = fakeBinDir({ rec: "#!/bin/sh\n" })
      process.env.PATH = dir
      const spec = findRecorder("linux")
      expect(spec?.command).toBe("rec")
      expect(spec?.buildArgs("/tmp/a.wav")).toEqual(soxArgs("/tmp/a.wav"))
      rmSync(dir, { recursive: true })
    })

    test("returns undefined when no recorder is installed", () => {
      process.env.PATH = mkdtempDir()
      expect(findRecorder("linux")).toBeUndefined()
    })
  })

  describe("buildTranscribeShellCommand", () => {
    test("replaces the {file} placeholder", () => {
      expect(buildTranscribeShellCommand(`whisper -f ${VOICE_FILE_PLACEHOLDER} --txt`, "/tmp/a.wav")).toBe(
        "whisper -f '/tmp/a.wav' --txt",
      )
    })

    test("appends the file when there is no placeholder", () => {
      expect(buildTranscribeShellCommand("whisper", "/tmp/a.wav")).toBe("whisper '/tmp/a.wav'")
    })

    test("quotes paths with spaces and single quotes", () => {
      const shell = buildTranscribeShellCommand("cat", "/tmp/my rec's.wav")
      expect(shell).toBe(`cat '/tmp/my rec'\\''s.wav'`)
    })
  })

  describe("transcribeAudio", () => {
    test("returns the command stdout trimmed", async () => {
      const dir = mkdtempDir()
      const wav = join(dir, "a.wav")
      writeFileSync(wav, "audio")
      const text = await transcribeAudio(wav, "cat {file}")
      expect(text).toBe("audio")
      rmSync(dir, { recursive: true })
    })

    test("rejects when the command fails", () => {
      return expect(transcribeAudio("/tmp/a.wav", "exit 7")).rejects.toThrow("Voice transcription failed")
    })
  })

  describe("shouldDiscardTap", () => {
    test("discards holds shorter than the minimum", () => {
      expect(shouldDiscardTap(VOICE_MIN_HOLD_MS - 1)).toBe(true)
      expect(shouldDiscardTap(0)).toBe(true)
    })

    test("keeps holds at or above the minimum", () => {
      expect(shouldDiscardTap(VOICE_MIN_HOLD_MS)).toBe(false)
      expect(shouldDiscardTap(VOICE_MAX_RECORD_MS)).toBe(false)
    })
  })

  describe("VoiceRecorder", () => {
    const fakeRecorder = "#!/bin/sh\ntouch \"$1\"\nsleep 30\n"

    function listVoiceFiles(): string[] {
      return readdirSync(tmpdir()).filter((name) => name.startsWith("opencode-voice-"))
    }

    async function waitForNewVoiceFile(before: string[]): Promise<string> {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const fresh = listVoiceFiles().find((name) => !before.includes(name))
        if (fresh) return join(tmpdir(), fresh)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("timed out waiting for the recorder to create its file")
    }

    test("starts, stops, and resolves the recorded file", async () => {
      const dir = fakeBinDir({ "fake-rec": fakeRecorder })
      const recorder = new VoiceRecorder()
      const before = listVoiceFiles()
      recorder.start({ command: join(dir, "fake-rec"), buildArgs: (file) => [file] })
      expect(recorder.recording).toBe(true)

      const expected = await waitForNewVoiceFile(before)
      const file = await recorder.stop()
      expect(recorder.recording).toBe(false)
      expect(file).toBe(expected)

      recorder.dispose()
      expect(existsSync(file!)).toBe(false)
      rmSync(dir, { recursive: true })
    })

    test("second start while recording is a no-op", async () => {
      const dir = fakeBinDir({ "fake-rec": fakeRecorder })
      const recorder = new VoiceRecorder()
      const spec = { command: join(dir, "fake-rec"), buildArgs: (file: string) => [file] }
      recorder.start(spec)
      recorder.start(spec)
      expect(recorder.recording).toBe(true)
      recorder.dispose()
      expect(recorder.recording).toBe(false)
      rmSync(dir, { recursive: true })
    })

    test("stop without start resolves undefined", async () => {
      const recorder = new VoiceRecorder()
      expect(await recorder.stop()).toBeUndefined()
    })

    test("failed spawn clears the recording state", async () => {
      const recorder = new VoiceRecorder()
      recorder.start({ command: "opencode-voice-definitely-missing", buildArgs: (file) => [file] })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(recorder.recording).toBe(false)
      expect(await recorder.stop()).toBeUndefined()
    })
  })
})
