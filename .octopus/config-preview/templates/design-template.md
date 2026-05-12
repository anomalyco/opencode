# 技术设计文档

> Issue: #<id> `<title>`
> 负责人: `<agent>`
> 日期: `<YYYY-MM-DD>`

## 一、架构设计

### 1.1 系统架构

<!-- 文字描述或 Mermaid 图 -->

### 1.2 涉及模块

| 模块       | 路径                        | 变更类型       |
| ---------- | --------------------------- | -------------- |
| `<module>` | `packages/<pkg>/src/<path>` | 新增/修改/删除 |

## 二、数据模型

### 2.1 Drizzle Schema

```ts
// packages/<pkg>/src/<path>.sql.ts
const <table> = sqliteTable("<table>", {
  id: text().primaryKey(),
  // ...
})
```

### 2.2 Effect Schema

```ts
// 接口契约
export class <Name> extends Schema.Class<<Name>>("<Name>")({
  // ...
}) {}
```

### 2.3 Migration

```bash
bun run db generate --name <slug>
# → migration/<timestamp>_<slug>/migration.sql
```

## 三、接口契约

### 3.1 Service 定义

```ts
export class <Service> extends Context.Service<<Service>, <Interface>>()("@octopus/<Service>") {}
```

### 3.2 输入/输出

| 操作       | 输入     | 输出     | 错误            |
| ---------- | -------- | -------- | --------------- |
| `<method>` | `<Type>` | `<Type>` | `<TaggedError>` |

### 3.3 Effect Layer

```ts
export const <Name>Layer = Layer.effect(<Service>, <Dependencies>)
```

## 四、测试策略

### 4.1 单元测试覆盖

| 模块       | 测试文件              | 覆盖路径       |
| ---------- | --------------------- | -------------- |
| `<module>` | `test/<path>.test.ts` | 正常/错误/边界 |

### 4.2 E2E 测试

<!-- 如涉及 E2E，描述场景 -->

### 4.3 HttpApi 测试

<!-- 如涉及 API，描述模式：coverage/auth/effect -->

## 五、发布策略

### 5.1 版本号

- [ ] 当前版本：`X.Y.Z`
- [ ] 变更类型：major/minor/patch
- [ ] 新版本：`X'.Y'.Z'`

### 5.2 Breaking Change

- [ ] 不涉及
- [ ] 涉及 — 兼容窗口：`<N>` 个 minor version
- [ ] MIGRATION.md 需编写

## 六、任务拆解

### 6.1 子任务清单

| #   | 子任务   | 负责人    | 预估文件 | 依赖 | 验收标准        |
| --- | -------- | --------- | -------- | ---- | --------------- |
| 1   | `<task>` | `<agent>` | N        | —    | Given/When/Then |
| 2   | `<task>` | `<agent>` | N        | #1   | Given/When/Then |

### 6.2 INVEST 检查

- [ ] Independent — 各任务可独立开发
- [ ] Negotiable — 实现细节可协商
- [ ] Valuable — 每个任务交付价值
- [ ] Estimable — 工作量可评估
- [ ] Small — 每任务 ≤ 150 文件
- [ ] Testable — 有明确验收标准

## 七、LLM Panel 评审结果

> 评审日期：`<YYYY-MM-DD>`
> 通过模型：N/7
> 评审记录：`.octopus/review/<issue-id>-p3.md`
