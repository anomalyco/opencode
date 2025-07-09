import { Config } from "../config/config"
import { Log } from "../util/log"
import { spawn } from "child_process"
import { platform } from "os"

export namespace Audio {
  const log = Log.create({ service: "audio" })

  export async function playTokenProcessingSound(): Promise<void> {
    try {
      const config = await Config.get()

      if (!config.audio?.enabled) {
        return
      }

      const sound = config.audio.token_processing_sound || "system"
      const volume = config.audio.volume ?? 0.5

      log.info("playing token processing sound", { sound, volume })

      if (sound === "system") {
        await playSystemBeep()
      } else if (sound.startsWith("http://") || sound.startsWith("https://")) {
        await playUrlSound(sound, volume)
      } else {
        await playFileSound(sound, volume)
      }
    } catch (error) {
      log.error("failed to play token processing sound", { error })
      // Fallback to system beep if config fails
      try {
        await playSystemBeep()
      } catch (fallbackError) {
        log.error("fallback system beep also failed", { error: fallbackError })
      }
    }
  }

  async function playSystemBeep(): Promise<void> {
    const currentPlatform = platform()

    switch (currentPlatform) {
      case "darwin":
        await executeCommand("afplay", ["/System/Library/Sounds/Ping.aiff"])
        break
      case "linux":
        await executeCommand("paplay", ["/usr/share/sounds/alsa/Front_Left.wav"])
          .catch(() => executeCommand("aplay", ["/usr/share/sounds/alsa/Front_Left.wav"]))
          .catch(() => executeCommand("speaker-test", ["-t", "sine", "-f", "1000", "-l", "1"]))
          .catch(() => log.warn("no audio system found on linux"))
        break
      case "win32":
        await executeCommand("powershell", ["-c", "[console]::beep(800,200)"])
        break
      default:
        log.warn("unsupported platform for system beep", { platform: currentPlatform })
    }
  }

  async function playFileSound(filePath: string, volume: number): Promise<void> {
    const currentPlatform = platform()

    switch (currentPlatform) {
      case "darwin":
        await executeCommand("afplay", ["-v", volume.toString(), filePath])
        break
      case "linux":
        await executeCommand("paplay", ["--volume", Math.floor(volume * 65536).toString(), filePath]).catch(() =>
          executeCommand("aplay", [filePath]),
        )
        break
      case "win32":
        await executeCommand("powershell", [
          "-c",
          `Add-Type -AssemblyName presentationCore; $mediaPlayer = New-Object system.windows.media.mediaplayer; $mediaPlayer.volume = ${volume}; $mediaPlayer.open('${filePath}'); $mediaPlayer.play(); Start-Sleep 2; $mediaPlayer.close()`,
        ])
        break
      default:
        log.warn("unsupported platform for file sound", { platform: currentPlatform })
    }
  }

  async function playUrlSound(url: string, volume: number): Promise<void> {
    log.info("url sound playback not implemented yet", { url, volume })
  }

  function executeCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { stdio: "ignore" })

      process.on("close", (code) => {
        if (code === 0) {
          resolve()
        } else {
          const error = new Error(`Command failed with code ${code}: ${command} ${args.join(" ")}`)
          reject(error)
        }
      })

      process.on("error", (error) => {
        reject(error)
      })
    })
  }
}
