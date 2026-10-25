import { fileURLToPath } from "url"

await Bun.write(
  fileURLToPath(new URL("../public/openapi.json", import.meta.url)),
  Bun.file(fileURLToPath(new URL("../../../packages/protocol/openapi.json", import.meta.url))),
)
