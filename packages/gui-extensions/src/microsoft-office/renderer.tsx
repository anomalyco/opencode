import { lazy, Suspense, type Component } from "solid-js"
import { Loader } from "@opencode/ui/loader"
import type { ArtifactKind } from "@opencode/util/artifact"
import { FileViewer, type FileViewerProps } from "../file/contract"
import { bindExtension, type Setup } from "../sdk"
import type MicrosoftOffice from "./index"

/** Every Office Open XML file is a zip archive. */
const zip = [0x50, 0x4b, 0x03, 0x04]

/** A Compound File: an encrypted Office file, or one saved in the binary .doc, .xls or .ppt formats. */
const compound = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

const setup: Setup<typeof MicrosoftOffice> = (ctx) => {
  // Each format loads its engine, several megabytes of wasm, only when a file of that format opens. Nothing preloads:
  // most sessions never open an Office file.
  const viewer = (kind: ArtifactKind, View: Component<FileViewerProps>) =>
    ctx.add(FileViewer, {
      kinds: [kind],
      // Bytes no engine can open fail here, before their viewer and its engine download.
      problem: (bytes) => {
        if (startsWith(bytes, zip)) return undefined

        return ctx.t(startsWith(bytes, compound) ? "problem.compound" : "problem.format")
      },
      View: bindExtension((props: FileViewerProps) => (
        <Suspense
          fallback={
            <div class="flex min-h-0 flex-1 items-center justify-center">
              <Loader />
            </div>
          }
        >
          <View {...props} />
        </Suspense>
      )),
    })

  viewer(
    "document",
    lazy(() => import("./document")),
  )
  viewer(
    "spreadsheet",
    lazy(() => import("./spreadsheet")),
  )
  viewer(
    "presentation",
    lazy(() => import("./presentation")),
  )
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

export default setup
