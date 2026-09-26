import { afterEach, expect, test } from "bun:test"
import yargs from "yargs"
import { resolveNetworkOptionsNoConfig, withNetworkOptions } from "../../src/cli/network"

const argv = process.argv
afterEach(() => {
  process.argv = argv
})

async function resolve(args: string[], server = { basePath: "/configured/", basePathStripped: true }) {
  process.argv = ["bun", "opencode", "web", ...args]
  return resolveNetworkOptionsNoConfig(await withNetworkOptions(yargs(args)).parse(), { server })
}

test("reads prefix and stripping mode from config", async () => {
  expect(await resolve([])).toMatchObject({ basePath: "/configured", basePathStripped: true })
})

test("explicit CLI arguments override the config", async () => {
  expect(await resolve(["--base-path=/nested/proxy/service/", "--no-base-path-stripped"])).toMatchObject({
    basePath: "/nested/proxy/service",
    basePathStripped: false,
  })
})

test("an explicit empty prefix disables the configured prefix", async () => {
  expect(await resolve(["--base-path="])).toMatchObject({ basePath: "" })
})

test("arguments after -- do not override the config", async () => {
  expect(await resolve(["--", "--base-path=/other", "--no-base-path-stripped"])).toMatchObject({
    basePath: "/configured",
    basePathStripped: true,
  })
})
