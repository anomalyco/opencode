# Agent 执行提示词

## 项目总启动

请读取根 AGENTS.md、openspec/config.yaml 和 docs/workflows/openspec-superpowers.md。先确认 `openspec-cn --version` 为 1.6.0，`openspec-cn config list --json` 显示 custom profile 和 12 项工作流；不满足时按工作流文档的前置命令恢复。后续同时使用 OpenSpec 与 Superpowers：先用 Superpowers 澄清和验证设计，再把已批准内容固化为 OpenSpec proposal/specs/design/tasks；实现时使用 TDD，完成前运行真实验证命令和 `openspec-verify-change` skill（OpenCode `/opsx:verify`）。它不是 CLI 命令，不要运行不存在的 `openspec-cn verify`。不得改变既定最终架构，除非我明确批准。

## 飞书数据库智能体一期

请同时使用 OpenSpec 与 Superpowers，为“飞书 -> Agent -> Skill -> 业务查询工具 -> 云 MySQL”创建第一期变更。数据库工具使用数据库侧最高权限并支持完整 CRUD。项目不建设或复核用户权限，只验证飞书适配器传递的受信接入上下文；缺失、过期、伪造或不可验证时 fail closed，不进入数据库工具。为业务意图、SQL、执行结果、回答解释四层建立 gold cases：写操作和高风险用例 100%，读取类总体默认不低于 95%；覆盖歧义输入、事务失败、影响行数、写后复核或回滚、schema 漂移，未达门槛不得归档或发布。为后续 Web、MCP Client 和 Spring Boot 接入保留稳定边界。先完成并展示 proposal、specs、design、tasks，不要在我批准前实现。

## 普通变更

请先使用 superpowers:brainstorming 探索以下变更，然后使用 OpenSpec propose 固化批准后的 proposal、specs、design 和 tasks：<在这里写需求>。检查它是否符合 openspec/config.yaml 和既定最终架构，展示制品摘要并等待批准后再实施。

## 继续实施

请读取当前 OpenSpec change 的全部制品和未完成 tasks，使用 `openspec-continue-change` 补齐缺失制品，使用 superpowers:writing-plans 形成可验证实施计划，再按 TDD 执行。遇到失败必须使用 systematic-debugging 查明根因；不要绕过测试或静默改变 spec。模板若写 `/opsx:*` 或宿主抽象工具名，按 docs/workflows/openspec-superpowers.md 映射为当前宿主的等价能力。

## 准确率验收

请对当前数据库变更运行双重验收：先使用 superpowers:verification-before-completion 执行相关测试、类型检查和静态检查，再使用 `openspec-verify-change` skill（OpenCode `/opsx:verify`）检查完整性、正确性和一致性。以 gold cases 分别报告业务意图、SQL、执行结果、回答解释四层指标；写操作和高风险用例必须 100%，读取类总体默认不低于 95%。列出歧义输入、事务失败、影响行数、写后复核或回滚、schema 漂移及飞书受信上下文 fail-closed 的实现与测试证据。任一门槛未达不得归档或发布。

## 归档

请确认所有 OpenSpec tasks 完成、严格单 change 校验通过、测试通过、`openspec-verify-change` 无关键问题，且适用的准确率门槛全部达到；随后同步增量 specs 并 archive 当前 change。`validate --all --strict --json` 的 `0 items` 只是“当前没有可验证制品”，不能作为成功证据。最后报告归档路径、主 specs 变化、验证命令和提交记录。
