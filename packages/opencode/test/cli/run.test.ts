import { describe, expect, test } from "bun:test"
import { unwrap } from "../../src/cli/cmd/run"

describe("run command request handling", () => {
  test("returns data for successful responses", () => {
    expect(unwrap({ data: { ok: true } })).toEqual({ ok: true })
  })

  test("throws sdk error responses instead of ignoring them", () => {
    expect(() => unwrap({ data: undefined, error: { message: 'default agent "wrong_agent" not found' } })).toThrow(
      'default agent "wrong_agent" not found',
    )
  })

  test("throws nested sdk error messages from named error payloads", () => {
    expect(() =>
      unwrap({
        data: undefined,
        error: {
          name: "UnknownError",
          data: { message: 'default agent "wrong_agent" not found' },
        },
      }),
    ).toThrow('default agent "wrong_agent" not found')
  })
})
