import { expect, test } from "bun:test"
import { make } from "../src/redaction/redactor"

test("redacts common JSON secrets", () => {
  const request = make().request({
    method: "POST",
    url: "https://example.test",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: '{"access_token":"secret","safe":true}',
  })
  expect(request.headers).toEqual({ "content-type": "application/json" })
  expect(request.body).toBe('{"access_token":"[REDACTED]","safe":true}')
})
