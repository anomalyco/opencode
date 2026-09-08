import { Uint8ArrayWriter, TextReader, ZipWriter } from "@zip.js/zip.js"

export async function extensionArchive(
  input: {
    id?: string
    version?: string
    renderer?: string
    main?: string
    files?: Record<string, string>
    manifest?: Record<string, unknown>
  } = {},
) {
  const id = input.id ?? "test.lifecycle"
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(
    "manifest.json",
    new TextReader(
      JSON.stringify({
        schema: "opencode.desktop/1",
        id,
        name: "File utilities",
        version: input.version ?? "1.0.0",
        entry: "renderer.cjs",
        imports: ["@opencode/plugin/desktop"],
        ...(input.main
          ? { main: "main.cjs", mainImports: ["@opencode/plugin/desktop/main", "@opencode/schema/rpc", "effect"] }
          : {}),
        ...input.manifest,
      }),
    ),
  )
  await writer.add(
    "renderer.cjs",
    new TextReader(input.renderer ?? `module.exports.default = { id: ${JSON.stringify(id)}, setup() {} }`),
  )
  if (input.main) await writer.add("main.cjs", new TextReader(input.main))
  for (const [name, text] of Object.entries(input.files ?? {})) await writer.add(name, new TextReader(text))
  return writer.close()
}
