import { expect } from "bun:test"

export async function snapshot(file: string, actual: string) {
  if (process.env.UPDATE_CONFIG_FIXTURES === "1") await Bun.write(file, actual)
  expect(actual).toBe(await Bun.file(file).text())
}
