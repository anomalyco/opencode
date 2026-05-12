---
name: drizzle
description: Drizzle ORM schema, migration, and testing patterns per project conventions
---

# Drizzle ORM

此 Skill 仅供 core-dev Agent 使用。

## Schema 定义

```ts
// snake_case 字段名 — 无需加字符串重定义列名
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## 命名约定

- 表名和列名：snake_case
- 关联列：`<entity>_id`
- 索引：`<table>_<column>_idx`

## Migration

```bash
# 生成迁移（schema 从 src/**/*.sql.ts 读取）
bun run db generate --name <slug>

# 输出文件
# migration/<timestamp>_<slug>/migration.sql
# migration/<timestamp>_<slug>/snapshot.json
```

## 配置

`drizzle.config.ts`：
```ts
schema: "./src/**/*.sql.ts"
output: "./migration"
```

## Migration 测试规范

- 测试应读取 per-folder layout
- 不依赖 `_journal.json`

## 约束

- `drizzle-orm` 版本通过根 catalog 统一管理
- override 已配置确保版本一致
