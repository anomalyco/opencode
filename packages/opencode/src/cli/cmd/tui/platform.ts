import type { CliRenderer } from "@opentui/core"
import type { TuiPlatform } from "@opencode-ai/tui/platform"
import { Filesystem } from "@/util/filesystem"
import { Clipboard } from "./util/clipboard"
import { Editor } from "./util/editor"

export function createLegacyTuiPlatform(renderer: CliRenderer): TuiPlatform {
  return {
    files: {
      readText: Filesystem.readText,
      readBytes: Filesystem.readBytes,
      mime: Filesystem.mimeType,
    },
    clipboard: {
      read: Clipboard.read,
      write: Clipboard.copy,
    },
    editor: {
      open: (input) => Editor.open({ ...input, renderer }),
    },
    export: {
      write: Filesystem.write,
    },
  }
}
