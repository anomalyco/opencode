# Task 4 Report — 完整 OpenSpec 工作流地基

日期：2026-07-23

分支：`openspec-foundation`

基线：`33f54f2139793e423aa99e1d30df109dfebee886`

## TDD RED 证据

先创建 `script/openspec-foundation.test.mjs`，再从 `script/` 运行：

```text
> node --test openspec-foundation.test.mjs
✖ Codex exposes all 12 OpenSpec workflows
✖ OpenCode exposes all 12 OpenSpec workflows
✖ OpenCode exposes commands for all 12 OpenSpec workflows
✖ every generated workflow reference resolves to a generated target
tests 4
pass 0
fail 4
```

三个清单的 actual 都只有 6 项。断言明确指出缺失：

```text
openspec-bulk-archive-change
openspec-continue-change
openspec-ff-change
openspec-new-change
openspec-onboard
openspec-verify-change

opsx-bulk-archive.md
opsx-continue.md
opsx-ff.md
opsx-new.md
opsx-onboard.md
opsx-verify.md
```

引用完整性断言还捕获到现有生成文件引用了不存在的 `openspec-continue-change`。这证明失败来自 core 6/6/6 的真实断链，而不是测试语法或环境错误。

## 官方生成器与异常恢复

按要求将全局配置切换到 OpenSpec-cn 1.6.0 的 custom profile 和 12 项 workflow，并仅使用官方 `openspec-cn init/update` 生成适配器。

首次在 PowerShell 传递普通 JSON 字面量时，PowerShell 剥离了内层双引号，CLI 实际收到 `[propose,explore,...]`，报：

```text
错误：无效配置 - workflows: Invalid input: expected array, received string
```

这次无效更新同时清理了旧的 18 个生成目标，工作树短暂处于删除状态。通过 argv 探针确认根因后，改用保留双引号的 `\"` 传参，并以单一参数传递 `'codex,opencode'`。随后运行：

```powershell
openspec-cn config set profile custom
openspec-cn config set workflows '[\"propose\",\"explore\",\"new\",\"continue\",\"apply\",\"update\",\"ff\",\"sync\",\"archive\",\"bulk-archive\",\"verify\",\"onboard\"]'
openspec-cn init --tools 'codex,opencode' --profile custom
openspec-cn update
```

官方生成器恢复并生成 Codex skills 12、OpenCode skills 12、OpenCode commands 12；没有手工编辑任何生成文件，也没有停留在删除状态。

## 手写规则修复

- 在 `AGENTS.md` 和工作流文档中映射 `AskUserQuestion`、`TodoWrite`、`Task tool`、`Skill tool`、`/opsx:*` 到 Codex/OpenCode 当前宿主等价能力。
- 统一使用 `openspec-verify-change` skill（OpenCode `/opsx:verify`），明确它不是 CLI 命令，且不存在 `openspec-cn verify`。
- 固化数据库侧最高权限、完整 CRUD、飞书适配器受信接入上下文；缺失、过期、伪造或不可验证时 fail closed。
- 固化业务意图、SQL、执行结果、回答解释四层 gold cases；写操作/高风险用例 100%，读取类总体默认不低于 95%。
- 覆盖歧义输入、事务失败、影响行数、写后复核或回滚、schema 漂移；未达门槛不得归档或发布。
- 将空 `validate --all --strict --json` 的 `0 items` 明确为“当前没有可验证制品”的中性结果，并规定真实 change 的严格单 change 校验。
- 设计和计划以 custom 12/12/12 为当前状态；core 6/6/6 仅保留为“初始实现，后被 Task 4 取代”的历史事实。

## GREEN 与完整验证

从 `script/`：

```text
> node --test openspec-foundation.test.mjs
✔ Codex exposes all 12 OpenSpec workflows
✔ OpenCode exposes all 12 OpenSpec workflows
✔ OpenCode exposes commands for all 12 OpenSpec workflows
✔ every generated workflow reference resolves to a generated target
tests 4
pass 4
fail 0
```

根目录验证：

```text
openspec-cn --version
1.6.0

openspec-cn config list --json
profile: custom
workflows: 12

openspec-cn doctor --json
root.healthy: true
status: []

openspec-cn templates --schema spec-driven --json
proposal/specs/design/tasks: 全部解析到 1.6.0 package templates

openspec-cn validate --all --strict --json
items: 0
passed: 0
failed: 0
```

`0 items` 按设计作为中性结果记录，没有误称为成功。

其他检查：

```text
Codex skills: 12
OpenCode skills: 12
OpenCode commands: 12
git diff --check: exit 0
git diff --exit-code -- package.json bun.lock: exit 0
.opencode/skills/effect/SKILL.md: True
```

## 提交

提交信息：`fix: complete openspec workflow foundation`。未推送。
