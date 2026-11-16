import { describe, expect, test } from "bun:test"
import { formatExecuteOutput } from "./execute-output.js"

describe("execute output", () => {
  test("indents a JSON result", () => {
    expect(formatExecuteOutput('{"a":1,"b":[2]}')).toEqual({
      json: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}',
      rest: undefined,
      text: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}',
    })
  })

  test("indents a JSON result followed by warnings and logs", () => {
    expect(formatExecuteOutput('["x"]\n\nWarnings:\n- [unhandled] boom\n\nLogs:\nhi')).toEqual({
      json: '[\n  "x"\n]',
      rest: "Warnings:\n- [unhandled] boom\n\nLogs:\nhi",
      text: '[\n  "x"\n]\n\nWarnings:\n- [unhandled] boom\n\nLogs:\nhi',
    })
  })

  test("leaves other results as they are", () => {
    expect(formatExecuteOutput("exit 0\nok\n\nLogs:\nhi")).toEqual({
      json: undefined,
      rest: "Logs:\nhi",
      text: "exit 0\nok\n\nLogs:\nhi",
    })
    expect(formatExecuteOutput("{not json")).toEqual({ json: undefined, rest: undefined, text: "{not json" })
  })
})
