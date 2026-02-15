import { describe, test, expect } from "bun:test"
import * as fs from "fs"
import * as path from "path"

describe("法律智能体配置", () => {
  test("legal-agents.ts 配置文件应该存在", () => {
    const configPath = path.join(__dirname, "../legal-agents.ts")
    expect(fs.existsSync(configPath)).toBe(true)
  })

  test("legal-defaults.ts 配置文件应该存在", () => {
    const configPath = path.join(__dirname, "../legal-defaults.ts")
    expect(fs.existsSync(configPath)).toBe(true)
  })

  test("法律提示词文件应该存在", () => {
    const promptDir = path.join(__dirname, "../../session/prompt")
    expect(fs.existsSync(path.join(promptDir, "legal_base.txt"))).toBe(true)
    expect(fs.existsSync(path.join(promptDir, "case_review.txt"))).toBe(true)
    expect(fs.existsSync(path.join(promptDir, "document_draft.txt"))).toBe(true)
  })

  test("法律工具文件应该存在", () => {
    const toolDir = path.join(__dirname, "../../tool")
    expect(fs.existsSync(path.join(toolDir, "law_read.ts"))).toBe(true)
    expect(fs.existsSync(path.join(toolDir, "law_write.ts"))).toBe(true)
    expect(fs.existsSync(path.join(toolDir, "law_search.ts"))).toBe(true)
  })
})

describe("法律工具描述文件", () => {
  test("law_read.txt 应该包含正确的描述", async () => {
    const descPath = path.join(__dirname, "../../tool/law_read.txt")
    const content = await Bun.file(descPath).text()
    expect(content).toContain("案卷")
    expect(content).toContain("法律文书")
  })

  test("law_write.txt 应该包含正确的描述", async () => {
    const descPath = path.join(__dirname, "../../tool/law_write.txt")
    const content = await Bun.file(descPath).text()
    expect(content).toContain("法律文书")
  })

  test("law_search.txt 应该包含正确的描述", async () => {
    const descPath = path.join(__dirname, "../../tool/law_search.txt")
    const content = await Bun.file(descPath).text()
    expect(content).toContain("法规")
  })
})

describe("法律提示词内容", () => {
  test("legal_base.txt 应该包含法律助手身份", async () => {
    const promptPath = path.join(__dirname, "../../session/prompt/legal_base.txt")
    const content = await Bun.file(promptPath).text()
    expect(content).toContain("法律智能助手")
  })

  test("case_review.txt 应该包含案件审查流程", async () => {
    const promptPath = path.join(__dirname, "../../session/prompt/case_review.txt")
    const content = await Bun.file(promptPath).text()
    expect(content).toContain("案件审查官")
    expect(content).toContain("证据审查")
  })

  test("document_draft.txt 应该包含文书类型", async () => {
    const promptPath = path.join(__dirname, "../../session/prompt/document_draft.txt")
    const content = await Bun.file(promptPath).text()
    expect(content).toContain("法律文书助手")
    expect(content).toContain("起诉书")
  })
})
