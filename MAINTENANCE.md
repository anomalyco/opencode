# 分支维护指南 (Fork Maintenance Guide)

本文档说明了如何维护此 opencode 分支，包括如何与上游同步以及如何解决冲突。

## 🎯 我们的目标

1. **保持极简模式为默认**：我们的分支始终以 REPL (Minimal) 模式启动。
2. **保持更新**：定期与上游同步，以获取新功能和错误修复。
3. **减少冲突**：保持我们的改动尽可能精简，以减少合并冲突。

---

## 🔄 与上游同步 (Syncing with Upstream)

### 自动同步 (推荐)

我们配置了 GitHub Actions 工作流，每周一自动与上游同步：

- **工作流文件**：`.github/workflows/sync-upstream.yml`
- **执行时间**：每周一 00:00 UTC
- **手动触发**：你也可以在 GitHub 的 Actions 标签页中手动运行它。

### 手动同步

如果你需要手动同步，请使用我们提供的脚本，它可以自动处理合并和基础冲突：

```bash
# 推荐方式
./scripts/sync-upstream.sh
```

#### 📋 同步后检查清单 (Post-Sync Checklist)

每次同步完成后，建议执行以下步骤以确保稳定性：

1. **类型检查**：确保上游新代码与我们的自定义逻辑兼容。
   ```bash
   bun run typecheck
   ```
2. **构建与测试**：重新构建 CLI 并验证极简模式是否仍为默认且功能正常。
   ```bash
   cd packages/opencode
   bun run script/build.ts --single
   ./dist/opencode-<平台>/bin/opencode
   ```
3. **查看日志**：检查上游提交记录以了解新功能。
   ```bash
   git log --oneline -n 20
   ```
*(注：同步脚本现在会自动将更改推送到你的远程仓库。)*

---

## ⚠️ 处理合并冲突

### 常见冲突区域

1. **`packages/opencode/src/cli/cmd/tui/thread.ts`**
   - 此文件包含我们的极简模式逻辑。
   - **解决办法**：保留我们的版本 (`git checkout --ours`)。

2. **`README.md`**
   - 包含我们的自定义说明文档。
   - **解决办法**：保留我们的版本 (`git checkout --ours`)。

### 冲突解决示例

如果你手动合并遇到冲突，可以参考以下操作：

```bash
# 保留关键文件的本地版本
git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
git checkout --ours README.md

# 暂存已解决的文件
git add packages/opencode/src/cli/cmd/tui/thread.ts
git add README.md

# 提交合并
git commit -m "merge: resolve conflicts, preserve minimal mode"
```

---

## 📋 我们自定义的文件列表

| 文件路径 | 用途 | 冲突解决策略 |
| :--- | :--- | :--- |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | 极简模式逻辑 | 保留我们的 (Ours) |
| `README.md` | 项目说明文档 | 保留我们的 (Ours) |
| `.github/workflows/build-cli.yml` | 构建工作流 | 保留我们的 (Ours) |
| `.github/workflows/sync-upstream.yml` | 同步工作流 | 保留我们的 (Ours) |
| `scripts/sync-upstream.sh` | 同步脚本 | 保留我们的 (Ours) |

---

## 🚀 发布流程

### 1. 与上游同步
```bash
./scripts/sync-upstream.sh
```

### 2. 测试改动
```bash
# 运行类型检查
bun run typecheck

# 本地测试构建
cd packages/opencode
bun run script/build.ts --single
```

### 3. 创建发布
```bash
# 打标签
git tag v0.1.0-minimal

# 推送标签
git push origin v0.1.0-minimal

# GitHub Actions 会自动构建并发布二进制文件
```

---

## 🔧 开发工作流

### 添加新功能
1. **创建分支**：`git checkout -b feature/my-feature`
2. **进行改动**：保持代码精简，专注于极简模式的增强。
3. **测试**：`bun run typecheck`
4. **提交 PR**：目标分支设为此分支的 `feat/minimal-tui-style`。

### 同步功能分支
如果你在开发分支上需要同步上游：
```bash
# 更新 feat/minimal-tui-style 分支
git checkout feat/minimal-tui-style
./scripts/sync-upstream.sh

# Rebase 你的功能分支
git checkout feature/my-feature
git rebase feat/minimal-tui-style
```

---

## 🆘 常见问题排除 (Troubleshooting)

### 问题：`thread.ts` 出现合并冲突
**解决**：
```bash
git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
git add packages/opencode/src/cli/cmd/tui/thread.ts
git commit -m "merge: resolve conflict, keep minimal mode"
```

### 问题：同步后构建失败
**解决**：
```bash
# 清理并重新安装依赖
rm -rf node_modules
bun install
bun run typecheck
```

### 问题：`git fetch upstream` 失败 (网络受限)
如果你在无法解析 `github.com` 的受限网络环境中：
1. **检查代理**：确保终端可以访问外网。
2. **手动补丁**：如果在浏览器中可以访问，但在终端不行，可以下载补丁并应用：
   ```bash
   git apply your_patch.patch
   ```
3. **外部拉取**：在有网的环境执行 `git fetch upstream`，然后再回到本地执行合并。

---

## 📞 获取帮助
- **问题反馈**: https://github.com/iamcheyan/opencode/issues
- **上游项目**: https://github.com/anomalyco/opencode
- **AWS Bedrock 指南 (中文)**: [AWS_BEDROCK_GUIDE_ZH.md](AWS_BEDROCK_GUIDE_ZH.md)

---

## 🎉 参与贡献
我们欢迎任何贡献！请遵循以下原则：
1. Fork 本仓库
2. 创建功能分支
3. 进行彻底测试
4. 提交 PR

**重点关注领域**：
- 改进极简模式交互
- 添加新的斜杠命令 (Slash Commands)
- 性能优化
- 更好的终端兼容性
