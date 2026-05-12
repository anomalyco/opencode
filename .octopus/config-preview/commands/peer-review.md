---
description: 7方LLM同行评审
agent: orchestrator
---

你正在执行 LLM Panel 同行评审。Phase: $1, Issue: $2

## 评审方法

通过 opencode CLI 调用 7 方 LLM 对工作产品独立评估，达成共识决策。

加载 `skill:peer-review` 获取完整执行规范。

## 评审模型

| CLI ID                                  | 提供方         |
| --------------------------------------- | -------------- |
| `opencode/claude-opus-4-7`              | opencode Zen   |
| `github-copilot/gpt-5.5`                | GitHub Copilot |
| `github-copilot/gemini-3.1-pro-preview` | GitHub Copilot |
| `deepseek/deepseek-v4-pro`              | DeepSeek       |
| `opencode-go/qwen3.6-plus`              | opencode Go    |
| `opencode-go/kimi-k2.6`                 | opencode Go    |
| `opencode-go/minimax-m2.7`              | opencode Go    |

## 关键规范

- **Prompt 自包含**：把关键内容直接内联进 prompt，不依赖模型自行探索文件
- **Prompt < 500 字**：防止模型大量 tool call 积累导致 extended thinking 超时
- **顺序执行**：逐模型顺序运行（不用 `&` 并行），避免资源竞争导致全部超时
- **输出保存到文件**：`opencode run ... > /tmp/review-<model>.txt`，用 `tail -3` 提取结论
- **超时不计入分母**：≥5 方有效结果即构成完整评审

## 共识判定

- ≥5/7 一致 → 强制采纳
- 4/7 一致 → 默认采纳（architect 可覆写）
- <4/7 一致 → architect 裁定

## 归档

评审报告写入 `.octopus/review/<issue-id>-p<N>.md`，包含各方原始输出 + 共识统计 + 修正记录。
