import { describe, test, expect } from "bun:test"
import { ProfessionalRouterService } from "../src/core/router-service.js"

describe("ProfessionalRouterService", () => {
  const enabledOptions = { config: { professionalMode: { enabled: true } } }
  const disabledOptions = { config: { professionalMode: { enabled: false } } }

  test("未启用专业模式时返回通用决策", async () => {
    const service = new ProfessionalRouterService(disabledOptions)
    const decision = await service.route("帮我检索相关专利")

    expect(decision.domain).toBe("general")
    expect(decision.complexity).toBe("simple")
    expect(decision.workflowType).toBe("direct")
    expect(decision.isProfessional).toBe(false)
  })

  test("检测专利领域", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我分析这件专利的新颖性")

    expect(decision.domain).toBe("patent")
    expect(decision.isProfessional).toBe(true)
  })

  test("检测商标领域", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("我想注册一个商标")

    expect(decision.domain).toBe("trademark")
    expect(decision.isProfessional).toBe(true)
  })

  test("检测法律领域", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我分析这个合同的法律风险")

    expect(decision.domain).toBe("legal")
    expect(decision.isProfessional).toBe(true)
  })

  test("检测版权领域", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("我的著作权被侵犯了")

    expect(decision.domain).toBe("copyright")
    expect(decision.isProfessional).toBe(true)
  })

  test("复杂任务识别", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我制定专利布局保护策略")

    expect(decision.complexity).toBe("complex")
    expect(decision.workflowType).toBe("plan_plus_hitl")
    expect(decision.requiresConfirmation).toBe(true)
  })

  test("中等复杂度识别", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我检索专利")

    expect(decision.complexity).toBe("medium")
    expect(decision.workflowType).toBe("hitl")
    expect(decision.requiresConfirmation).toBe(true)
  })

  test("简单任务识别", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("这件专利是什么类型的")

    expect(decision.complexity).toBe("simple")
    expect(decision.workflowType).toBe("direct")
    expect(decision.requiresConfirmation).toBe(false)
  })

  test("专利领域推荐正确的技能", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我撰写专利")

    expect(decision.suggestedSkills).toContain("patent-draft")
    expect(decision.suggestedTools).toContain("patent_search")
    expect(decision.suggestedTools).toContain("patent_analyze")
  })

  test("商标领域推荐正确的工具", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我查询商标是否可以注册")

    expect(decision.suggestedTools).toContain("trademark_search")
    expect(decision.suggestedTools).toContain("trademark_analyze")
  })

  test("suggestSkills 返回推荐技能", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我撰写专利")
    const skills = service.suggestSkills(decision)

    expect(skills.length).toBeGreaterThan(0)
    expect(skills).toContain("patent-draft")
  })

  test("suggestTools 返回推荐工具", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("帮我检索专利")
    const tools = service.suggestTools(decision)

    expect(tools.length).toBeGreaterThan(0)
  })

  test("requiresHITL 正确判断", async () => {
    const service = new ProfessionalRouterService(enabledOptions)

    const simple = await service.route("专利是什么")
    expect(service.requiresHITL(simple)).toBe(false)

    const complex = await service.route("帮我制定专利保护策略")
    expect(service.requiresHITL(complex)).toBe(true)
  })

  test("getWorkflowType 返回正确类型", async () => {
    const service = new ProfessionalRouterService(enabledOptions)

    const simple = await service.route("专利名称是什么")
    expect(service.getWorkflowType(simple)).toBe("direct")

    const medium = await service.route("检索相关专利")
    expect(service.getWorkflowType(medium)).toBe("hitl")
  })

  test("英文关键词也能匹配", async () => {
    const service = new ProfessionalRouterService(enabledOptions)
    const decision = await service.route("Help me search for patent applications")

    expect(decision.domain).toBe("patent")
    expect(decision.isProfessional).toBe(true)
  })
})
