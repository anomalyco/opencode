import { spawn, type ChildProcess } from "child_process"
import which from "which"

export class MicCapture {
  private proc: ChildProcess | null = null

  onData: ((pcm: Buffer) => void) | null = null
  onError: ((err: Error) => void) | null = null

  get recording(): boolean {
    return this.proc !== null && !this.proc.killed
  }

  async start(): Promise<void> {
    if (this.proc) return

    const cmd = await MicCapture.findCommand()
    if (!cmd) {
      throw new Error("sox not found. Install it: brew install sox (macOS) / apt install sox (Linux)")
    }

    // Capture at device native rate, resample to 16kHz via the "rate" effect.
    // Don't pass -r 16000 — on macOS CoreAudio it tries to set the device to
    // 16kHz, fails, falls back to 48kHz, and outputs 48kHz raw PCM.
    // The "rate 16000" effect after "-" does the actual resampling.
    const args =
      cmd === "rec"
        ? ["-q", "-t", "raw", "-b", "16", "-c", "1", "-e", "signed-integer", "-", "rate", "16000"]
        : ["-d", "-q", "-t", "raw", "-b", "16", "-c", "1", "-e", "signed-integer", "-", "rate", "16000"]

    this.proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.onData?.(chunk)
    })

    this.proc.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString().trim()
      // sox emits WARN about sample rate when resampling — expected, not an error
      if (msg && !msg.includes("WARN") && !msg.includes("can't set sample rate")) {
        this.onError?.(new Error(`mic: ${msg}`))
      }
    })

    this.proc.on("error", (err) => {
      this.onError?.(err)
      this.proc = null
    })

    this.proc.on("exit", () => {
      this.proc = null
    })
  }

  stop(): void {
    if (!this.proc) return
    try {
      this.proc.kill("SIGTERM")
    } catch {}
    this.proc = null
  }

  private static async findCommand(): Promise<string | null> {
    for (const cmd of ["rec", "sox"]) {
      try {
        await which(cmd)
        return cmd
      } catch {}
    }
    return null
  }

  static async available(): Promise<boolean> {
    return (await MicCapture.findCommand()) !== null
  }
}
