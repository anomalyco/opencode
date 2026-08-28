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
      lastText: "Next step: add unit tests",
      initialGoal: "Implement OAuth2 authentication",
      contextual: true,
    })
    expect(prompt).toContain("[Auto-Drive Directive]")
    expect(prompt).toContain("Implement OAuth2 authentication")
    expect(prompt).toContain("proceed autonomously")
  })
})

describe("AutoDrive.buildSupervisorPrompt", () => {
  test("embeds initialGoal, playbook, and lastText", () => {
    const context: AutoDrive.Context = {
      initialGoal: "Build high-performance cache module",
      playbookMarkdown: "## Core Principles\n- Coverage must exceed 90%",
      lastText: "Core implementation completed. Next I will write test cases.",
    }
    const prompt = AutoDrive.buildSupervisorPrompt(context)
    expect(prompt).toContain("Build high-performance cache module")
    expect(prompt).toContain("Coverage must exceed 90%")
    expect(prompt).toContain("Core implementation completed. Next I will write test cases.")
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
  "next_prompt": "Please complete the LRU eviction test cases.",
  "update_memory": "## Progress Update\\n- [x] Core logic implemented"
}
\`\`\`
`
    const context: AutoDrive.Context = {
      lastText: "Next step: write unit tests",
      initialGoal: "Build cache module",
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(true)
    expect(decision.reason).toBe("The worker has remaining tests to write")
    expect(decision.nextPrompt).toBe("Please complete the LRU eviction test cases.")
    expect(decision.updateMemory).toContain("## Progress Update")
  })

  test("correctly parses valid JSON decision to stop", () => {
    const raw = JSON.stringify({
      continue: false,
      reason: "All requested features are verified and done",
      next_prompt: "",
      update_memory: null,
    })
    const context: AutoDrive.Context = {
      lastText: "Task is complete",
      initialGoal: "Build a utility",
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(false)
    expect(decision.reason).toBe("All requested features are verified and done")
  })

  test("gracefully falls back to heuristic detection on malformed JSON", () => {
    const raw = "I think we should proceed because next steps are listed."
    const context: AutoDrive.Context = {
      lastText: "Next steps: write test cases and verify",
      initialGoal: "Fix bug",
      contextual: true,
    }
    const decision = AutoDrive.parseSupervisorDecision(raw, context)
    expect(decision.continue).toBe(true)
    expect(decision.nextPrompt).toContain("[Auto-Drive Directive]")
  })
})

describe("AutoDrive.defaultPlaybookTemplate", () => {
  test("generates template with project name", () => {
    const content = AutoDrive.defaultPlaybookTemplate("OpenCodeEngine")
    expect(content).toContain("# OpenCodeEngine Auto-Drive Playbook & Memory")
    expect(content).toContain("## 1. Core Principles & Engineering Standards")
    expect(content).toContain("## 2. Active Roadmap & Task Checklist")
  })
})
