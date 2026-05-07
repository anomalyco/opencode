import { describe, expect, test } from "bun:test"
import { renderTemplate, type TemplateParams } from "../../src/templates/index.js"

describe("renderTemplate", () => {
  test("替换正常占位符", () => {
    const template = "发明名称：{{inventionTitle}}，类型：{{patentType}}"
    const params: TemplateParams = {
      inventionTitle: "一种数据处理装置",
      patentType: "发明",
      inventionType: "装置",
    }
    const result = renderTemplate(template, params)
    expect(result).toBe("发明名称：一种数据处理装置，类型：发明")
  })

  test("缺失字段保留占位符", () => {
    const template = "名称：{{inventionTitle}}，领域：{{technicalField}}"
    const params: TemplateParams = {
      inventionTitle: "测试",
      patentType: "发明",
      inventionType: "装置",
    }
    const result = renderTemplate(template, params)
    expect(result).toContain("测试")
    expect(result).toContain("[technicalField]")
  })

  test("无占位符原样返回", () => {
    const template = "没有占位符的文本"
    const params: TemplateParams = {
      inventionTitle: "测试",
      patentType: "发明",
      inventionType: "装置",
    }
    expect(renderTemplate(template, params)).toBe("没有占位符的文本")
  })

  test("多个相同占位符全部替换", () => {
    const template = "{{inventionTitle}} 是 {{inventionTitle}}"
    const params: TemplateParams = {
      inventionTitle: "X",
      patentType: "发明",
      inventionType: "装置",
    }
    expect(renderTemplate(template, params)).toBe("X 是 X")
  })
})
