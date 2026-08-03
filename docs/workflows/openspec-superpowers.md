# OpenSpec 与 Superpowers 协作流程

业务查询运行链路直接使用迁移后的 MySQL。根目录中的两份排查与迁移文档只作为历史资料保留，不是当前运行设计或新功能依赖。

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
3. 审阅 proposal、specs、design 和 tasks，确认 MySQL 数据边界、全链路逐句日志事件和准确率门槛，解决矛盾后再实施。
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

- 业务查询只使用迁移后的 MySQL；运行代码、配置和故障恢复路径不保留旧数据库链路。
- MySQL 数据库工具按新系统设计使用数据库侧最高权限并提供完整 CRUD；每个 change 必须明确实际暴露的读写能力，风险控制依赖事务、影响行数、写后复核和回滚设计。
- 项目不建设或复核用户权限，只验证飞书适配器传递的受信接入上下文是否有效。上下文缺失、过期、伪造或不可验证时 fail closed，不得调用数据库工具。
- 每个数据库 change 建立覆盖业务意图、SQL、执行结果、回答解释四层的 gold cases；写操作和高风险用例必须 100% 通过，读取类总体默认不低于 95%。任何调整必须在 spec 中明确批准。
- gold cases 必须覆盖歧义输入、事务失败、影响行数、写后复核或回滚和 schema 漂移。未达门槛不得归档或发布。

## MySQL 运行数据源

- 每个数据库 change 必须在目标 MySQL 上只读核对主键、字段类型、关系、统计口径和 schema 版本，不得根据旧 SQL Server 结构猜测。
- Agent、Skill、业务意图、回答口径、gold cases 和日志事件与 MySQL 物理表字段隔离；字段映射变化通过适配器和版本化事件处理。
- T1 排查记录和迁移材料保持原样，仅供人工查阅；新系统运行、测试和发布不得依赖这些历史文件。

## 全链路逐句日志

- 采用追加式事件日志。历史事件不得覆盖或静默修改；重新解释、人工纠正和迁移差异必须追加新事件并关联原事件。
- 每条用户消息同时保存完整原文和按顺序拆分的逐句事件；每条智能体回答也同时保存完整原文和逐句事件。无法可靠拆句时，将完整消息作为一个句子，不改变原意。
- 一次用户问题到最终回答使用同一个 `trace_id`，并通过 `conversation_id`、`turn_id`、`message_id`、`sentence_id`、`sentence_index`、`parent_event_id` 和事件顺序形成完整调用链。
- 必须记录业务意图与候选意图、Agent、模型、Prompt、Skill、工具、数据库适配器、schema 版本、SQL 模板、参数、涉及对象、执行状态、耗时、返回或影响行数、结果解释、完整回答、用户反馈和人工纠正。
- 每次人工纠正必须关联原始用户语句、错误意图、错误 SQL 或工具动作、错误回答和确认后的正确口径，使其能够转化为 gold case。
- 数据库事件必须记录实际 MySQL 连接配置标识、`db_engine=mysql`、schema 版本和 change 批准的读写模式。
- 正常业务问题和业务结果不默认脱敏；数据库密码、飞书 Token、应用密钥、Cookie、会话令牌、完整连接字符串、私钥及其他认证秘密绝不得写入日志。日志只记录账号别名或连接配置标识。
- 日志写入失败不能被伪装成日志成功。每个 change 必须明确失败处理、可重试性和业务动作与日志持久化之间的一致性策略。

## 日志驱动的新系统完善

- 按问题频率、表达方式、业务意图、数据对象、失败原因和纠正次数整理新系统需求。
- 从真实语句提炼业务词典、同义词、简称、歧义表达和最终确认口径，并维护业务概念与 MySQL 结构之间的映射。
- 高频问题、错误案例、边界场景和人工纠正必须转化为可重复的 gold cases。
- 若某类问题频繁依赖复杂 SQL、反复缺少同一维度、存在多个口径或经常需要人工纠正，应形成新系统字段、功能、报表或流程改进项。
- 验收报告必须能从最终结论追溯到 MySQL 查询、映射规则、原始用户语句和业务人员纠正记录。

## 校验语义

- `openspec-cn validate --all --strict --json` 返回 `0 items` 只表示当前没有可验证制品，是中性结果，不是“校验成功”的证据。
- 首个真实 change 创建后，使用 `openspec-cn validate <change> --type change --strict --json` 做严格单 change 校验，并保存输出。

## 规则

- 用户最新指令优先；已批准的 OpenSpec specs 是项目行为事实来源。
- 涉及 MySQL、对话、Agent、Skill、工具或数据库的 proposal/specs/design/tasks 必须落实当前 MySQL 数据边界与全链路日志规则，不得只在实现阶段补日志。
- 不手工编辑生成的 `.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*`；升级后运行 `openspec-cn update`。
- Superpowers 发现规范与实现冲突时，先更新并重新批准 OpenSpec 制品，不静默修改意图。
- 归档前必须有测试或其他可重复验证证据，并完成 `openspec-verify-change` 工作流和适用的准确率验收。
