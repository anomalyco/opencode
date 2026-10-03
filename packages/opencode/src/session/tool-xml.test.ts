import { describe, expect, test } from "bun:test"
import { parseInvokeCalls } from "./tool-xml"

describe("parseInvokeCalls", () => {
  test("extracts a single invoke block", () => {
    const { cleanText, calls } = parseInvokeCalls(
      '确认：   <invoke name="bash"> <parameter name="command">ls</parameter> </invoke>',
    )
    expect(calls).toEqual([{ name: "bash", input: { command: "ls" } }])
    expect(cleanText).toContain("确认：")
    expect(cleanText).not.toContain("<invoke")
  })

  test("extracts multiple invoke blocks with surrounding text", () => {
    const { cleanText, calls } = parseInvokeCalls(
      'a <invoke name="read"><parameter name="file">x.ts</parameter></invoke> and more text',
    )
    expect(calls).toEqual([{ name: "read", input: { file: "x.ts" } }])
    expect(cleanText).toBe("a  and more text")
  })

  test("keeps text that merely mentions invoke without a valid block", () => {
    const text = "you should call <invoke name= bash> but this is prose"
    const { cleanText, calls } = parseInvokeCalls(text)
    expect(calls).toEqual([])
    expect(cleanText).toBe(text)
  })

  test("ignores an unclosed invoke block", () => {
    const text = 'check <invoke name="bash"> <parameter name="command">whoami</parameter>'
    const { cleanText, calls } = parseInvokeCalls(text)
    expect(calls).toEqual([])
    expect(cleanText).toBe(text)
  })

  test("collects multiple parameters into input object", () => {
    const { calls } = parseInvokeCalls(
      '<invoke name="edit"><parameter name="path">a/b.ts</parameter><parameter name="text">hello</parameter></invoke>',
    )
    expect(calls).toEqual([{ name: "edit", input: { path: "a/b.ts", text: "hello" } }])
  })

  test("tolerates whitespace inside tags", () => {
    const { calls } = parseInvokeCalls(
      '<invoke   name="bash"   >\n  <parameter name="command" >date</parameter>\n</invoke>',
    )
    expect(calls).toEqual([{ name: "bash", input: { command: "date" } }])
  })

  test("values may contain angle brackets", () => {
    const { calls } = parseInvokeCalls(
      '<invoke name="bash"><parameter name="command">echo "<b>ok</b>"</parameter></invoke>',
    )
    expect(calls).toEqual([{ name: "bash", input: { command: 'echo "<b>ok</b>"' } }])
  })

  test("removes every valid block from cleanText", () => {
    const { cleanText, calls } = parseInvokeCalls(
      '<invoke name="a"><parameter name="p">1</parameter></invoke><invoke name="b"><parameter name="p">2</parameter></invoke>',
    )
    expect(calls.length).toBe(2)
    expect(cleanText).toBe("")
  })
})