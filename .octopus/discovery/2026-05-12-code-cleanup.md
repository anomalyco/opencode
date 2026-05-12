# Discovery: 代码 & 测试 opencode 深度清洗（续 v0.2.0 #12）

## 问题陈述

434 文件、2,193 处 opencode 引用仍需清理。按风险等级分三类：低风险（字符串/日志）、中风险（标识符/键名）、高风险（DI Tags/HTTP Headers/协议URL）。

## 查重结果

| 来源 | 结果 |
|------|------|
| v0.2.0 Discovery | 已有 #12 拆为 12a-12f，部分已完成，需重新评估 |
| 本次 | 全新评估，按热点文件 + 风险等级拆 |

## Issue 拆解

| # | Issue | 热点文件 | 预估文件 | 级别 | 并行 |
|:--:|------|------|:---:|:---:|:---:|
| 35 | **测试文件清理** (config.test/provider.test 等) | config.test(193), provider.test(153), install.test(53) | ~95 | M | #36,#37 |
| 36 | **源代码低风险** (注释/日志/CLI 输出) | runtime(38), github(26), installation(24), uninstall(23) | ~200 | M | #35,#37 |
| 37 | **源代码中高风险** (标识符/DI Tags/protocol) | provider(22), config(24), tips-view(21) | ~139 | M | #35,#36 |

## 保留清单

| 标识符 | 原因 |
|--------|------|
| `.opencode/` | 当前活跃配置目录名 |
| `opencode.jsonc` | 当前活跃配置文件名 |
| `opencode/claude-opus-4-7` 等模型 ID | 外部服务路由 |
| `@gitlab/opencode-gitlab-auth` 等第三方包名 | 上游依赖 |
| `discord.gg/opencode` | 外部 URL（暂时） |

## 执行策略

三个 M 级 Issue 文件集零重叠 → 全并行。每个 Issue 由 core-dev agent 独立执行。
