import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import manifest from "../src/component/site/media-manifest.json"
import sources from "../src/component/site/media-sources.json"
import { mediaFile } from "../src/lib/media"

const publicDir = path.join(import.meta.dir, "../public")
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)

// media-manifest.json (media.tsx) is made next to the checkout by media-opt/manifest.py from the
// originals it encoded. These keep it honest where the media files are present.
describe("media manifest", () => {
  const originals = [...Object.keys(manifest.video), ...Object.keys(manifest.image)]

  test("every original has a recorded hash", () => {
    expect(originals.filter((src) => !(src in sources))).toEqual([])
  })

  // A re-rendered original would keep serving copies of the old footage: re-run encode.py or
  // images.py, then manifest.py (or delete its entry to fall back to the new original).
  test("no original changed since its copies were made", () => {
    const changed = originals.filter((src) => {
      const file = path.join(publicDir, src)
      return existsSync(file) && hash(file) !== sources[src as keyof typeof sources]
    })
    expect(changed).toEqual([])
  })

  // The names media.tsx builds: /media/<base>.<width>.<codec>.<hash>.mp4 and <base>.<width>.<hash>.<format>.
  test("every copy exists and is named by its own hash", () => {
    const base = (src: string) => src.replace(/^\/(product-videos\/)?/, "").replace(/\.\w+$/, "")
    const files = [
      ...Object.entries(manifest.video).flatMap(([src, rows]) =>
        rows.map((row) => ({ file: `${base(src)}.${row[0]}.${row[1]}.${row[2]}.mp4`, hash: String(row[2]) })),
      ),
      ...Object.entries(manifest.image).flatMap(([src, formats]) =>
        Object.entries(formats).flatMap(([format, rows]) =>
          rows.map((row) => ({ file: `${base(src)}.${row[0]}.${row[1]}.${format}`, hash: String(row[1]) })),
        ),
      ),
    ]
    // Only where the media are present (they are not in Git).
    if (!existsSync(path.join(publicDir, "media"))) return
    const wrong = files.filter((item) => {
      const full = path.join(publicDir, "media", item.file)
      // Videos live on the media CDN (src/lib/media.ts), so a checkout without them skips those.
      if (!existsSync(full)) return !mediaFile.test(item.file)
      return createHash("sha256").update(readFileSync(full)).digest("hex").slice(0, 8) !== item.hash
    })
    expect(wrong).toEqual([])
  })
})
