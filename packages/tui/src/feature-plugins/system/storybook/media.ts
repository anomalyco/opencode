import { readdirSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { mediaKind, mediaMime, type MediaItem } from "../../../component/media/model"

export function storyMediaItem(file: string, id = `story:${file}`): MediaItem {
  const mime = mediaMime(file) ?? "application/octet-stream"
  return { id, kind: mediaKind(mime), mime, uri: "", name: path.basename(file), path: file }
}

/**
 * The media in a `path.delimiter`-separated list of files and directories, each directory contributing its own files
 * by name. Missing paths and files without a known image or video extension are skipped.
 */
export function parseStoryMedia(value: string, home = os.homedir()) {
  const files = value
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => {
      const resolved = path.resolve(entry.replace(/^~(?=$|[\\/])/, home))
      const stat = statSync(resolved, { throwIfNoEntry: false })
      if (!stat) return []
      if (!stat.isDirectory()) return [resolved]
      return readdirSync(resolved)
        .sort()
        .map((name) => path.join(resolved, name))
        .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile())
    })
    .filter((file) => mediaMime(file))
  return [...new Set(files)].map((file) => storyMediaItem(file))
}

const entries = (process.env.OPENCODE_STORY_MEDIA ?? "").split(path.delimiter).filter(Boolean)

/** The media `OPENCODE_STORY_MEDIA` lists, which replaces a media story's built-in files when it finds any. */
export const storyMedia = entries.length
  ? {
      items: parseStoryMedia(entries.join(path.delimiter)),
      label: `media: ${entries.length === 1 ? entries[0] : `${entries.length} paths`}`,
    }
  : undefined
