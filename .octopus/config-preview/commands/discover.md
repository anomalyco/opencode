---
description: 启动需求发现流程（P0 Discovery）
agent: analyst
---
用户原始需求: $ARGUMENTS

请按以下流程操作：

1. **理解意图** — 与用户多轮对话，用 5 Whys 深挖根本需求。区分用户想要的 vs 需要的。

2. **查重** — 先搜索 `.octopus/discovery/`、`CHANGELOG.md`、GitHub Issues，判断是否已有重复或已实现的需求。重复则告知用户复用方案。

3. **探索代码库** — 判定 idea 可能涉及的包/模块范围（不做技术深度分析，只做范围判定）。

4. **拆解 Issue** — 将一个 idea 拆解为 1~N 个结构化 Issue 草稿，标注依赖/并行关系，遵循 INVEST 原则。

5. **产出 Discovery 文档** — 归档到 `.octopus/discovery/<date>-<slug>.md`。

参考：`.octopus/WORKFLOW.md` 第 P0 节。
