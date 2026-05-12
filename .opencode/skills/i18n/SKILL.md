---
name: i18n
description: Multi-language i18n key management across 4 directories, 66 locale files, and 612 MDX docs
---

# I18n

此 Skill 仅供 feature-dev Agent 使用。

## i18n 目录结构

| 目录 | 语言数 | 格式 | 键示例 |
|------|--------|------|--------|
| `packages/app/src/i18n/` | 15 | `export const dict = { "key": "value" }` | flat key-value |
| `packages/ui/src/i18n/` | 17 | `export const dict: Record<string, string> = { ... }` | flat key-value |
| `packages/desktop/src/renderer/i18n/` | 16 | 同上 | flat key-value |
| `packages/web/src/content/i18n/` | 18 | JSON | nested: `app.head.titleSuffix` |

## 翻译键替换

- TypeScript i18n 文件：flat key-value pairs
- JSON i18n 文件：nested key-value pairs
- 两种格式的替换逻辑不同

## 文档翻译

`packages/web/src/content/docs/` 包含 612 个 .mdx 文件，17 种语言。翻译时注意：
- 保留技术术语和代码块不变
- 保留 Markdown/MDX 结构
- 遵循 `.opencode/glossary/<locale>.md` 的术语表

## 多语言一致性 Check

```bash
# 检查所有 locale 的 key 完整性和一致性
# 工具：parity.test.ts（packages/app/src/i18n/）
```

## 翻译工作流

1. 英文源文件修改 → 提交
2. 运行 `/translate` 命令批量翻译其他语言
3. 英文 + 中文人工抽查
4. 其他语言 diff 一致性检查

## Glossary

`.opencode/glossary/` 提供了 17 种语言的术语标准：
- `zh-cn.md`：提示词(prompt)、会话(session)、提供商(provider)
- 其他 locale 同理

## 注意事项

- 不翻译的产品名/技术术语：opencode, octopus, Effect, TypeScript
- 保留所有 fenced code blocks 和 inline code 不变
- 保留所有 URL、文件路径、命令参数不变
