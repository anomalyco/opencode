export * as ProjectIcon from "./icon.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { eq } from "drizzle-orm"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import type { EffectDrizzleSqlite } from "../database/drizzle.js"
import { ProjectTable } from "./sql.js"
import type { ProjectSchema } from "./schema.js"

const IMAGES = new Set([".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp"])
const CANDIDATES = [
  "Assets.xcassets/AppIcon.appiconset",
  "ios/App/Assets.xcassets/AppIcon.appiconset",
  ...[
    "assets/app-icon",
    "build/icon",
    "src-tauri/icons/icon",
    "resources/icon",
    "icons/icon",
    "extension/icons/icon",
  ].flatMap((b) => [`${b}.svg`, `${b}.png`]),
  ...["favicon.svg", "icon.svg", "favicon.png", "apple-touch-icon.png", "icon.png", "favicon.ico"].flatMap((f) =>
    ["public/", "app/", "src/app/", "site/public/", ""].map((d) => `${d}${f}`),
  ),
  ...["assets/icon", "assets/logo", "public/logo", "logo"].flatMap((b) => [`${b}.svg`, `${b}.png`]),
]
const composer = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      groups: Schema.Array(
        Schema.Struct({ layers: Schema.Array(Schema.Struct({ "image-name": Schema.optional(Schema.String) })) }),
      ),
      fill: Schema.optional(
        Schema.Struct({
          solid: Schema.optional(Schema.String),
          "linear-gradient": Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
)

export const refresh = Effect.fn("ProjectIcon.refresh")(function* (
  fs: FSUtil.Interface,
  db: EffectDrizzleSqlite.EffectSQLiteDatabase,
  id: ProjectSchema.ID,
) {
  const project = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get()
  if (!project || id === "global") return
  const image = yield* discover(fs, project.worktree)
  if (!image || (project.icon_url && Hash.fast(project.icon_url) === Hash.fast(image.url))) return
  return yield* db.update(ProjectTable).set({ icon_url: image.url }).where(eq(ProjectTable.id, id)).returning().get()
})

export const discover = Effect.fn("ProjectIcon.discover")(function* (fs: FSUtil.Interface, directory: string) {
  const root = yield* fs.realPath(directory)
  const children = yield* fs.readDirectoryEntries(root).pipe(Effect.orElseSucceed(() => []))
  const catalogs = children
    .filter((e) => e.type === "directory" && !e.name.startsWith("."))
    .map((e) => e.name)
    .toSorted()
    .slice(0, 128)
    .map((name) => `${name}/Assets.xcassets/AppIcon.appiconset`)
  // Prefer flattened icons: a small Composer layer may be only a glow beneath an oversized foreground.
  for (const name of [
    ...CANDIDATES,
    "AppIcon.icon",
    "app/AppIcon.icon",
    "assets/AppIcon.icon",
    ...catalogs,
    "resources/windows",
  ]) {
    const candidate = yield* fs.realPath(path.join(root, name)).pipe(Effect.orElseSucceed(() => undefined))
    if (!candidate || candidate === root || !FSUtil.contains(root, candidate)) continue
    if (name.endsWith(".icon")) {
      const manifest = yield* read(fs, root, path.join(candidate, "icon.json"), new Set([".json"]))
      const config = manifest ? Option.getOrUndefined(composer(manifest.bytes.toString("utf8"))) : undefined
      for (const layer of config?.groups.flatMap((group) => group.layers) ?? []) {
        if (!layer["image-name"]) continue
        const image = yield* read(
          fs,
          root,
          path.join(candidate, "Assets", layer["image-name"]),
          new Set([".svg", ".png"]),
        )
        if (!image) continue
        const plain = dataURL(image.file, image.bytes)
        const url = image.file.endsWith(".svg") ? backdrop(plain, config?.fill) : plain
        if (url.length <= 64 * 1024) return { path: path.relative(root, image.file), url }
        if (plain.length <= 64 * 1024) return { path: path.relative(root, image.file), url: plain }
      }
      continue
    }
    const windows = name === "resources/windows"
    const entries =
      name.endsWith(".appiconset") || windows
        ? yield* fs.readDirectoryEntries(candidate).pipe(Effect.orElseSucceed(() => []))
        : undefined
    const rank = (file: string) =>
      windows ? Math.abs(Number(file.match(/^icon-(\d+)\.png$/i)?.[1]) - 128) : /128|256/.test(file) ? 0 : 1
    const files = entries
      ?.flatMap((e) =>
        e.type === "file" &&
        (windows ? /^icon-\d+\.png$/i.test(e.name) : IMAGES.has(path.extname(e.name).toLowerCase()))
          ? [e.name]
          : [],
      )
      .toSorted()
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 128)
      .map((file) => path.join(candidate, file)) ?? [candidate]
    for (const file of files) {
      const image = yield* read(fs, root, file, IMAGES)
      if (!image) continue
      const url = dataURL(image.file, image.bytes)
      if (url.length <= 64 * 1024) return { path: path.relative(root, image.file), url }
    }
  }
})

const read = Effect.fn("ProjectIcon.read")(
  function* (fs: FSUtil.Interface, root: string, name: string, extensions: ReadonlySet<string>) {
    const file = yield* fs.realPath(name)
    if (file === root || !FSUtil.contains(root, file) || !extensions.has(path.extname(file).toLowerCase())) return
    const info = yield* fs.stat(file)
    if (info.type !== "File" || !Number(info.size) || Number(info.size) > 64 * 1024) return
    const bytes = yield* fs.readFile(file)
    if (bytes.byteLength && bytes.byteLength <= 64 * 1024) return { file, bytes: Buffer.from(bytes) }
  },
  Effect.orElseSucceed(() => undefined),
)

function dataURL(file: string, bytes: Buffer) {
  const mime = path.extname(file).toLowerCase() === ".ico" ? "image/x-icon" : FSUtil.mimeType(file)
  return `data:${mime};base64,${bytes.toString("base64")}`
}

function backdrop(url: string, fill: { solid?: string; "linear-gradient"?: ReadonlyArray<string> } | undefined) {
  const colors = (fill?.solid ? [fill.solid] : (fill?.["linear-gradient"] ?? [])).map((color) => {
    const match = /^(gray|srgb|display-p3):([\d.,]+)$/.exec(color)
    const values = match?.[2]?.split(",").map(Number) ?? []
    if (
      !match ||
      values.length !== (match[1] === "gray" ? 2 : 4) ||
      values.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    )
      return
    const rgb = match[1] === "gray" ? [values[0], values[0], values[0]] : values.slice(0, 3)
    return `color(${match[1] === "display-p3" ? "display-p3" : "srgb"} ${rgb.join(" ")} / ${values.at(-1)})`
  })
  if (!colors.length || colors.some((color) => !color)) return url
  const gradient =
    colors.length > 1
      ? `<defs><linearGradient id="bg" x2="0" y2="1">${colors.map((color, i) => `<stop offset="${i / (colors.length - 1)}" stop-color="${color}"/>`).join("")}</linearGradient></defs>`
      : ""
  // Embed the layer as an image, never as SVG markup: its content stays in an inert image document.
  return dataURL(
    "icon.svg",
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${gradient}<rect width="128" height="128" rx="28" fill="${colors.length > 1 ? "url(#bg)" : colors[0]}"/><image width="128" height="128" href="${url}"/></svg>`,
    ),
  )
}
