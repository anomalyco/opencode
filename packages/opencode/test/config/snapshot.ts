import { expect } from "bun:test"
import { ConfigParse } from "../../src/config/parse"

export async function snapshot(file: string, actual: string) {
  const value = ConfigParse.jsonc(actual, file)
  if (process.env.UPDATE_CONFIG_FIXTURES === "1") await Bun.write(file, actual)
  expect(value).toEqual(ConfigParse.jsonc(await Bun.file(file).text(), file))
}
