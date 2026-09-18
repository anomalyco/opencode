# MUC Harness 数据库 Migration 风险审计（Phase P4）

> 审计范围：`86f93c28`（线上 weishaw/sub2api:latest, v0.2.5）→ 本地 HEAD `5e9088269`（sub2api-muc 部署 commit）
> 方法：`git diff 86f93c28..HEAD -- backend/migrations/ backend/ent/schema backend/ent/migrate`

## 结论：🟢 无数据库 migration 变化，升级不动数据库结构

| 检查项 | 结果 |
|---|---|
| 新增迁移文件（backend/migrations/） | **0 个** |
| 修改迁移文件 | **0 个** |
| ent schema 变更（backend/ent/schema, backend/ent/migrate） | **无 diff** |
| 破坏性语句（DROP TABLE/COLUMN、RENAME、TRUNCATE、DELETE FROM） | **0 处**（无文件可扫）|
| 运行时自动迁移风险 | 无新增——迁移执行器 `internal/repository/migrations_runner.go` 在此区间**无变更** |

## MUC Harness 自身的数据面说明
- `muc/connect-code`：**不建表、不动数据库**——一次性授权码存 Redis（60s TTL，GETDEL 原子单次），仅存 SHA-256 哈希。
- `muc/exchange`：调用既有 `APIKeyService.Create/Delete`（现有 `api_keys` 表），不新增表。
- **Phase P4 不触发"停止上线"条件**（无 destructive migration）。

## 升级时的数据库行为
- 新镜像启动 → 迁移执行器扫描 `backend/migrations/` → 与线上已应用版本一致 → **零迁移执行**。
- 数据库 volume（`/srv/sub2api/data`、postgres 卷）全程不动。

## 回滚时的数据库说明
- 因无 schema 变更，回滚镜像 = 完整回滚，数据库无需任何恢复操作。
