---
name: monorepo
description: Work with the 20-package Turborepo monorepo using Bun workspaces
---

# Monorepo

本项目是包含 20 个子包的 TypeScript monorepo，使用 Bun 1.3.13 + Turborepo 2.8.13。

## 关键配置

- `package.json`（根）— workspace、catalog、scripts
- `turbo.json` — 任务流水线
- `packages/*/package.json` — 各包包配置

## Workspace

- `packages/*`、`packages/console/*`、`packages/sdk/js`、`packages/slack`
- 依赖协议：`workspace:*`
- 共享版本：catalog

## Turbo 任务

- `typecheck` → 无依赖，独立
- `build` → 输出 `dist/**`
- `<pkg>#test` → 依赖 `^build`
- `test:ci` → JUnit XML → `.artifacts/unit/junit.xml`

## 常用命令

```bash
bun install --frozen-lockfile
bun turbo typecheck
bun turbo test:ci
cd packages/opencode && bun test
```
