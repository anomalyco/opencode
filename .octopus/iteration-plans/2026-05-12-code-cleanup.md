# 迭代计划: 代码 & 测试 opencode 深度清洗

> 迭代: 2026-05-12-code-cleanup
> 制定日期: `2026-05-12`
> 状态: 🔄 执行中

## 一、迭代目标

清理 `packages/` 下所有 TypeScript 源代码和测试文件中的 opencode 引用（约 540 文件，3,140 处引用）。这是 v0.2.0 品牌清洁的最后一个大 Issue。

## 二、候选 Issue（P0 Discovery 后定稿）

| # | Issue | 预估文件数 | 级别 | 
|:--:|------|:---:|:---:|
| 12 | 代码 & 测试深度清洗 | 540 | L |

> 需要在 P0 Discovery 阶段拆解为 6+ 子 Issue，按风险等级和文件类型分层。

## 三、质量门

- `rg 'opencode' packages/ -g '*.ts' -g '*.tsx'` 零有效结果（排除外部模型 ID 等保留项）
- `bun turbo typecheck` 全量通过
- `bun test` in `packages/octopus` 通过
- P6 自检门全部通过（oxlint + check-cross-package-refs + verify-rebrand）
