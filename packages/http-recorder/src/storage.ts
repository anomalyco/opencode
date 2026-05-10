import { Option } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { encodeCassette, decodeCassette, type Cassette, type CassetteMetadata, type Interaction } from "./schema"

export const DEFAULT_RECORDINGS_DIR = path.resolve(process.cwd(), "test", "fixtures", "recordings")

export const cassettePath = (name: string, directory = DEFAULT_RECORDINGS_DIR) => path.join(directory, `${name}.json`)

export const metadataFor = (name: string, metadata: CassetteMetadata | undefined): CassetteMetadata => ({
  name,
  recordedAt: new Date().toISOString(),
  ...(metadata ?? {}),
})

export const cassetteFor = (
  name: string,
  interactions: ReadonlyArray<Interaction>,
  metadata: CassetteMetadata | undefined,
): Cassette => ({
  version: 1,
  metadata: metadataFor(name, metadata),
  interactions,
})

export const formatCassette = (cassette: Cassette) => `${JSON.stringify(encodeCassette(cassette), null, 2)}\n`

export const parseCassette = (raw: string) => decodeCassette(JSON.parse(raw))

export const hasCassetteSync = (name: string, options: { readonly directory?: string } = {}) => {
  const file = cassettePath(name, options.directory)
  if (!fs.existsSync(file)) return false
  return Option.isSome(Option.liftThrowable(parseCassette)(fs.readFileSync(file, "utf8")))
}
