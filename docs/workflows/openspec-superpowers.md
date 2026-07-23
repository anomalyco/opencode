# OpenSpec 与 Superpowers 协作流程

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
7. 使用 OpenSpec verify 检查实现与制品一致性，然后 archive。

## 规则

- 用户最新指令优先；已批准的 OpenSpec specs 是项目行为事实来源。
- 不手工编辑生成的 `.codex/skills/openspec-*`、`.opencode/skills/openspec-*` 和 `.opencode/commands/opsx-*`；升级后运行 `openspec-cn update`。
- Superpowers 发现规范与实现冲突时，先更新并重新批准 OpenSpec 制品，不静默修改意图。
- 归档前必须有测试或其他可重复验证证据，并完成 OpenSpec verify。
