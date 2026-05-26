# 专利智能体扩展计划：创造性、复审、无效

> 日期：2026-05-27
> 前置：第一、二阶段已完成（draft + oa Agent + 5 Tool + 质量修复 + 测试）

---

## 目标

新增 3 个专利工作流 Agent，补全 `workflow.ts` 中的空步骤定义，并注册到 Agent Service。

## 新增 Agent

| Agent | 工作流类型 | 步骤数 | 核心能力 |
|-------|-----------|--------|---------|
| patent-creativity | creativity | 5 | 创造性判断（三步法） |
| patent-reexam | reexam | 5 | 复审请求 |
| patent-invalidation | invalidation | 5 | 无效宣告 |

## 变更文件清单

### 修改
1. `src/patent/workflow.ts` — 新增 creativity 工作流类型 + 补全 reexam/invalidation 步骤
2. `src/agent/agent.ts` — 注册 3 个新 Agent + 导入 3 个 prompt
3. `test/patent/workflow.test.ts` — 新增 3 个工作流的测试用例

### 新建
4. `src/agent/prompt/patent-creativity.txt` — 创造性判断 Agent prompt
5. `src/agent/prompt/patent-reexam.txt` — 复审请求 Agent prompt
6. `src/agent/prompt/patent-invalidation.txt` — 无效宣告 Agent prompt
7. `test/patent/integration.test.ts` — 补充 3 个 Agent 的注册验证

---

## Task 1: workflow.ts 扩展

**修改内容：**
- `WorkflowType` 联合类型新增 `"creativity"`
- `WORKFLOW_STEPS` 补全 reexam、invalidation、新增 creativity

**步骤定义：**

```
creativity:
  1. 技术方案理解（三元组提取）    action: understand
  2. 现有技术检索与对比            action: search
  3. 创造性三步法分析              action: three_step
  4. 技术效果论证                  action: effects
  5. 创造性结论报告                action: conclude

reexam:
  1. 驳回理由确认                  action: confirm_rejection
  2. 复审理由深度分析              action: analyze
  3. 证据收集与准备                action: evidence
  4. 复审请求书撰写                action: draft
  5. 最终验证与打包                action: validate

invalidation:
  1. 目标专利分析                  action: analyze_target
  2. 现有技术检索                  action: search
  3. 无效理由构建                  action: build_grounds
  4. 证据组合策略                  action: strategy
  5. 无效宣告请求书撰写            action: draft
```

## Task 2: Agent Prompts

每个 prompt 包含：角色定义、步骤指引、Tool 调用说明、人机确认节点、Todo 跟踪、约束条件。

## Task 3: Agent 注册

在 `agent.ts` 中注册 3 个新 Agent，权限配置与 patent-draft/oa 一致。

## Task 4: 测试

workflow.test.ts 新增创造力/复审/无效的 create + advance + complete 测试。
integration.test.ts 验证 prompt 文件存在。

## 实施顺序

Task 1 → Task 2（可并行写 3 个 prompt）→ Task 3 → Task 4 → typecheck → 提交
