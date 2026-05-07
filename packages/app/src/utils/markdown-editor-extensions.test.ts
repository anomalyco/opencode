// FORK: markdown-editor-extensions 关键纯函数 / 模式测试 — 2026-05-07
// 关键模块清单(R5 决策 2)第 2 个文件,目标 80% 覆盖率。
//
// 已覆盖:LIST_PATTERNS / TASK_PATTERN / URL_PATTERN / IMAGE_EXT_PATTERN /
//          timestampName / depthOf / PHRASES
// 未覆盖:Command 类(continueListCommand / toggleBoldCommand / 等)— 需 EditorView
//          fixture,happydom 下不一定稳定;handleImageDrop / handlePasteHook —
//          异步 + Tauri invoke,需 mock。这些转独立 backlog。

import { describe, expect, test } from "bun:test"
import {
  LIST_PATTERNS,
  TASK_PATTERN,
  URL_PATTERN,
  IMAGE_EXT_PATTERN,
  timestampName,
  depthOf,
  PHRASES,
} from "./markdown-editor-extensions"

// LIST_PATTERNS = [task, numbered, plain, blockquote](顺序敏感:task 优先于 plain)
const [TASK_LIST, NUMBERED, PLAIN_BULLET, BLOCKQUOTE] = LIST_PATTERNS

describe("LIST_PATTERNS", () => {
  describe("task list(LIST_PATTERNS[0])", () => {
    test("匹配 - [ ] 内容(未勾选)", () => {
      const m = TASK_LIST.exec("- [ ] todo item")
      expect(m).not.toBeNull()
      expect(m![1]).toBe("") // indent
      expect(m![2]).toBe("-") // marker
      expect(m![3]).toBe("[ ]") // checkbox
      expect(m![4]).toBe("todo item") // content
    })

    test("匹配 - [x] / - [X] 内容(已勾选)", () => {
      expect(TASK_LIST.exec("- [x] done")).not.toBeNull()
      expect(TASK_LIST.exec("- [X] done")).not.toBeNull()
    })

    test("匹配缩进的 task list", () => {
      const m = TASK_LIST.exec("    - [ ] nested")
      expect(m).not.toBeNull()
      expect(m![1]).toBe("    ") // 4 空格 indent
    })

    test("匹配 * 和 + 作为 marker", () => {
      expect(TASK_LIST.exec("* [ ] item")).not.toBeNull()
      expect(TASK_LIST.exec("+ [ ] item")).not.toBeNull()
    })

    test("不匹配普通 - 列表(无 [])", () => {
      expect(TASK_LIST.exec("- normal item")).toBeNull()
    })
  })

  describe("numbered list(LIST_PATTERNS[1])", () => {
    test("匹配 1. 内容", () => {
      const m = NUMBERED.exec("1. first")
      expect(m).not.toBeNull()
      expect(m![1]).toBe("") // indent
      expect(m![2]).toBe("1") // 编号
      expect(m![3]).toBe("first") // content
    })

    test("匹配多位数字", () => {
      expect(NUMBERED.exec("100. hundred")).not.toBeNull()
    })

    test("匹配缩进", () => {
      const m = NUMBERED.exec("  3. nested")
      expect(m).not.toBeNull()
      expect(m![1]).toBe("  ")
    })

    test("不匹配 1) 风格(只匹配 .)", () => {
      expect(NUMBERED.exec("1) item")).toBeNull()
    })
  })

  describe("plain bullet(LIST_PATTERNS[2])", () => {
    test("匹配 - / * / + 加内容", () => {
      expect(PLAIN_BULLET.exec("- bullet")).not.toBeNull()
      expect(PLAIN_BULLET.exec("* asterisk")).not.toBeNull()
      expect(PLAIN_BULLET.exec("+ plus")).not.toBeNull()
    })

    test("**也匹配** task list 形式(因为正则语义,代码顺序优先靠 LIST_PATTERNS 数组靠前的)", () => {
      // 这是设计:plain bullet 的 regex 也能匹配 "- [ ] task"(content="[ ] task")
      // 实际使用中靠 LIST_PATTERNS 数组顺序 — task 在前先命中,plain 不会被触达
      expect(PLAIN_BULLET.exec("- [ ] task")).not.toBeNull()
    })
  })

  describe("blockquote(LIST_PATTERNS[3])", () => {
    test("匹配 > 内容", () => {
      const m = BLOCKQUOTE.exec("> quoted")
      expect(m).not.toBeNull()
      expect(m![1]).toBe("")
      expect(m![3]).toBe("quoted")
    })

    test("不匹配 >无空格 内容(必须 > 后空格)", () => {
      expect(BLOCKQUOTE.exec(">noSpace")).toBeNull()
    })

    test("匹配缩进的 blockquote", () => {
      expect(BLOCKQUOTE.exec("  > indented")).not.toBeNull()
    })
  })
})

describe("TASK_PATTERN(独立的 task toggle 模式)", () => {
  test("匹配未勾选(空格)", () => {
    const m = TASK_PATTERN.exec("- [ ] todo")
    expect(m).not.toBeNull()
    expect(m![2]).toBe(" ")
  })

  test("匹配已勾选(x / X)", () => {
    expect(TASK_PATTERN.exec("- [x] done")![2]).toBe("x")
    expect(TASK_PATTERN.exec("- [X] done")![2]).toBe("X")
  })

  test("匹配空 [](无字符)— Tier B 任务模式放宽", () => {
    // 这是 fork 的关键扩展:允许 [] 作为 task 等同于 [ ]
    const m = TASK_PATTERN.exec("- [] todo")
    expect(m).not.toBeNull()
    expect(m![2]).toBeUndefined() // group 2 是 optional
  })

  test("不匹配普通列表", () => {
    expect(TASK_PATTERN.exec("- plain")).toBeNull()
  })
})

describe("URL_PATTERN", () => {
  test("匹配 http / https URL", () => {
    expect(URL_PATTERN.test("http://example.com")).toBe(true)
    expect(URL_PATTERN.test("https://example.com/path?q=1")).toBe(true)
  })

  test("不匹配相对 URL / file URL / mailto", () => {
    expect(URL_PATTERN.test("./relative.md")).toBe(false)
    expect(URL_PATTERN.test("file:///c/path")).toBe(false)
    expect(URL_PATTERN.test("mailto:a@b.com")).toBe(false)
  })

  test("不匹配含空白的字符串(锚定 ^...$)", () => {
    expect(URL_PATTERN.test("https://a.com extra text")).toBe(false)
  })

  test("不匹配空字符串", () => {
    expect(URL_PATTERN.test("")).toBe(false)
  })
})

describe("IMAGE_EXT_PATTERN", () => {
  test("匹配常见图片扩展(大小写无关)", () => {
    expect(IMAGE_EXT_PATTERN.test("a.png")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.PNG")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.jpg")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.jpeg")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.GIF")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.webp")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.svg")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.bmp")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.avif")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("a.ico")).toBe(true)
  })

  test("不匹配非图片扩展", () => {
    expect(IMAGE_EXT_PATTERN.test("a.pdf")).toBe(false)
    expect(IMAGE_EXT_PATTERN.test("a.txt")).toBe(false)
    expect(IMAGE_EXT_PATTERN.test("noext")).toBe(false)
    expect(IMAGE_EXT_PATTERN.test("a.docx")).toBe(false)
  })

  test("匹配带路径的图片", () => {
    expect(IMAGE_EXT_PATTERN.test("path/to/image.png")).toBe(true)
    expect(IMAGE_EXT_PATTERN.test("C:\\Users\\x\\photo.JPEG")).toBe(true)
  })
})

describe("timestampName(粘贴/拖入图片自动命名)", () => {
  test("从带扩展名的原文件名取扩展", () => {
    const out = timestampName("photo.jpg")
    expect(out).toMatch(/^pasted-\d{8}\d{6}\.jpg$/)
  })

  test("无扩展名默认 .png", () => {
    const out = timestampName("noextension")
    expect(out).toMatch(/^pasted-\d{8}\d{6}\.png$/)
  })

  test("空字符串默认 .png", () => {
    const out = timestampName("")
    expect(out).toMatch(/^pasted-\d{8}\d{6}\.png$/)
  })

  test("多 .(取最后一段作为扩展)", () => {
    const out = timestampName("my.archive.tar.gz")
    expect(out).toMatch(/^pasted-\d{8}\d{6}\.gz$/)
  })

  test("ISO 8601 timestamp 格式(年月日时分秒,无分隔符)", () => {
    const out = timestampName("a.png")
    // pasted-YYYYMMDDHHMMSS.png
    const match = out.match(/^pasted-(\d{8})(\d{6})\.png$/)
    expect(match).not.toBeNull()
    const [, date, time] = match!
    expect(date.length).toBe(8) // YYYYMMDD
    expect(time.length).toBe(6) // HHMMSS
  })
})

describe("depthOf(算 .md 相对 root 的深度,用于拼 `../`)", () => {
  test("undefined / 空字符串 → 0", () => {
    expect(depthOf(undefined)).toBe(0)
    expect(depthOf("")).toBe(0)
  })

  test("根目录文件 → 0", () => {
    expect(depthOf("README.md")).toBe(0)
    expect(depthOf("notes.md")).toBe(0)
  })

  test("一层子目录 → 1", () => {
    expect(depthOf("docs/intro.md")).toBe(1)
  })

  test("多层子目录 → 等于路径段数 - 1", () => {
    expect(depthOf("a/b/c/d.md")).toBe(3)
    expect(depthOf("packages/app/src/index.md")).toBe(3)
  })

  test("Windows 反斜杠路径正确处理", () => {
    expect(depthOf("docs\\intro.md")).toBe(1)
    expect(depthOf("a\\b\\c\\d.md")).toBe(3)
  })

  test("混合分隔符", () => {
    expect(depthOf("a/b\\c/d.md")).toBe(3)
  })

  test("前导/末尾 / 不影响计数", () => {
    expect(depthOf("/docs/intro.md")).toBe(1)
    expect(depthOf("/a/b/c.md/")).toBe(2) // 末尾 / 被当作目录分隔规整掉
  })

  test("连续 // 被规整", () => {
    expect(depthOf("a//b/c.md")).toBe(2)
  })
})

describe("PHRASES — CodeMirror 搜索面板 i18n", () => {
  test("zh / zht 都有,en 没有(用默认英文)", () => {
    expect(PHRASES.zh).toBeDefined()
    expect(PHRASES.zht).toBeDefined()
    expect(PHRASES.en).toBeUndefined()
  })

  test("zh / zht 同样的 key 集", () => {
    const zhKeys = new Set(Object.keys(PHRASES.zh))
    const zhtKeys = new Set(Object.keys(PHRASES.zht))
    expect([...zhKeys].sort()).toEqual([...zhtKeys].sort())
  })

  test("覆盖 CM 搜索面板核心 phrase", () => {
    const requiredKeys = [
      "Find",
      "Replace",
      "next",
      "previous",
      "all",
      "match case",
      "regexp",
      "by word",
      "replace",
      "replace all",
      "Go to line",
    ]
    for (const k of requiredKeys) {
      expect(PHRASES.zh[k]).toBeDefined()
      expect(PHRASES.zh[k]!.trim().length).toBeGreaterThan(0)
      expect(PHRASES.zht[k]).toBeDefined()
      expect(PHRASES.zht[k]!.trim().length).toBeGreaterThan(0)
    }
  })

  test("zh 简体 / zht 繁体翻译有差异(防 copy-paste 错)", () => {
    // 至少有一个 key 简繁不同
    const sameValueCount = Object.keys(PHRASES.zh).filter(
      (k) => PHRASES.zh[k] === PHRASES.zht[k],
    ).length
    expect(sameValueCount).toBeLessThan(Object.keys(PHRASES.zh).length)
  })
})
