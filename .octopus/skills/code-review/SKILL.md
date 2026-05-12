---
name: code-review
description: Systematic code review checklists by change type, severity, and domain
---

# Code Review

此 Skill 供 architect、core-dev、feature-dev、platform 在 P7 Code Review 阶段使用。

## 审查维度

每类变更都需要检查以下 5 个维度，但侧重点不同：

| 维度       | 检查内容                                  |
| ---------- | ----------------------------------------- |
| **正确性** | 逻辑是否正确？边界条件是否处理？          |
| **安全性** | 是否引入漏洞？Secret 是否暴露？           |
| **风格**   | 是否符合 AGENTS.md？                      |
| **架构**   | 是否符合 Effect rules？接口契约是否完整？ |
| **测试**   | 核心路径和错误路径是否覆盖？              |

## 按变更类型审查

### `docs:` / `chore:`

- 文件格式是否正确（markdown 规范、链接有效）
- 是否引用了不存在或已废弃的接口/配置
- 版本号/日期等硬编码文本是否需要更新

### `fix:`

- 根因是否已定位（而非只修症状）？
- 修复是否引入新问题？
- 是否需要回填测试？
- 是否有相关的已有 Issue 应关联？

### `feat:`

- 接口契约是否完整（输入/输出/错误处理）？
- Effect Schema 是否正确定义了 TaggedError？
- 是否引入了 `any` 类型？
- 是否避免了 `try/catch`（Effect 管理错误）？
- 新功能是否可独立开关（feature flag 或配置项）？
- 数据库变更是否包含 migration？
- 文档是否同步更新（i18n keys、API docs）？

### `feat!:`

除 `feat:` 全部检查外，额外：

- Breaking Change 是否在 CHANGELOG 中标注？
- MIGRATION.md 是否已编写？
- 是否有兼容过渡期或双轨方案？
- 所有受影响的包是否都已适配？

### `refactor:`

- 行为是否保持不变？（重构不改变功能）
- 是否消除了技术债务而非转移？
- 是否遵循了单一职责？
- Drizzle schema 字段是否使用 snake_case？
- 批量替换脚本是否正确（检查替换边界）？

## 审查优先级

| 优先级 | 关注点                            |
| :----: | --------------------------------- |
|   P0   | 安全漏洞、数据丢失、CI Seeds 泄露 |
|   P1   | 架构合理性、接口契约错误          |
|   P2   | 代码风格、可读性、命名            |
|   P3   | 文档完整性、注释                  |

P0/P1 问题 → 必须修复才能 approve。P2/P3 → 建议修复，不阻塞。

## 审查流程

1. 先看 `git diff --stat` 了解变更范围和文件数
2. 先看 Schema/类型/接口定义（契约层）
3. 再看实现逻辑
4. 最后看测试覆盖
5. 输出：通过/不通过 + 分级建议

## 参考

- AGENTS.md — 代码风格规范
- `.octopus/WORKFLOW.md` 四.4 Commit 规范 + P7 PR 分级审批
