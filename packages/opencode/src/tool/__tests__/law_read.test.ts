import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"

// 注意：由于 LawReadTool 依赖 Bun.file() 和其他运行时特性，
// 这里只测试基本的配置和类型定义

describe("法律工具配置", () => {
  test("law_read 工具描述文件应该存在", () => {
    const descPath = path.join(__dirname, "../law_read.txt")
    expect(fs.existsSync(descPath)).toBe(true)
  })

  test("law_write 工具描述文件应该存在", () => {
    const descPath = path.join(__dirname, "../law_write.txt")
    expect(fs.existsSync(descPath)).toBe(true)
  })

  test("law_search 工具描述文件应该存在", () => {
    const descPath = path.join(__dirname, "../law_search.txt")
    expect(fs.existsSync(descPath)).toBe(true)
  })

  test("law_read.ts 工具实现文件应该存在", () => {
    const implPath = path.join(__dirname, "../law_read.ts")
    expect(fs.existsSync(implPath)).toBe(true)
  })

  test("law_write.ts 工具实现文件应该存在", () => {
    const implPath = path.join(__dirname, "../law_write.ts")
    expect(fs.existsSync(implPath)).toBe(true)
  })

  test("law_search.ts 工具实现文件应该存在", () => {
    const implPath = path.join(__dirname, "../law_search.ts")
    expect(fs.existsSync(implPath)).toBe(true)
  })
})

describe("法律提示词配置", () => {
  test("legal_base.txt 提示词文件应该存在", () => {
    const promptPath = path.join(__dirname, "../../session/prompt/legal_base.txt")
    expect(fs.existsSync(promptPath)).toBe(true)
  })

  test("case_review.txt 提示词文件应该存在", () => {
    const promptPath = path.join(__dirname, "../../session/prompt/case_review.txt")
    expect(fs.existsSync(promptPath)).toBe(true)
  })

  test("document_draft.txt 提示词文件应该存在", () => {
    const promptPath = path.join(__dirname, "../../session/prompt/document_draft.txt")
    expect(fs.existsSync(promptPath)).toBe(true)
  })
})

describe("法律智能体配置", () => {
  test("legal-agents.ts 配置文件应该存在", () => {
    const configPath = path.join(__dirname, "../../config/legal-agents.ts")
    expect(fs.existsSync(configPath)).toBe(true)
  })

  test("legal-defaults.ts 配置文件应该存在", () => {
    const configPath = path.join(__dirname, "../../config/legal-defaults.ts")
    expect(fs.existsSync(configPath)).toBe(true)
  })

  test("legal-opencode.json 示例配置应该存在", () => {
    const configPath = path.join(__dirname, "../../../legal-opencode.json")
    expect(fs.existsSync(configPath)).toBe(true)
  })
})
