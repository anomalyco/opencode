---
name: peer-review
description: 7方LLM并行同行评审——通过 opencode CLI 调用多模型对工作产品独立评估，共识决策
---

# Peer Review (LLM Panel)

此 Skill 供 orchestrator 在 P2/P4/P5 评审阶段使用。通过 opencode CLI 并行调用 7 方 LLM 对工作产品独立评估，达成共识决策。

## 评审模型

| 模型            | 提供方         | CLI ID                                  |
| --------------- | -------------- | --------------------------------------- |
| Claude Opus 4.7 | opencode Zen   | `opencode/claude-opus-4-7`              |
| GPT 5.5         | GitHub Copilot | `github-copilot/gpt-5.5`                |
| Gemini 3.1 Pro  | GitHub Copilot | `github-copilot/gemini-3.1-pro-preview` |
| DeepSeek V4 Pro | DeepSeek       | `deepseek/deepseek-v4-pro`              |
| QWen 3.6 Plus   | opencode Go    | `opencode-go/qwen3.6-plus`              |
| Kimi K2.6       | opencode Go    | `opencode-go/kimi-k2.6`                 |
| MiniMax M2.7    | opencode Go    | `opencode-go/minimax-m2.7`              |

## Prompt 设计规范（关键）

**Prompt 必须自包含**——把评审所需的关键内容直接嵌入 prompt，而不是让模型自行探索文件。

原因（经实测定位，2026-05-13 复测确认 DeepSeek V4-Pro 行为）：

| 根因                  | 现象                                                          | 影响                              |
| --------------------- | ------------------------------------------------------------- | --------------------------------- |
| **Thinking 模式探索** | V4-Pro 默认 Max reasoning effort，倾向用 Grep/Glob 探索式推理 | 5 文件 28s，开放任务 13 次工具调用 |
| **Extended Thinking** | 大量上下文触发 1000+ reasoning tokens，单步推理时间长         | V4-Pro 末段推理峰值 ~90s          |
| 两者叠加              | 实测开放任务 ~161s，自包含 prompt 下降至 ~30s                 | 自包含 prompt 是首选缓解          |

**说明**: `deepseek/deepseek-v4-pro` 是 DeepSeek 2026-04-24 发布的旗舰 Reasoning 模型（1.6T 参数，默认 Max thinking effort），慢是能力的代价。`deepseek-chat`/`deepseek-reasoner` 是 legacy alias（指向 V4-Flash），将于 2026-07-24 退役，**不建议替换主评审模型**。

**Prompt 模板**（< 500 字，把关键内容内联）：

```
你是同行评审专家。直接输出评审结论，不要探索文件。

【评审对象摘要】
<将核心工作产品的关键段落直接粘贴在此处，不超过 300 字>

【评审维度】
维度1: <具体要检查的项目清单>
维度2: <具体要检查的项目清单>
维度3: <具体要检查的项目清单>

【输出格式】
维度1=[Go/NoGo]一句话理由
维度2=[Go/NoGo]一句话理由
维度3=[Go/NoGo]一句话理由
总评=[Go/NoGo]一句话
```

## 执行方式

```bash
# 1. 准备评审 prompt（将关键内容内联，< 500 字）
cat > /tmp/review-prompt.txt << 'EOF'
你是同行评审专家。直接输出评审结论，不要探索文件。

【评审对象摘要】
<关键内容>

【维度1: ...】【维度2: ...】【维度3: ...】

格式：维度1=[Go/NoGo]一句话；维度2=[Go/NoGo]一句话；维度3=[Go/NoGo]一句话；总评=[Go/NoGo]
EOF

# 2. 逐个顺序执行，输出保存到独立文件
for model in \
  "opencode/claude-opus-4-7" \
  "github-copilot/gpt-5.5" \
  "github-copilot/gemini-3.1-pro-preview" \
  "deepseek/deepseek-v4-pro" \
  "opencode-go/qwen3.6-plus" \
  "opencode-go/kimi-k2.6" \
  "opencode-go/minimax-m2.7"; do
  name=$(echo "$model" | tr '/:' '_')
  opencode run -m "$model" "$(cat /tmp/review-prompt.txt)" \
    2>/dev/null > "/tmp/review-${name}.txt"
  echo "Done: $model"
done

# 3. 提取各方结论
for f in /tmp/review-*.txt; do
  echo "=== $(basename $f .txt) ==="
  tail -3 "$f"
  echo
done
```

> **并行 vs 顺序**：并行执行（`&` + `wait`）理论上更快，但当多个模型同时运行时，竞争系统资源可能导致全部超时。除非在高性能服务器上，否则推荐顺序执行——每个模型独立完成，结果更稳定。

### Bash 超时配置

调用方（orchestrator/script）执行 `opencode run` 时应设置 ≥ 300s 的 bash 超时，给 V4-Pro 的 Max thinking 留出余量：

| 模型                              | 实测峰值 (开放任务) | 自包含 prompt 实测 | 推荐 bash timeout |
| --------------------------------- | ------------------- | ------------------ | ----------------- |
| `deepseek/deepseek-v4-pro`        | ~161s               | ~30s               | **300s**          |
| `opencode/claude-opus-4-7`        | ~16s                | ~5s                | 120s              |
| `github-copilot/gpt-5.5`          | ~10s                | ~3s                | 120s              |
| `github-copilot/gemini-3.1-pro-preview` | ~12s          | ~4s                | 120s              |
| `opencode-go/*` (qwen/kimi/minimax)     | ~10-20s       | ~5s                | 120s              |

> 旧版 skill 用 180s 是基于 V3 时代经验，V4-Pro（2026-04-24 发布）默认启用 Max thinking effort，需放宽至 300s。

## 共识规则

| 一致度    | 决策                           | 说明                                     |
| --------- | ------------------------------ | ---------------------------------------- |
| ≥5/7 一致 | **强制采纳**                   | 超过半数评审一致，必须执行               |
| 4/7 一致  | **默认采纳**，architect 可覆写 | 多数意见，architect 有否决权             |
| <4/7 一致 | **architect 裁定**             | 分歧较大，architect 根据上下文做最终决策 |

超时的 LLM 不计入统计分母——**≥5 方有效结果即构成完整评审**。

## 评审维度（按 Phase）

| Phase | 评审对象            | 评审维度                                                                      |
| ----- | ------------------- | ----------------------------------------------------------------------------- |
| P2    | 迭代计划            | 范围合理性、排序正确性、冲突检测完整性、Fast-track 判定准确性、风险识别完整度 |
| P4    | 需求分析报告        | 需求完整性、技术可行性准确度、验收标准可测试性、工作量合理性                  |
| P5    | 技术设计 + 任务拆解 | 架构合理性、接口契约完整性、测试覆盖度、发布风险                              |

## 迭代规则

- 第一轮评审后，若有 ≥4/7 批评意见，修正后发起第二轮
- 第二轮评审后，若仍有 ≥4/7 新意见，修正后发起第三轮
- 第三轮后仍有分歧 → architect 裁定，记录分歧理由
- 每轮评审报告与修正记录一起归档

## 归档

评审报告写入 `.octopus/review/<issue-id>-<phase>.md`，包含：

- 各方 LLM 原始输出（完整文件内容）
- 共识统计（Go 票数 / NoGo 票数 / 超时不计）
- 修正记录（每轮的改动 + 重新评审结果）

## 参考

- `.octopus/WORKFLOW.md` 五、LLM Panel 同行评审机制
- `.octopus/config-preview/commands/peer-review.md`
