# Agent 执行提示词

## 项目总启动

请读取根 AGENTS.md、openspec/config.yaml 和 docs/workflows/openspec-superpowers.md。后续同时使用 OpenSpec 与 Superpowers：先用 Superpowers 澄清和验证设计，再把已批准内容固化为 OpenSpec proposal/specs/design/tasks；实现时使用 TDD，完成前运行真实验证命令和 OpenSpec verify。不得改变既定最终架构，除非我明确批准。

## 飞书数据库智能体一期

请同时使用 OpenSpec 与 Superpowers，为“飞书 -> Agent -> Skill -> 业务查询工具 -> 云 MySQL”创建第一期变更。飞书负责准入授权；项目不重复做用户权限和默认脱敏。数据库工具支持增删改查，设计重点是业务语义、SQL、执行结果与回答解释的准确率，并为后续 Web、MCP Client 和 Spring Boot 接入保留稳定边界。先完成并展示 proposal、specs、design、tasks，不要在我批准前实现。

## 普通变更

请先使用 superpowers:brainstorming 探索以下变更，然后使用 OpenSpec propose 固化批准后的 proposal、specs、design 和 tasks：<在这里写需求>。检查它是否符合 openspec/config.yaml 和既定最终架构，展示制品摘要并等待批准后再实施。

## 继续实施

请读取当前 OpenSpec change 的全部制品和未完成 tasks，使用 superpowers:writing-plans 形成可验证实施计划，再按 TDD 执行。遇到失败必须使用 systematic-debugging 查明根因；不要绕过测试或静默改变 spec。

## 准确率验收

请对当前变更运行双重验收：先使用 superpowers:verification-before-completion 执行相关测试、类型检查和静态检查，再使用 OpenSpec verify 检查完整性、正确性和一致性。列出每项业务场景对应的实现与测试证据，不用主观判断替代命令输出。

## 归档

请确认所有 OpenSpec tasks 完成、测试通过且 verify 无关键问题；随后同步增量 specs 并 archive 当前 change。最后报告归档路径、主 specs 变化、验证命令和提交记录。
