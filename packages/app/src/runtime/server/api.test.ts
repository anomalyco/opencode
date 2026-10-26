import { expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, fileStreamUrl } from "./api"

test.each([
  [btoa("opencode:secret"), { password: "secret" }],
  [btoa("legacy:secret:with:colons"), { password: "secret:with:colons" }],
  [btoa(":secret"), { password: "secret" }],
  ["not base64", undefined],
  [btoa("missing-separator"), undefined],
])("authFromToken(%p) extracts only the password", (token, expected) => {
  expect(authFromToken(token)).toEqual(expected)
})

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
})

test("fileStreamUrl never puts a credential in a media URL", () => {
  const input = { path: "clips/final cut.mp4", directory: "/work/app" }
  expect(fileStreamUrl({ url: "http://127.0.0.1:4096", password: "secret" }, input)).toBeUndefined()
  expect(fileStreamUrl({ url: "http://127.0.0.1:4096" }, input)).toBe(
    "http://127.0.0.1:4096/api/fs/read/clips/final%20cut.mp4?location%5Bdirectory%5D=%2Fwork%2Fapp",
  )
})
