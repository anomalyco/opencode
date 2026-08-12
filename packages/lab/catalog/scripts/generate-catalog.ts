import { Effect, Schema } from "effect"
import { compileCatalog } from "../catalog/authoring"
import { definition } from "../catalog/authored"
import { CatalogBoundaryError, DriveManifest, FrameArtifact, type Frame } from "../catalog/schema"

const manifestFile = new URL("../public/drive-captures.json", import.meta.url)
const catalogFile = new URL("../public/catalog.json", import.meta.url)

const readManifest = Effect.fn("Catalog.readManifest")(function*() {
  const json = yield* Effect.tryPromise({
    try: () => Bun.file(manifestFile).text(),
    catch: (cause) => new CatalogBoundaryError({ boundary: "drive-captures.json", cause }),
  })
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DriveManifest), {
    errors: "all",
    onExcessProperty: "error",
  })(json).pipe(
    Effect.mapError(
      (cause) => new CatalogBoundaryError({ boundary: "drive-captures.json", cause }),
    ),
  )
})

const validateCapture = Effect.fn("Catalog.validateCapture")(function*(
  frame: Frame,
) {
  const json = yield* Effect.tryPromise({
    try: async () => {
      const file = Bun.file(new URL(`../public/${frame.src}`, import.meta.url))
      if (!(await file.exists())) throw new Error(`Missing terminal frame ${frame.src}`)
      return file.text()
    },
    catch: (cause) => new CatalogBoundaryError({ boundary: frame.src, cause }),
  })
  const artifact = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(FrameArtifact), {
    errors: "all",
    onExcessProperty: "error",
  })(json).pipe(
    Effect.mapError((cause) => new CatalogBoundaryError({ boundary: frame.src, cause })),
  )
  if (artifact.cols !== frame.cols || artifact.rows !== frame.rows) {
    return yield* new CatalogBoundaryError({
      boundary: frame.src,
      cause: new Error(
        `Terminal frame is ${artifact.cols}x${artifact.rows}; expected ${frame.cols}x${frame.rows}`,
      ),
    })
  }
  if (artifact.lines.length !== artifact.rows) {
    return yield* new CatalogBoundaryError({
      boundary: frame.src,
      cause: new Error(`Terminal frame has ${artifact.lines.length} lines; expected ${artifact.rows}`),
    })
  }
  for (const [row, line] of artifact.lines.entries()) {
    const width = line.spans.reduce((total, span) => total + span.width, 0)
    if (width !== artifact.cols) {
      return yield* new CatalogBoundaryError({
        boundary: frame.src,
        cause: new Error(`Terminal frame row ${row} is ${width} cells wide; expected ${artifact.cols}`),
      })
    }
  }
})

const program = Effect.gen(function*() {
  const manifest = yield* readManifest()
  yield* Effect.forEach(manifest.captures.flatMap((capture) => capture.frames), validateCapture, {
    concurrency: "unbounded",
    discard: true,
  })
  const catalog = yield* compileCatalog(definition, manifest)
  yield* Effect.tryPromise({
    try: () => Bun.write(catalogFile, `${JSON.stringify(catalog, undefined, 2)}\n`),
    catch: (cause) => new CatalogBoundaryError({ boundary: "catalog.json", cause }),
  })
})

await Effect.runPromise(program)
