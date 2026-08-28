import { describe, expect, test } from "bun:test"
import { AutoDrive } from "../src/session/auto-drive"

describe("AutoDrive.detect", () => {
  test("detects Chinese question asking to continue", () => {
    expect(AutoDrive.detect("第一部分已完成。是否继续进行下一步修改？")).toBe(true)
    expect(AutoDrive.detect("配置已更新，如需继续请回复【继续】。")).toBe(true)
    expect(AutoDrive.detect("当前任务准备就绪，请确认是否继续执行下一步。")).toBe(true)
  })

  test("detects Chinese next step statements", () => {
    expect(AutoDrive.detect("基础结构已搭建好。\n下一步计划：\n1. 编写测试用例\n2. 修复边界条件")).toBe(true)
    expect(AutoDrive.detect("已完成函数实现，接下来我将开始添加单元测试。")).toBe(true)
    expect(AutoDrive.detect("排查完成，随后我们将修改配置文件。")).toBe(true)
  })

  test("detects English question asking to continue", () => {
    expect(AutoDrive.detect("First stage done. Would you like me to continue with the next step?")).toBe(true)
    expect(AutoDrive.detect("I have created the files. Please reply continue to proceed.")).toBe(true)
    expect(AutoDrive.detect("Refactoring complete. Let me know if you would like me to continue.")).toBe(true)
  })

  test("detects English next step statements", () => {
    expect(AutoDrive.detect("Summary of changes.\nNext steps:\n1. Run tests\n2. Verify output")).toBe(true)
    expect(AutoDrive.detect("Now I will implement the test suite.")).toBe(true)
    expect(AutoDrive.detect("I am ready to proceed with the implementation.")).toBe(true)
  })

  test("detects maximum steps reached notices", () => {
    expect(
      AutoDrive.detect(
        "CRITICAL - MAXIMUM STEPS REACHED\nThe maximum number of steps allowed for this task has been reached.",
      ),
    ).toBe(true)
    expect(AutoDrive.detect("已达到最大步数限制，剩余任务如下：...")).toBe(true)
  })

  test("does not trigger when user decision/choice is required", () => {
    expect(AutoDrive.detect("这里有两种实现方式：\n1. 方案A\n2. 方案B\n请选择你希望使用的方案。")).toBe(false)
    expect(AutoDrive.detect("Which option do you prefer? Option 1 or Option 2?")).toBe(false)
  })

  test("does not trigger on full task completion", () => {
    expect(AutoDrive.detect("所有任务已全部完成，代码均已测试通过。")).toBe(false)
    expect(AutoDrive.detect("All tasks are completed and verified successfully.")).toBe(false)
  })

  test("handles empty or whitespace strings safely", () => {
    expect(AutoDrive.detect("")).toBe(false)
    expect(AutoDrive.detect("   ")).toBe(false)
  })
})

describe("AutoDrive.promptFor", () => {
  test("returns DEFAULT_PROMPT when input is empty string or empty context", () => {
    expect(AutoDrive.promptFor("")).toBe(AutoDrive.DEFAULT_PROMPT)
    expect(AutoDrive.promptFor({ lastText: "some output" })).toBe(AutoDrive.DEFAULT_PROMPT)
  })

  test("prefers customPrompt when provided", () => {
    const prompt = AutoDrive.promptFor({
      lastText: "some output",
      customPrompt: "自定义继续跑！",
      initialGoal: "重构数据库",
    })
    expect(prompt).toBe("自定义继续跑！")
  })

  test("synthesizes contextual prompt when initialGoal is present", () => {
    const prompt = AutoDrive.promptFor({
      lastText: "下一步：增加单元测试",
      initialGoal: "实现一个用户登录认证系统，支持 OAuth2 和 JWT",
      contextual: true,
    })
    expect(prompt).toContain("【自动领航指令】")
    expect(prompt).toContain("实现一个用户登录认证系统，支持 OAuth2 和 JWT")
    expect(prompt).toContain("继续自主推进执行")
  })
})

describe("AutoDrive.buildSupervisorPrompt", () => {
  test("embeds initialGoal, playbook, and lastText", () => {
    const context: AutoDrive.Context = {
      initialGoal: "开发高性能缓存模块",
      playbookMarkdown: "## 核心规范\n- 覆盖率必须达到 90%",
      lastText: "模块核心代码已完成。接下来我将编写缓存淘汰单元测试。",
    }
    const prompt = AutoDrive.buildSupervisorPrompt(context)
    expect(prompt).toContain("开发高性能缓存模块")
    expect(prompt).toContain("覆盖率必须达到 90%")
    expect(prompt).toContain("模块核心代码已完成。接下来我将编写缓存淘汰单元测试。")
    expect(prompt).toContain('"continue": boolean')
  })
})

describe("AutoDrive.parseSupervisorDecision", () => {
  test("correctly parses valid JSON decision to continue", () => {
    const raw = `Here is my evaluation:
\`\`\`json
{
  "continue": true,
  "reason": "The worker has remaining tests to write",
  "next_prompt": "请按照规划，完成 LRU 淘汰测试用例编写。",
  "update_memory": "## 进展更新\\n- [x] 核心代码完成"
}
\`\`\`
`
    const context: AutoDrive.Context = {
      lastText: "接下来写单元测试",
      initialGoal: "开发缓存模块",
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(true)
    expect(decision.reason).toBe("The worker has remaining tests to write")
    expect(decision.nextPrompt).toBe("请按照规划，完成 LRU 淘汰测试用例编写。")
    expect(decision.updateMemory).toContain("## 进展更新")
  })

  test("correctly parses valid JSON decision to stop", () => {
    const raw = JSON.stringify({
      continue: false,
      reason: "All requested features are verified and done",
      next_prompt: "",
      update_memory: null,
    })
    const context: AutoDrive.Context = {
      lastText: "任务已完成",
      initialGoal: "实现小工具",
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(false)
    expect(decision.reason).toBe("All requested features are verified and done")
  })

  test("gracefully falls back to heuristic detection on malformed JSON", () => {
    const raw = "I think we should proceed because next steps are listed."
    const context: AutoDrive.Context = {
      lastText: "下一步计划：编写测试用例并验证",
      initialGoal: "修复bug",
      contextual: true,
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(true)
    expect(decision.nextPrompt).toContain("【自动领航指令】")
  })
})

describe("AutoDrive.defaultPlaybookTemplate", () => {
  test("generates template with project name", () => {
    const content = AutoDrive.defaultPlaybookTemplate("OpenCodeEngine")
    expect(content).toContain("# OpenCodeEngine Auto-Drive Playbook & Memory")
    expect(content).toContain("## 1. 核心目标与工程规范")
    expect(content).toContain("## 2. 活跃工作流与任务清单 (Active Roadmap)")
  })
})
