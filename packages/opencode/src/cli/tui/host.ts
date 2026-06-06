import type { TuiHost, TuiInput } from "@opencode-ai/tui"
import { Log } from "@opencode-ai/core/util/log"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { createTuiAttention } from "./attention"
import { createLegacyTuiPlatform } from "./platform"
import * as TuiAudio from "./audio"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "./win32"

export function createLegacyTuiHost(renderer: TuiInput["renderer"]): TuiHost {
  return {
    platform: createLegacyTuiPlatform(renderer),
    attention: createTuiAttention,
    logger: Log.Default,
    disposeAudio: TuiAudio.dispose,
    formatError: FormatError,
    formatUnknownError: FormatUnknownError,
    lifecycle: {
      prepare() {
        const unguard = win32InstallCtrlCGuard()
        win32DisableProcessedInput()
        return unguard
      },
      flushInput: win32FlushInputBuffer,
      onSighup(handler) {
        process.on("SIGHUP", handler)
        return () => process.off("SIGHUP", handler)
      },
      writeStdout: (text) => process.stdout.write(text),
      writeStderr: (text) => process.stderr.write(text),
      suspend(resume) {
        process.once("SIGCONT", resume)
        process.kill(0, "SIGTSTP")
      },
    },
  }
}
