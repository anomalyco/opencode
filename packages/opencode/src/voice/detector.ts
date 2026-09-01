import { execSync } from "child_process"

export interface HardwareAudioStatus {
  available: boolean
  platform: NodeJS.Platform
  deviceName?: string
  driver: "alsa" | "pulse" | "pipewire" | "coreaudio" | "wasapi" | "directshow" | "unavailable"
  tools: string[]
}

export class HardwareAudioDetector {
  public static detect(): HardwareAudioStatus {
    const platform = process.platform
    const tools: string[] = []

    // 1. Detect available CLI recording binaries on system PATH
    const checkTool = (tool: string) => {
      try {
        const cmd = platform === "win32" ? `where ${tool}` : `which ${tool}`
        execSync(cmd, { stdio: "ignore" })
        tools.push(tool)
        return true
      } catch {
        return false
      }
    }

    checkTool("ffmpeg")
    checkTool("sox")

    if (platform === "linux") {
      checkTool("arecord")
      checkTool("pactl")
      checkTool("wpctl")

      // Check ALSA / PipeWire / PulseAudio microphone hardware
      try {
        const alsaOutput = execSync("arecord -l 2>/dev/null", { encoding: "utf8" })
        const match = alsaOutput.match(/card \d+: ([^,]+)/)
        if (match && match[1]) {
          return {
            available: true,
            platform,
            deviceName: match[1].trim(),
            driver: "alsa",
            tools,
          }
        }
      } catch {}

      try {
        const pactlOutput = execSync("pactl list sources short 2>/dev/null", { encoding: "utf8" })
        if (pactlOutput.trim().length > 0) {
          return {
            available: true,
            platform,
            deviceName: "Default PulseAudio/PipeWire Source",
            driver: "pulse",
            tools,
          }
        }
      } catch {}

      return {
        available: tools.includes("arecord") || tools.includes("ffmpeg") || tools.includes("sox"),
        platform,
        driver: "alsa",
        tools,
      }
    }

    if (platform === "darwin") {
      checkTool("rec")
      try {
        const macAudio = execSync("system_profiler SPAudioDataType 2>/dev/null", { encoding: "utf8" })
        const hasInput = macAudio.includes("Input Source") || macAudio.includes("Built-in Microphone") || macAudio.includes("Microphone")
        return {
          available: hasInput || tools.includes("rec") || tools.includes("sox") || tools.includes("ffmpeg"),
          platform,
          deviceName: hasInput ? "CoreAudio Microphone" : undefined,
          driver: "coreaudio",
          tools,
        }
      } catch {
        return {
          available: tools.includes("rec") || tools.includes("sox") || tools.includes("ffmpeg"),
          platform,
          driver: "coreaudio",
          tools,
        }
      }
    }

    if (platform === "win32") {
      try {
        const winAudio = execSync(
          'powershell.exe -NoProfile -Command "Get-PnpDevice -Class AudioEndpoint -Status OK | Select-Object -ExpandProperty FriendlyName"',
          { encoding: "utf8" }
        )
        const lines = winAudio.split("\n").map((l) => l.trim()).filter(Boolean)
        const mic = lines.find((l) => l.toLowerCase().includes("mic") || l.toLowerCase().includes("audio"))
        return {
          available: lines.length > 0,
          platform,
          deviceName: mic ?? lines[0],
          driver: "wasapi",
          tools,
        }
      } catch {
        return {
          available: tools.includes("ffmpeg"),
          platform,
          driver: "directshow",
          tools,
        }
      }
    }

    return {
      available: false,
      platform,
      driver: "unavailable",
      tools,
    }
  }
}
