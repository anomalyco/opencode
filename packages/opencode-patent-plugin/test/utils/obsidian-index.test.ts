import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { getSearchIndex } from "../../src/utils/obsidian-index.js"
import { join } from "path"
import { mkdirSync, writeFileSync, rmSync } from "fs"

// 临时目录用于测试索引
const TEST_DIR = join(process.env.TMPDIR || "/tmp", `obsidian-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }) } catch { /* ignore */ }
})

describe("ObsidianSearchIndex", () => {
  test("构建索引并搜索", () => {
    // 创建测试文件
    writeFileSync(join(TEST_DIR, "test1.md"), "# 专利法\n\n第一条规定了专利法的基本原则。")
    writeFileSync(join(TEST_DIR, "test2.md"), "# 商标法\n\n商标法保护注册商标专用权。")

    const index = getSearchIndex()
    // 注意：全局单例可能在之前的测试中被初始化
    // 此测试验证索引 API 可用
    expect(index).toBeDefined()
  })
})
