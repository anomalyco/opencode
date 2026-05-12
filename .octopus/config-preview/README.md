# config-preview 说明

此目录预生成完整的 `.opencode/` 配置，供评审。评审通过后迁移到 `.opencode/`。

## 目录对照

```
config-preview/              → .opencode/
├── opencode.jsonc           → opencode.jsonc（覆盖）
├── agents/                  → agents/（12 Agent markdown，2 primary + 8 subagent + 2 bot）
├── commands/                → commands/（合并，+6 文件）
├── skills/                  → skills/（合并，+15 目录）
└── templates/               → templates/（新增，7 模板，部署到 .octopus/templates/）
```

## 与现有 .opencode/ 的合并

| config-preview 路径 | 目标路径 | 操作 |
|---------------------|----------|------|
| `opencode.jsonc` | `.opencode/opencode.jsonc` | **覆盖**（新增 agent 段） |
| `agents/analyst.md` | `.opencode/agents/analyst.md` | **新增** |
| `agents/orchestrator.md` | `.opencode/agents/orchestrator.md` | **新增** |
| `agents/architect.md` | `.opencode/agents/architect.md` | **新增** |
| `agents/platform.md` | `.opencode/agents/platform.md` | **新增** |
| `agents/core-dev.md` | `.opencode/agents/core-dev.md` | **新增** |
| `agents/feature-dev.md` | `.opencode/agents/feature-dev.md` | **新增** |
| `agents/qa.md` | `.opencode/agents/qa.md` | **新增** |
| `agents/security.md` | `.opencode/agents/security.md` | **新增** |
| `agents/compat.md` | `.opencode/agents/compat.md` | **新增** |
| `agents/release.md` | `.opencode/agents/release.md` | **新增** |
| `agents/triage.md` | `.opencode/agents/triage.md` | **覆盖**（无变更） |
| `agents/duplicate-pr.md` | `.opencode/agents/duplicate-pr.md` | **覆盖**（无变更） |
| `commands/discover.md` | `.opencode/commands/discover.md` | **新增** |
| `commands/plan.md` | `.opencode/commands/plan.md` | **新增** |
| `commands/review.md` | `.opencode/commands/review.md` | **新增** |
| `commands/canary.md` | `.opencode/commands/canary.md` | **新增** |
| `commands/release.md` | `.opencode/commands/release.md` | **新增** |
| `commands/peer-review.md` | `.opencode/commands/peer-review.md` | **新增** |
| `commands/*.md`（其余8） | `.opencode/commands/*.md` | **覆盖**（无变更） |
| `skills/code-review/SKILL.md` | `.opencode/skills/code-review/SKILL.md` | **新增** |
| `skills/llm/SKILL.md` | `.opencode/skills/llm/SKILL.md` | **新增** |
| `skills/observability/SKILL.md` | `.opencode/skills/observability/SKILL.md` | **新增** |
| `skills/cli/SKILL.md` | `.opencode/skills/cli/SKILL.md` | **新增** |
| `skills/discovery/SKILL.md` | `.opencode/skills/discovery/SKILL.md` | **新增** |
| `skills/workflow/SKILL.md` | `.opencode/skills/workflow/SKILL.md` | **新增** |
| `skills/effect/SKILL.md` | `.opencode/skills/effect/SKILL.md` | **覆盖**（无变更） |
| `skills/monorepo/` | `.opencode/skills/monorepo/` | **新增** |
| `skills/ci-cd/` | `.opencode/skills/ci-cd/` | **新增** |
| `skills/automation/` | `.opencode/skills/automation/` | **新增** |
| `skills/typescript/` | `.opencode/skills/typescript/` | **新增** |
| `skills/drizzle/` | `.opencode/skills/drizzle/` | **新增** |
| `skills/i18n/` | `.opencode/skills/i18n/` | **新增** |
| `skills/testing/` | `.opencode/skills/testing/` | **新增** |
| `skills/security/` | `.opencode/skills/security/` | **新增** |
| `skills/release/` | `.opencode/skills/release/` | **新增** |
| `templates/` | `.octopus/templates/` | **新增**（7 模板） |

## 保留（不动）

| 路径 | 说明 |
|------|------|
| `.opencode/tool/` | triage/duplicate-pr Bot 依赖 |
| `.opencode/glossary/` | 翻译标准（17 语言） |
| `.opencode/plugins/` | TUI 插件 |
| `.opencode/themes/` | 自定义主题 |
| `.opencode/tui.json` | TUI 配置 |
| `.opencode/package.json` | SDK 依赖 |

## 部署说明

- 现有 `.opencode/agent/`（单数）需**重命名**为 `.opencode/agents/`（复数），与官方推荐命名一致
- 重命名后覆盖新增的 10 个 agent markdown 文件 + 覆盖 2 个 bot markdown 文件

## 部署后文件统计

| 类型 | 数量 |
|------|------|
| agents | 12（2 primary + 8 subagent + 2 bot） |
| commands | 14（8 保留 + 6 新增） |
| skills | 16（1 保留 + 15 新增） |
