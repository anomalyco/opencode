---
name: typescript
description: Octopus-specific TypeScript and Effect coding conventions per AGENTS.md
---

# TypeScript

此 Skill 仅供 core-dev Agent 使用。本项目 TypeScript 规范与通用 TS 最佳实践有显著差异。

## 类型系统

- **禁用 `any`** — 不使用 `any` 类型
- **禁用 `try/catch`** — 使用 Effect 的错误处理替代
- **优先类型推断** — 避免显式类型标注，除非导出需要

## 变量与控制流

- **优先 `const`** — 使用 `const` 而非 `let`
- **禁用 `else`** — 使用 early return 替代
- **禁用解构** — 使用 `obj.a` / `obj.b` 保留上下文
- **内联单次值** — 避免为只用一次的变量创建中间变量

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

## 函数式风格

- 优先 `flatMap`、`filter`、`map` 替代 `for` 循环
- `filter` 中使用 type guard 维持类型推断

## 模块组织

- 禁用 `export namespace Foo { ... }`
- 使用 flat top-level export + 文件底部自导出

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@octopus/Foo") {}
export * as Foo from "./foo"

// index.ts 使用 "."
export * as Foo from "."
```

- 多模块目录使用独立文件（无 barrel index.ts）

## Effect 规范

- 使用 `Effect.gen(function* () { ... })` 组合
- `Effect.fn("Domain.method")` 用于具名 traced effect
- `Effect.fnUntraced` 用于内部 helper
- `Schema.Class` 用于多字段数据
- `Schema.TaggedErrorClass` 用于类型错误
- `yield* new MyError(...)` 替代 `yield* Effect.fail(...)`

## Drizzle Schema

- snake_case 字段名：`project_id`、`created_at`
- 关联列：`<entity>_id`
- 索引：`<table>_<column>_idx`

## 参考

- `AGENTS.md`（根目录）
- `packages/octopus/AGENTS.md`（Effect 详细规范）
- `specs/effect/migration.md`
