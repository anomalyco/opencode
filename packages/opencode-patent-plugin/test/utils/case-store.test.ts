import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { CaseStore } from "../../src/utils/case-store.js"
import { join } from "path"
import { unlinkSync } from "fs"

// 使用临时数据库，每个测试独立
let store: CaseStore
let dbPath: string

beforeEach(() => {
  dbPath = join(process.env.TMPDIR || "/tmp", `test-case-store-${Date.now()}.sqlite`)
  store = new CaseStore(dbPath)
})

afterEach(() => {
  store.close()
  try { unlinkSync(dbPath) } catch { /* ignore */ }
})

describe("CaseStore", () => {
  test("createCase + getCase", () => {
    const c = store.createCase({ title: "测试案件", patentType: "发明" })
    expect(c.title).toBe("测试案件")
    expect(c.patent_type).toBe("发明")
    expect(c.status).toBe("active")

    const retrieved = store.getCase(c.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.title).toBe("测试案件")
  })

  test("listCases", () => {
    store.createCase({ title: "案件A" })
    store.createCase({ title: "案件B" })
    const cases = store.listCases()
    expect(cases.length).toBe(2)
  })

  test("listCases 过滤状态", () => {
    const c = store.createCase({ title: "活跃案件" })
    store.updateCase(c.id, { status: "closed" })
    store.createCase({ title: "新案件" })

    const activeCases = store.listCases("active")
    expect(activeCases.length).toBe(1)
    expect(activeCases[0].title).toBe("新案件")
  })

  test("updateCase", () => {
    const c = store.createCase({ title: "原标题" })
    const updated = store.updateCase(c.id, { title: "新标题", application_no: "CN20260001" })
    expect(updated!.title).toBe("新标题")
    expect(updated!.application_no).toBe("CN20260001")
  })

  test("addDocument 版本号自增", () => {
    const c = store.createCase({ title: "测试" })
    const d1 = store.addDocument({ caseId: c.id, docType: "specification" })
    const d2 = store.addDocument({ caseId: c.id, docType: "specification" })
    expect(d1.version).toBe(1)
    expect(d2.version).toBe(2)
  })

  test("listDocuments 过滤类型", () => {
    const c = store.createCase({ title: "测试" })
    store.addDocument({ caseId: c.id, docType: "specification" })
    store.addDocument({ caseId: c.id, docType: "claims" })

    const specs = store.listDocuments(c.id, "specification")
    expect(specs.length).toBe(1)
    expect(specs[0].doc_type).toBe("specification")
  })

  test("createTask + completeTask", () => {
    const task = store.createTask({ taskType: "draft", toolName: "patent_draft" })
    expect(task.status).toBe("pending")

    const completed = store.completeTask(task.id, "说明书撰写完成")
    expect(completed!.status).toBe("completed")
    expect(completed!.output_summary).toBe("说明书撰写完成")
    expect(completed!.completed_at).not.toBeNull()
  })

  test("failTask", () => {
    const task = store.createTask({ taskType: "oa" })
    const failed = store.failTask(task.id, "LLM 超时")
    expect(failed!.status).toBe("failed")
    expect(failed!.output_summary).toBe("LLM 超时")
  })

  test("getStats", () => {
    store.createCase({ title: "A" })
    store.createTask({ taskType: "draft" })
    const stats = store.getStats()
    expect(stats.cases).toBe(1)
    expect(stats.tasks).toBe(1)
  })
})
