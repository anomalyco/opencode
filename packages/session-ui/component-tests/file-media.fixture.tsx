import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { FileMedia } from "../src/components/file-media"
import type { PresentationFileContent } from "../src/file-presentation"

// A 160x96 picture, large enough to see in a screenshot.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAABgCAYAAACaJ3mZAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAMuSURBVHhe7dK7jRwxEADRC0y5KhOFI1u2nD1AwMqo/Q3ZJJufMp6zd9NsztTX7z9/b1KWL/4gjWSASmWASmWASmWASmWASmWASmWASmWASmWASmWASmWASmWAh7r9+vERn+nBAA/E0N7hs60Z4EEYVwnOasUAD8KoSnBWKwZ4CAZVgzNbMMADMKQIzo4ywAMwogjOjjLAAzCiCM6OMsADMKIIzo4ywM0xoCjOjzLAAzCiCM6OMsADMKIIzo4ywAMwogjOjjLAAzCiCM6OMsBDMKQanNmCAR6EQZXgrFYM8CCMqgRntWKAB2Jc7/DZ1gzwUAztGT7TgwEqlQEqlQEqlQEqlQEqlQEqlQEqlQEqlQEq1TYBfv28/cPfNbctArzHZ4TrWT5AxmeEa1k6QEb3DJ/RXJYNkKG9w2c1jyUDZGBXcIbmsFyADKsU5ynXUgEyplqcqzzLBMiIojhfOY4N8I7naKwlAmQ0rfG8Xaxwv+kDZCy98NyV8W4z32/qAPkSR+AOq+F9Zr/btAHy5Y3EXVbAO7zC57JNGSBfWgbuNDPu/gmfzzRdgHxZ2bjfTLhrCc7KMlWAfEmz4J4z4I41ODPDNAHy5cyG+2bhXhGcncEAC3HvkbhLCzxjtCkC5EuZHffvjee3xvNGSg+QL2MVvEcvPLcXnjtKaoB8CSvinVrhOSNwhxHSAuTlV8a7RXH+SNylt5QAeekd8I41ODML9+ppeIC87G5436s4Jxv362VogLzkrnjvd/jsLLhnL8MC5AV3x/s/w2dmw317GBIgL3YSvovV3gd3b80AB1j9XfB7ttQ9QF5Ga+J3baVrgLyE1sbv20K3ALm89sDvHNUlQC6tffBbRzUPkAtrP/zmEU0D5KLaF799rWYBckHtjw3UaBIgF9M52EIpA1QYeygRDpDL6Ezs4qpQgFxCZ2MfV1QHyMMlNnJFVYA8WLpjK58UB8gDJWIz7xQFyIOkV9jOK5cD5AHSJ2zomUsBcrB0FVsiA1R37KkoQA6TarCrSwFyiFSLbX0MkAOkKDb2MkA+KLXy0NrDD08eklp6GSD/UerlIUD+g9Tb/wD5B2mUb+KUZjdSnrb+AAAAAElFTkSuQmCC"

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
      <FileMedia media={{ mode: "auto", path: "diagram.png", readFile: read() }} fallback={() => <div>fallback</div>} />
    ),
    host,
  )
}
