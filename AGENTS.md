# debug 流程

- 理解用户输入的问题
- 仔细确定可能引起问题的链路；如果问题较为复杂，调用子智能体分析代码库确定可疑链路
- 在链路中添加日志，帮助精准定位问题
  [CRITICAL] 前端日志**禁止**输出 object
  [CRITICAL] 前端日志**必须**以 **字符串(string)** 形式输出
- 你主动读取日志，或者用户提供日志，分析日志内容，找到问题所在
- 根据分析结果，提出解决方案

<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:

- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:

- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:

- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->
