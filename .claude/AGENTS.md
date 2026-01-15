# Agent Foundry Studio Workflow (Claude Code)

本仓库使用 Claude Code 的 Commands + Subagents + Skills 来编排“从想法到可发布应用”的流程。
- Commands：显式步骤按钮（.claude/commands）
- Subagents：角色分工（.claude/agents）
- Skills：长期规范与参考（.claude/skills）

## Quickstart（推荐顺序）
1) /af-init
2) /af-spec  （调用 pm-toxic，产出 docs/product/SPEC.md + SPEC_CHANGELOG.md）
3) /af-ui-prompts （调用 ui-prompt-generator，产出 docs/ui/PROMPT_PACK.md）
4) （外部）Gemini Build：基于 PROMPT_PACK 生成纯前端代码并下载
5) /af-ingest-gemini （把下载的代码导入并清洗归档）
6) /af-integrate （调用 fullstack-integrator：拆 FE/BE + 接入 db/storage/auth/llm）
7) /af-quality-gate （调用 qa-gatekeeper：质量门禁，产出 docs/qa/QA_REPORT.md）
8) /af-deploy （发布到 AF / export / copy workspace）

## Artifacts（每一步必须落盘）
- 产品：doc/product/SPEC.md, doc/product/SPEC_CHANGELOG.md
- UI Prompt：doc/ui/PROMPT_PACK.md
- 导入记录：doc/build/GEMINI_IMPORT_GUIDE.md
- QA：doc/qa/QA_REPORT.md

## Quality Gates（失败即回退）
Gate A：SPEC 通过（边界/非目标/验收标准齐全）
Gate B：集成通过（auth/db/storage/llm contract 明确 + 本地可跑）
Gate C：质量通过（lint/typecheck/test 最低标准 + 冒烟）

## Roles（Subagents）
- pm-toxic：毒舌产品经理（需求问答 + options 收敛 + spec/changelog）
- ui-prompt-generator：根据 spec 生成 prompt pack（多变体、可对比）
- fullstack-integrator：从纯前端导入到“可上线的全栈结构”
- qa-gatekeeper：质量门禁与报告

> Tip：如果你只想跑其中一步，直接执行对应 /af-* 命令即可。
