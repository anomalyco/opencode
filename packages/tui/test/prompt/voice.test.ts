import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  VoiceRecorder,
  buildTranscribeShellCommand,
  ffmpegArgs,
  findRecorder,
  isRepeatPress,
  shouldDiscardTap,
  soxArgs,
  transcribeAudio,
  VOICE_FILE_PLACEHOLDER,
  VOICE_MAX_RECORD_MS,
  VOICE_MIN_HOLD_MS,
  VOICE_REPEAT_GUARD_MS,
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

    test("uses dshow with the enumerated device on win32", () => {
      const args = ffmpegArgs("win32", "/tmp/a.wav", "Microphone (Realtek Audio)")
      expect(args).toContain("dshow")
      expect(args).toContain("audio=Microphone (Realtek Audio)")
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
    test("prefers ffmpeg over rec", async () => {
      const dir = fakeBinDir({ ffmpeg: "#!/bin/sh\n", rec: "#!/bin/sh\n" })
      process.env.PATH = dir
      expect((await findRecorder("linux"))?.command).toBe("ffmpeg")
      rmSync(dir, { recursive: true })
    })

    test("falls back to sox rec", async () => {
      const dir = fakeBinDir({ rec: "#!/bin/sh\n" })
      process.env.PATH = dir
      const spec = await findRecorder("linux")
      expect(spec?.command).toBe("rec")
      expect(spec?.buildArgs("/tmp/a.wav")).toEqual(soxArgs("/tmp/a.wav"))
      rmSync(dir, { recursive: true })
    })

    test("returns undefined when no recorder is installed", async () => {
      process.env.PATH = mkdtempDir()
      expect(await findRecorder("linux")).toBeUndefined()
    })

    test("enumerates a dshow audio device on win32", async () => {
      const dir = fakeBinDir({
        ffmpeg: `#!/bin/sh\necho '[dshow @ x] DirectShow video devices:' >&2\necho '[dshow @ x] "Integrated Camera"' >&2\necho '[dshow @ x] DirectShow audio devices (some may be both video and audio devices):' >&2\necho '[dshow @ x]  0 "Microphone (Realtek Audio)"' >&2\n`,
      })
      // Prepend: spawn() resolves "ffmpeg" through the child PATH, so the
      // fake dir must sit in front of the real one rather than replace it.
      process.env.PATH = `${dir}:${process.env.PATH}`
      const spec = await findRecorder("win32")
      expect(spec?.command).toBe("ffmpeg")
      expect(spec?.buildArgs("/tmp/a.wav")).toContain("audio=Microphone (Realtek Audio)")
      process.env.PATH = originalPath
      rmSync(dir, { recursive: true })
    })

    test("falls back to rec when dshow lists no audio device", async () => {
      const dir = fakeBinDir({ ffmpeg: "#!/bin/sh\n", rec: "#!/bin/sh\n" })
      process.env.PATH = `${dir}:${process.env.PATH}`
      expect((await findRecorder("win32"))?.command).toBe("rec")
      process.env.PATH = originalPath
      rmSync(dir, { recursive: true })
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

  describe("isRepeatPress", () => {
    test("treats a press right after the previous one as key repeat", () => {
      expect(isRepeatPress(33)).toBe(true)
      expect(isRepeatPress(VOICE_REPEAT_GUARD_MS - 1)).toBe(true)
    })

    test("treats a press after a quiet gap as a fresh press", () => {
      expect(isRepeatPress(VOICE_REPEAT_GUARD_MS)).toBe(false)
      expect(isRepeatPress(60_000)).toBe(false)
    })

    test("honors the terminal's repeat marker regardless of timing", () => {
      expect(isRepeatPress(60_000, true)).toBe(true)
      expect(isRepeatPress(60_000, false)).toBe(false)
    })

    test("a held key chains: each repeat restarts the window", () => {
      // First press at 0, OS initial delay 660ms, then repeats every 33ms.
      const presses = [0, 660, 693, 726, 759]
      const results = presses.map((now, index) => (index === 0 ? false : isRepeatPress(now - presses[index - 1]!)))
      expect(results).toEqual([false, true, true, true, true])
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
    // Foreground sleep would delay the INT trap until it finishes; backgrounding
    // it lets the trap exit immediately so stop() resolves without the SIGKILL
    // fallback.
    const fakeRecorder = "#!/bin/sh\ntrap 'exit 0' INT\ntouch \"$1\"\nsleep 30 & wait\n"

    function listVoiceFiles(dir: string): string[] {
      return readdirSync(dir).filter((name) => name.startsWith("opencode-voice-"))
    }

    async function waitForNewVoiceFile(dir: string, before: string[]): Promise<string> {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const fresh = listVoiceFiles(dir).find((name) => !before.includes(name))
        if (fresh) return join(dir, fresh)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("timed out waiting for the recorder to create its file")
    }

    test("starts, stops, and resolves the recorded file", async () => {
      const dir = fakeBinDir({ "fake-rec": fakeRecorder })
      const recordings = mkdtempDir()
      const recorder = new VoiceRecorder(recordings)
      const before = listVoiceFiles(recordings)
      recorder.start({ command: join(dir, "fake-rec"), buildArgs: (file) => [file] })
      expect(recorder.recording).toBe(true)

      const expected = await waitForNewVoiceFile(recordings, before)
      const file = await recorder.stop()
      expect(recorder.recording).toBe(false)
      expect(file).toBe(expected)

      recorder.dispose()
      expect(existsSync(file!)).toBe(false)
      rmSync(dir, { recursive: true })
      rmSync(recordings, { recursive: true })
    })

    test("second start while recording is a no-op", async () => {
      const dir = fakeBinDir({ "fake-rec": fakeRecorder })
      const recordings = mkdtempDir()
      const recorder = new VoiceRecorder(recordings)
      const spec = { command: join(dir, "fake-rec"), buildArgs: (file: string) => [file] }
      recorder.start(spec)
      recorder.start(spec)
      expect(recorder.recording).toBe(true)
      recorder.dispose()
      expect(recorder.recording).toBe(false)
      rmSync(dir, { recursive: true })
      rmSync(recordings, { recursive: true })
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

    test("notifies onFailure when spawn fails", async () => {
      const recorder = new VoiceRecorder()
      let failures = 0
      recorder.start({ command: "opencode-voice-definitely-missing", buildArgs: (file) => [file] }, () => {
        failures += 1
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(recorder.recording).toBe(false)
      expect(failures).toBe(1)
    })

    test("notifies onFailure when the recorder exits on its own", async () => {
      const dir = fakeBinDir({ "fake-rec": "#!/bin/sh\nexit 3\n" })
      const recorder = new VoiceRecorder()
      let failures = 0
      recorder.start({ command: join(dir, "fake-rec"), buildArgs: (file) => [file] }, () => {
        failures += 1
      })
      const deadline = Date.now() + 5000
      while (recorder.recording && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(recorder.recording).toBe(false)
      expect(failures).toBe(1)
      expect(await recorder.stop()).toBeUndefined()
      rmSync(dir, { recursive: true })
    })

    test("does not notify onFailure on normal stop", async () => {
      const dir = fakeBinDir({ "fake-rec": fakeRecorder })
      const recordings = mkdtempDir()
      const recorder = new VoiceRecorder(recordings)
      let failures = 0
      const before = listVoiceFiles(recordings)
      recorder.start({ command: join(dir, "fake-rec"), buildArgs: (file) => [file] }, () => {
        failures += 1
      })
      const file = await waitForNewVoiceFile(recordings, before).then(() => recorder.stop())
      expect(file).not.toBeUndefined()
      expect(failures).toBe(0)
      recorder.dispose()
      rmSync(dir, { recursive: true })
      rmSync(recordings, { recursive: true })
    })
  })
})
