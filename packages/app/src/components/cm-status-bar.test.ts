// FORK: md-editing-iter-2 — 单测光标信息计算逻辑(行号 / 列号 / 选区长度)2026-05-09
//
// CmStatusBar 组件本身极薄(纯展示),核心逻辑在 code-mirror-view.tsx 的
// updateListener 里:line = doc.lineAt(sel.head).number,col = head - line.from + 1,
// selLength = sel.to - sel.from。本测试用 EditorState 直接验证这三处计算。

import { describe, expect, test } from "bun:test"
import { EditorState } from "@codemirror/state"

function calcCursorInfo(state: EditorState) {
  const sel = state.selection.main
  const lineObj = state.doc.lineAt(sel.head)
  return {
    line: lineObj.number,
    col: sel.head - lineObj.from + 1,
    selLength: sel.to - sel.from,
  }
}

describe("CmStatusBar 光标信息计算", () => {
  test("空文档,光标在 0:行 1 列 1 选区 0", () => {
    const state = EditorState.create({ doc: "" })
    expect(calcCursorInfo(state)).toEqual({ line: 1, col: 1, selLength: 0 })
  })

  test("单行文档,光标在第 5 字符:行 1 列 6 选区 0", () => {
    const state = EditorState.create({
      doc: "Hello World",
      selection: { anchor: 5 },
    })
    expect(calcCursorInfo(state)).toEqual({ line: 1, col: 6, selLength: 0 })
  })

  test("多行文档,光标在第 3 行第 1 列(行号从 1 起)", () => {
    const state = EditorState.create({
      doc: "line1\nline2\nline3",
      selection: { anchor: 12 }, // "line1\nline2\n" length = 12,光标在 "line3" 开头
    })
    expect(calcCursorInfo(state)).toEqual({ line: 3, col: 1, selLength: 0 })
  })

  test("中文字符光标计算(列号按 UTF-16 code unit 计 — CodeMirror 原生行为)", () => {
    const state = EditorState.create({
      doc: "你好世界",
      selection: { anchor: 2 }, // 光标在"你好"之后
    })
    expect(calcCursorInfo(state)).toEqual({ line: 1, col: 3, selLength: 0 })
  })

  test("有选区:5 字符选中,selLength = 5", () => {
    const state = EditorState.create({
      doc: "Hello World",
      selection: { anchor: 0, head: 5 }, // 选中 "Hello"
    })
    expect(calcCursorInfo(state)).toEqual({ line: 1, col: 6, selLength: 5 })
  })

  test("跨行选区:selLength 包含换行符", () => {
    const state = EditorState.create({
      doc: "abc\ndef\nghi",
      selection: { anchor: 0, head: 7 }, // 选中 "abc\ndef" = 7 字符
    })
    // 光标在 head=7 = "abc\ndef" 末尾,在第 2 行的第 4 列(d e f|)
    expect(calcCursorInfo(state)).toEqual({ line: 2, col: 4, selLength: 7 })
  })

  test("反向选区(从后往前):selLength 仍为正", () => {
    const state = EditorState.create({
      doc: "Hello",
      selection: { anchor: 5, head: 0 }, // 反向选中 — anchor > head
    })
    // sel.to = 5, sel.from = 0,差值 5 不变
    const info = calcCursorInfo(state)
    expect(info.selLength).toBe(5)
    expect(info.line).toBe(1)
    expect(info.col).toBe(1) // head 在 0 → col 1
  })
})
