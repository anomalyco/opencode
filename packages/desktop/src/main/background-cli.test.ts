import { expect, test } from "bun:test"

import { BACKGROUND_CLI_PASSWORD_ARGS } from "./background-cli-command"

test("uses the current v2 CLI password command", () => {
  expect(BACKGROUND_CLI_PASSWORD_ARGS).toEqual(["service", "password"])
})
