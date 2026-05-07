// FORK: markdown-editor-extensions Command 类测试 — D3 mock view 路径 2026-05-07
//
// 关键洞察:CodeMirror Command 只用 view.state + view.dispatch,
// 不需要真 EditorView(避开 happydom 对 EditorView 的兼容问题)。
// 用 EditorState + 简化 dispatch 构造 mock view,够测命令逻辑。
//
// 单独 test 文件(与 markdown-editor-extensions.test.ts 同 module 但不冲突 — bun test
// 各文件独立隔离)。

import { describe, expect, test } from "bun:test"
import { EditorState } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import {
  continueListCommand,
  toggleBoldCommand,
  toggleItalicCommand,
  insertLinkCommand,
  toggleTaskCheckCommand,
  tableTabCommand,
  handlePasteHook,
} from "./markdown-editor-extensions"

// ---- 构造 ClipboardEvent mock(happydom 自带 DataTransfer 支持有限,直接对象 cast)----
function mockClipboardEvent(data: Record<string, string>): {
  event: ClipboardEvent
  preventDefaultCalled: () => boolean
  stopPropagationCalled: () => boolean
} {
  let preventDefault = false
  let stopPropagation = false
  const event = {
    clipboardData: {
      getData: (type: string) => data[type] ?? "",
    },
    preventDefault: () => {
      preventDefault = true
    },
    stopPropagation: () => {
      stopPropagation = true
    },
  } as unknown as ClipboardEvent
  return {
    event,
    preventDefaultCalled: () => preventDefault,
    stopPropagationCalled: () => stopPropagation,
  }
}

// ---- Mock view 工厂 ----
function makeMockView(
  initial: string,
  cursor?: number | { anchor: number; head?: number },
): { view: EditorView; getDoc: () => string; getCursor: () => number; getSelection: () => { from: number; to: number } } {
  const sel = typeof cursor === "number" ? { anchor: cursor } : cursor
  let state = EditorState.create({
    doc: initial,
    selection: sel,
  })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: unknown) => {
      state = state.update(spec as Parameters<typeof state.update>[0]).state
    },
  } as unknown as EditorView
  return {
    view,
    getDoc: () => state.doc.toString(),
    getCursor: () => state.selection.main.head,
    getSelection: () => ({ from: state.selection.main.from, to: state.selection.main.to }),
  }
}

describe("toggleBoldCommand(Ctrl+B)", () => {
  test("无选区 → 插入 ** ** 光标置中", () => {
    const { view, getDoc, getCursor } = makeMockView("hello", 5)
    toggleBoldCommand(view)
    expect(getDoc()).toBe("hello****")
    expect(getCursor()).toBe(7) // 5 + len("**") = 7
  })

  test("有选区 → 包 **,选区保留覆盖原文字", () => {
    const { view, getDoc, getSelection } = makeMockView("hello world", { anchor: 0, head: 5 })
    toggleBoldCommand(view)
    expect(getDoc()).toBe("**hello** world")
    // 选区 head 在 "hello" 后(从 ** 之后到 ** 之前)
    expect(getSelection()).toEqual({ from: 2, to: 7 })
  })
})

describe("toggleItalicCommand(Ctrl+I)", () => {
  test("无选区 → 插入 _ _ 光标置中", () => {
    const { view, getDoc, getCursor } = makeMockView("hi", 2)
    toggleItalicCommand(view)
    expect(getDoc()).toBe("hi__")
    expect(getCursor()).toBe(3) // 2 + len("_")
  })

  test("有选区 → 包 _", () => {
    const { view, getDoc } = makeMockView("italic me", { anchor: 0, head: 6 })
    toggleItalicCommand(view)
    expect(getDoc()).toBe("_italic_ me")
  })
})

describe("insertLinkCommand(Ctrl+K)", () => {
  test("无选区 → 插入 []() 光标进 ()", () => {
    const { view, getDoc, getCursor } = makeMockView("text", 4)
    insertLinkCommand(view)
    expect(getDoc()).toBe("text[]()")
    // 光标进入 () 中间(] 和 ( 之间下一位 = 6 + 1 = 7)
    expect(getCursor()).toBe(7) // 4 + 0 + 3 (text len 0, +3 进 url 区)
  })

  test("有选区 → 包 [选中](),光标进 ()", () => {
    const { view, getDoc, getCursor } = makeMockView("see google here", { anchor: 4, head: 10 })
    insertLinkCommand(view)
    expect(getDoc()).toBe("see [google]() here")
    // 光标在 ( 之后:from(4) + len("google")(6) + 3 = 13
    expect(getCursor()).toBe(13)
  })
})

describe("toggleTaskCheckCommand(Ctrl+Enter)", () => {
  test("- [ ] todo → - [x] todo", () => {
    const { view, getDoc } = makeMockView("- [ ] todo", 0)
    expect(toggleTaskCheckCommand(view)).toBe(true)
    expect(getDoc()).toBe("- [x] todo")
  })

  test("- [x] done → - [ ] done", () => {
    const { view, getDoc } = makeMockView("- [x] done", 0)
    toggleTaskCheckCommand(view)
    expect(getDoc()).toBe("- [ ] done")
  })

  test("- [X] DONE → - [ ] DONE(大写 X 视为已勾选)", () => {
    const { view, getDoc } = makeMockView("- [X] DONE", 0)
    toggleTaskCheckCommand(view)
    expect(getDoc()).toBe("- [ ] DONE")
  })

  test("- [] empty → - [x] empty(空括号视为未勾选,toggle 到 x)", () => {
    const { view, getDoc } = makeMockView("- [] empty", 0)
    toggleTaskCheckCommand(view)
    expect(getDoc()).toBe("- [x] empty")
  })

  test("缩进的 task list 也能 toggle", () => {
    const { view, getDoc } = makeMockView("    - [ ] nested", 0)
    toggleTaskCheckCommand(view)
    expect(getDoc()).toBe("    - [x] nested")
  })

  test("非 task 行返回 false 不改动", () => {
    const { view, getDoc } = makeMockView("- plain bullet", 0)
    expect(toggleTaskCheckCommand(view)).toBe(false)
    expect(getDoc()).toBe("- plain bullet")
  })

  test("普通段落返回 false 不改动", () => {
    const { view, getDoc } = makeMockView("just text", 0)
    expect(toggleTaskCheckCommand(view)).toBe(false)
    expect(getDoc()).toBe("just text")
  })

  test("光标在多行文档中第 2 行 task 上仍能 toggle", () => {
    const { view, getDoc } = makeMockView("para 1\n- [ ] task line\npara 3", 7) // 第 2 行开头
    toggleTaskCheckCommand(view)
    expect(getDoc()).toBe("para 1\n- [x] task line\npara 3")
  })
})

describe("continueListCommand(Enter 智能续行)", () => {
  test("- bullet1(光标在末尾)→ 续 \\n- ", () => {
    const { view, getDoc } = makeMockView("- bullet1", 9)
    expect(continueListCommand(view)).toBe(true)
    expect(getDoc()).toBe("- bullet1\n- ")
  })

  test("空 bullet `- `(光标末尾)→ 退出列表(整行清空)", () => {
    const { view, getDoc } = makeMockView("- ", 2)
    continueListCommand(view)
    // 空列表项再 Enter 应该退出 — 行被清空
    expect(getDoc()).toBe("")
  })

  test("1. first(光标末尾)→ 续 \\n2. (编号递增)", () => {
    const { view, getDoc } = makeMockView("1. first", 8)
    continueListCommand(view)
    expect(getDoc()).toBe("1. first\n2. ")
  })

  test("3. third → 续 \\n4. ", () => {
    const { view, getDoc } = makeMockView("3. third", 8)
    continueListCommand(view)
    expect(getDoc()).toBe("3. third\n4. ")
  })

  test("- [ ] task(光标末尾)→ 续 \\n- [ ] ", () => {
    const { view, getDoc } = makeMockView("- [ ] task", 10)
    continueListCommand(view)
    expect(getDoc()).toBe("- [ ] task\n- [ ] ")
  })

  test("> quote(光标末尾)→ 续 \\n> ", () => {
    const { view, getDoc } = makeMockView("> quote", 7)
    continueListCommand(view)
    expect(getDoc()).toBe("> quote\n> ")
  })

  test("缩进的 - bullet → 缩进保留", () => {
    const { view, getDoc } = makeMockView("  - nested", 10)
    continueListCommand(view)
    expect(getDoc()).toBe("  - nested\n  - ")
  })

  test("普通段落 → 返回 false 让默认 Enter 走", () => {
    const { view } = makeMockView("just text", 9)
    expect(continueListCommand(view)).toBe(false)
  })

  test("有选区 → 返回 false 不拦截", () => {
    const { view } = makeMockView("- bullet", { anchor: 2, head: 8 })
    expect(continueListCommand(view)).toBe(false)
  })
})

describe("tableTabCommand(Tab 跳格)", () => {
  test("`| a | b | c |` 光标在 a 后 → 跳到 b 区", () => {
    // | a | b | c |
    // 0123456789012345
    const { view, getCursor } = makeMockView("| a | b | c |", 3) // 光标在 "a" 后
    expect(tableTabCommand(view)).toBe(true)
    // 应跳到 "b" 之前(下一个 cell 内容起始)
    const cursor = getCursor()
    expect(cursor).toBeGreaterThan(3)
    expect(cursor).toBeLessThan(8) // 在 "b" 附近
  })

  test("非表格行(无 |)→ 返回 false", () => {
    const { view } = makeMockView("plain text", 0)
    expect(tableTabCommand(view)).toBe(false)
  })

  test("有选区 → 返回 false", () => {
    const { view } = makeMockView("| a | b |", { anchor: 0, head: 3 })
    expect(tableTabCommand(view)).toBe(false)
  })

  test("行末尾 + 下一行也是表格 → 跳到下一行第 1 cell", () => {
    // line1: | a | b |
    // line2: | c | d |
    const doc = "| a | b |\n| c | d |"
    const line2Start = 10 // \n 后
    const { view, getCursor } = makeMockView(doc, doc.length) // 文档末尾(line2 末尾)
    // 文档末尾(line2 末尾,无下一行)→ 返回 false 让默认 Tab 走
    expect(tableTabCommand(view)).toBe(false)

    // 改:光标在 line1 末尾(line1 不在文档最末)
    const { view: view2, getCursor: c2 } = makeMockView(doc, 9)
    expect(tableTabCommand(view2)).toBe(true)
    // 跳到 line2 的内容起始
    expect(c2()).toBeGreaterThan(line2Start)
  })

  test("`| a | b |` 行末尾(line 后还有非表格行)→ 跳到下一行开头", () => {
    const doc = "| a | b |\nplain text"
    const { view, getCursor } = makeMockView(doc, 9) // line1 末尾
    expect(tableTabCommand(view)).toBe(true)
    expect(getCursor()).toBe(10) // 下一行开头
  })
})

describe("handlePasteHook(智能 URL 粘贴 — Markdown 链接化)", () => {
  test("无选区 → 返回 false 让默认粘贴走", () => {
    const { view, getDoc } = makeMockView("hello", 5)
    const { event } = mockClipboardEvent({ "text/plain": "https://example.com" })
    expect(handlePasteHook(view, event)).toBe(false)
    expect(getDoc()).toBe("hello") // 不应改动
  })

  test("有选区 + 粘贴 URL → 改写成 [选中](URL)", () => {
    const { view, getDoc } = makeMockView("see google here", { anchor: 4, head: 10 })
    const { event, preventDefaultCalled, stopPropagationCalled } = mockClipboardEvent({
      "text/plain": "https://google.com",
    })
    expect(handlePasteHook(view, event)).toBe(true)
    expect(getDoc()).toBe("see [google](https://google.com) here")
    expect(preventDefaultCalled()).toBe(true)
    expect(stopPropagationCalled()).toBe(true)
  })

  test("有选区 + 粘贴非 URL 文字 → 返回 false 让默认粘贴走", () => {
    const { view, getDoc } = makeMockView("hello world", { anchor: 0, head: 5 })
    const { event } = mockClipboardEvent({ "text/plain": "just text not url" })
    expect(handlePasteHook(view, event)).toBe(false)
    expect(getDoc()).toBe("hello world") // 不应改动
  })

  test("text/plain 没有但 text/uri-list 有 → fallback 到 uri-list", () => {
    const { view, getDoc } = makeMockView("link", { anchor: 0, head: 4 })
    const { event } = mockClipboardEvent({
      "text/plain": "",
      "text/uri-list": "https://uri-list.example.com",
    })
    expect(handlePasteHook(view, event)).toBe(true)
    expect(getDoc()).toBe("[link](https://uri-list.example.com)")
  })

  test("uri-list 多行(含 # 注释行)→ 取第一个非注释 URL", () => {
    const { view, getDoc } = makeMockView("link", { anchor: 0, head: 4 })
    const { event } = mockClipboardEvent({
      "text/plain": "",
      "text/uri-list": "# This is a uri-list comment\nhttps://first.com\nhttps://second.com",
    })
    expect(handlePasteHook(view, event)).toBe(true)
    expect(getDoc()).toContain("https://first.com")
    expect(getDoc()).not.toContain("https://second.com")
  })

  test("URL 含 query string + fragment → 完整保留", () => {
    const { view, getDoc } = makeMockView("link", { anchor: 0, head: 4 })
    const { event } = mockClipboardEvent({ "text/plain": "https://x.com/p?q=1&r=2#section" })
    expect(handlePasteHook(view, event)).toBe(true)
    expect(getDoc()).toBe("[link](https://x.com/p?q=1&r=2#section)")
  })

  test("非 URL 文字含空格 → 返回 false(URL_PATTERN ^...$ 锚定)", () => {
    const { view } = makeMockView("link", { anchor: 0, head: 4 })
    const { event } = mockClipboardEvent({ "text/plain": "https://x.com extra text" })
    expect(handlePasteHook(view, event)).toBe(false)
  })

  test("clipboardData 为 null → 返回 false(防御性)", () => {
    const { view } = makeMockView("link", { anchor: 0, head: 4 })
    const event = {
      clipboardData: null,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as ClipboardEvent
    expect(handlePasteHook(view, event)).toBe(false)
  })
})
