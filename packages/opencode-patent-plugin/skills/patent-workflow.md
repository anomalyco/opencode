# Patent Workflow Skill

## 触发条件

当用户涉及以下意图时，自动激活此 Skill：
- 专利/知识产权相关查询
- 技术交底书/专利申请文件
- 审查意见/答辩/复审/无效
- 专利检索/分析/评估

## 核心原则

1. **人主导，AI 辅助** — 所有法律文件生成后必须标记为"草案"，需经专业审校
2. **逐步确认** — 多步骤工作流中，每步骤完成后暂停等待用户确认
3. **可追溯** — 所有法规/案例引用必须标注来源

## 工作流

### 工作流 1：规则研究

触发：用户询问专利法规、审查指南、案例或实务操作

```
用户提问
  → 调用 patent_research Tool
    - topic: 研究主题
    - scope: 法规/案例/实务/全部
    - depth: 概述/详细/深度
  → 输出研究报告
  → 用户审阅、追问
  → 迭代完善或结束
```

### 工作流 2：专利撰写（5 步骤）

触发：用户上传技术交底书或要求撰写专利申请

```
用户提交技术交底书
  → [步骤1] 调用 patent_draft Tool（action="understand"）
    - 输出：发明三元组（技术问题-技术方案-技术效果）
    - 暂停：用户确认理解
  → [步骤2] 调用 patent_search Tool
    - 输出：对比文件列表
    - 暂停：用户确认检索充分性
  → [步骤3] 调用 patent_draft Tool（action="specification"）
    - 输出：说明书草案
    - 暂停：逐章节审阅
  → [步骤4] 调用 patent_draft Tool（action="claims"）
    - 输出：权利要求书
    - 暂停：确认保护范围策略
  → [步骤5] 调用 patent_draft Tool（action="abstract"）
    - 输出：摘要 + 完整申请文件
    - 结束：标记为"草案"状态
```

### 工作流 3：审查意见答辩（5 步骤）

触发：用户上传审查意见通知书

```
用户提交审查意见通知书
  → [步骤1] 调用 oa_response Tool（action="parse"）
    - 输出：驳回理由清单
    - 暂停：确认解析完整性
  → [步骤2] 调用 oa_response Tool（action="analyze"）
    - 输出：深度技术分析
    - 暂停：确认技术理解
  → [步骤3] 调用 oa_response Tool（action="respond"）
    - 输出：多方案答辩策略
    - 暂停：用户选择策略（关键决策点）
  → [步骤4] 调用 oa_response Tool（action="revise_claims"）
    - 输出：修改后权利要求 + 修改对照表
    - 暂停：逐条审阅修改
  → [步骤5] 调用 oa_response Tool（action="validate"）
    - 输出：完整答复文件包
    - 结束：用户最终确认
```

### 工作流 4：专利检索

触发：用户要求检索专利或现有技术

```
用户提出检索需求
  → 调用 patent_search Tool
    - query: 检索词
    - database: cnipa/google/wipo/all
    - search_type: keyword/semantic/ipc/applicant
  → 输出检索结果
  → 用户筛选、排序
  → 可导出或继续分析
```

### 工作流 5：专利分析

触发：用户要求分析专利新颖性/创造性/侵权等

```
用户提供目标专利和参考文件
  → 调用 patent_analyze Tool
    - action: novelty/creativity/compare/scope/infringement
    - target: 目标专利
    - reference: 对比文件
  → 输出分析报告
  → 用户审阅、追问
```

## 质量标准

每步骤自动质量检查：
- 说明书/权利要求：7 维度评估（completeness/clarity/accuracy/sufficiency/consistency/compliance/support）
- 得分 < 7.5 则自动迭代修复（最多 3 次）
- 超出 3 次转人工审核

## 审批规则

| 操作类型 | 审批要求 |
|---------|---------|
| 检索/研究/分析 | 无需审批 |
| 说明书撰写 | 每章节完成后确认 |
| 权利要求修改 | 逐条审批 |
| 答辩策略选择 | 必须用户决定 |
| 最终文件提交 | 必须用户确认 |

## 模型选型

| 任务 | 推荐模型 | 温度 |
|------|---------|------|
| 意图识别、格式检查 | 默认模型 | 0.2 |
| 深度推理（创造性分析、策略制定） | deepseek-reasoner | 0.3 |
| 多模态（附图分析） | glm-4v-plus | 0.3 |
| 嵌入（语义检索） | embedding-3 | — |
