---
name: ci-cd
description: Manage 27 GitHub Actions workflows, Docker, Nix, and release pipelines
---

# CI/CD

27 个 GitHub Actions workflow，覆盖完整 CI/CD 生命周期。

## 关键 Workflow
- `typecheck.yml` — TypeScript 类型检查
- `test.yml` — 单元测试(Linux+Windows) + E2E(Playwright)
- `pr-standards.yml` — Conventional Commit 标题检查
- `publish.yml` — 主发布管线(version→build→sign→publish)
- `deploy.yml` — SST 部署

## Issue/PR 自动化
- `triage.yml` — Issue 自动分类
- `duplicate-issues.yml` — 重复检测
- `compliance-close.yml` — 不合规自动关闭(2h)
- `opencode.yml` — 评论区 `/oc` 触发 AI

## 发布路径
`publish.yml` → `publish-vscode.yml` → `containers.yml` → `sync-zed-extension.yml`

## CI Secrets 双轨制
1. 新增 `OCTOPUS_*` Secrets（保留旧的 `OPENCODE_*`）
2. 代码: `OCTOPUS_X || OPENCODE_X`
3. 全量迁移 → 删除旧 Secret
