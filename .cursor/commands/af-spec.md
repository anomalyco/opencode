# /af-spec — 需求澄清并生成 SPEC（调用 pm-toxic）

你现在要执行“产品定义 Gate A”。

## Steps
1) 读取（如存在）docs/product/SPEC.md 与 SPEC_CHANGELOG.md
2) 启动 subagent：pm-toxic
   - 进行多轮问答（每轮给 options）
   - 把结论实时写入 SPEC 草稿结构
3) 输出/更新：
   - docs/product/SPEC.md
   - docs/product/SPEC_CHANGELOG.md（追加本次变更摘要）
4) 最后给出 Gate A 自检清单（是否可进入 UI prompt 阶段）

## Hard rules
- 没有“非目标/验收标准”的 SPEC 一律不算完成
- 发现 scope creep 必须强制写入 Non-goals 或 Later
