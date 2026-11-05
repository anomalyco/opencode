import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { FileMedia } from "../src/components/file-media"
import type { PresentationFileContent } from "../src/file-presentation"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII="

const [read, setRead] = createSignal<() => Promise<PresentationFileContent | undefined>>(() =>
  Promise.resolve({ type: "binary", content: png, encoding: "base64", mimeType: "image/png" }),
)

export const controls = {
  /** New media options re-read the same file, as a diff or comment refresh does. Settles once the read has failed. */
  refreshFailing: () =>
    new Promise<void>((settled) =>
      setRead(() => () => {
        const failed = Promise.reject(new Error("read failed"))
        // The viewer handles the rejection in microtasks; the next task runs after it.
        failed.catch(() => setTimeout(settled))

        return failed
      }),
    ),
}

/** A remote image whose first read succeeds. */
export function mountFileMedia() {
  const host = document.createElement("div")
  host.dataset.testid = "file-media-fixture"
  document.body.appendChild(host)
  render(
    () => (
      <FileMedia
        media={{ mode: "auto", path: "diagram.png", readFile: read() }}
        fallback={() => <div>fallback</div>}
      />
    ),
    host,
  )
}
