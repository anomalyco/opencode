# OpenSpec 与 Superpowers 协作流程

## 前置条件

- 使用全局 `@studyzy/openspec-cn@1.6.0`，不把它加入 monorepo 的 `package.json` 或 `bun.lock`。如果 `Get-Command openspec-cn` 找不到命令，先执行固定版本的全局安装。
- 项目使用 `custom` profile，工作流固定为 `propose`、`explore`、`new`、`continue`、`apply`、`update`、`ff`、`sync`、`archive`、`bulk-archive`、`verify`、`onboard`。
- PowerShell 中用以下命令配置并刷新官方生成文件：

```powershell
if (-not (Get-Command openspec-cn -ErrorAction SilentlyContinue)) {
  npm install -g @studyzy/openspec-cn@1.6.0
}
openspec-cn config set profile custom
openspec-cn config set workflows '[\"propose\",\"explore\",\"new\",\"continue\",\"apply\",\"update\",\"ff\",\"sync\",\"archive\",\"bulk-archive\",\"verify\",\"onboard\"]'
openspec-cn init --tools 'codex,opencode' --profile custom
openspec-cn update
```

`init` 用于首次注册或恢复工具；已注册时日常刷新只运行 `openspec-cn update`。用 `openspec-cn --version` 和 `openspec-cn config list --json` 确认版本、profile 与 12 项工作流。

## 所有权

- OpenSpec：proposal、行为 specs、design、tasks、同步和归档历史。
- Superpowers：需求探索、替代方案比较、计划拆解、TDD、系统化调试和完成前验证。

## 每个变更的顺序

1. 使用 `superpowers:brainstorming` 澄清需求并取得设计批准。
2. 使用 OpenSpec propose 创建或更新 `openspec/changes/<change>/` 制品。
3. 审阅 proposal、specs、design 和 tasks，解决矛盾后再实施。
4. 使用 `superpowers:writing-plans` 细化实施步骤。
5. 使用 TDD 实施；异常进入 `superpowers:systematic-debugging`。
6. 使用 `superpowers:verification-before-completion` 检查真实命令输出。
7. 使用 `openspec-verify-change` skill 检查实现与制品一致性；OpenCode 的等价入口是 `/opsx-verify`。
8. 测试、严格校验、工作流验证和质量门槛全部通过后，才可 sync 和 archive。

`openspec-verify-change` 是 agent 驱动的工作流，不是 CLI 子命令；不存在 `openspec-cn verify`。

## 宿主抽象映射

官方生成模板中的名称是跨宿主抽象，必须使用当前宿主的等价能力：

| 模板抽象 | Codex | OpenCode |
| --- | --- | --- |
| `AskUserQuestion` | 使用当前用户输入/澄清能力；没有专用工具时直接提问并暂停 | 使用当前可用的提问能力 |
| `TodoWrite` | 使用当前计划或任务跟踪能力 | 使用当前计划或任务跟踪能力 |
| `Task tool` | 仅在当前会话允许且提供委派能力时委派，否则在本地执行同一步骤 | 使用当前可用且获授权的任务委派能力，否则本地执行 |
| `Skill tool` | 通过当前 skill 机制调用对应 `openspec-*` skill | 通过当前 skill 机制调用对应 `openspec-*` skill |
| `/opsx:*` | 仅视为上游模板的逻辑记法，不作为 shell 命令；调用对应 `openspec-*` skill | 仅视为上游模板的逻辑记法；实际调用 `/opsx-<name>` slash command |

这些映射只解释宿主能力，不授权超出用户范围的委派、写入或外部操作，也不应通过手改生成文件固化。

## 数据库与飞书信任边界

- 数据库工具使用数据库侧最高权限并提供完整 CRUD；风险控制依赖 change 中明确的事务、复核和回滚设计，而不是降低功能范围。
- 项目不建设或复核用户权限，只验证飞书适配器传递的受信接入上下文是否有效。上下文缺失、过期、伪造或不可验证时 fail closed，不得调用数据库工具。
- 每个数据库 change 建立覆盖业务意图、SQL、执行结果、回答解释四层的 gold cases；写操作和高风险用例必须 100% 通过，读取类总体默认不低于 95%。任何调整必须在 spec 中明确批准。
- gold cases 必须覆盖歧义输入、事务失败、影响行数、写后复核或回滚和 schema 漂移。未达门槛不得归档或发布。

## 校验语义

- `openspec-cn validate --all --strict --json` 返回 `0 items` 只表示当前没有可验证制品，是中性结果，不是“校验成功”的证据。
- 首个真实 change 创建后，使用 `openspec-cn validate <change> --type change --strict --json` 做严格单 change 校验，并保存输出。

## 规则

- 用户最新指令优先；已批准的 OpenSpec specs 是项目行为事实来源。
- 不手工编辑生成的 `.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*`；升级后运行 `openspec-cn update`。
- Superpowers 发现规范与实现冲突时，先更新并重新批准 OpenSpec 制品，不静默修改意图。
- 归档前必须有测试或其他可重复验证证据，并完成 `openspec-verify-change` 工作流和适用的准确率验收。
