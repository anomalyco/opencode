---
name: automation
description: Batch file operations with sed, rg, git mv, and dependency rebuild for large-scale refactors
---

# Automation

此 Skill 仅供 core-dev Agent 使用。本项目 AGENTS.md 要求"Prefer automation"。

## 核心工具链

### ripgrep + sed 批量替换

```bash
# 全局包名 scope 替换
grep -rl '@opencode-ai/' --include="*.ts" --include="*.tsx" packages/ | xargs sed -i 's|@opencode-ai/|@octopus-ai/|g'

# Effect ServiceTag 替换
grep -rl '@opencode/' --include="*.ts" --include="*.tsx" packages/ | xargs sed -i 's|@opencode/|@octopus/|g'

# 环境变量替换
grep -rl 'OPENCODE_' --include="*.ts" --include="*.tsx" --include="*.yml" | xargs sed -i 's|OPENCODE_|OCTOPUS_|g'

# 域名替换
grep -rl 'opencode\.ai' --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.md" | xargs sed -i 's|opencode\.ai|51zxtx.com|g'
```

### git mv 目录重命名

```bash
# 保留 Git 历史
git mv packages/opencode packages/octopus
git mv .opencode .octopus

# monorepo 场景额外操作
git mv packages/octopus/Dockerfile packages/octopus/Dockerfile  # 如 Dockerfile 路径已变
```

### 依赖重建

```bash
# 包结构变更后必须执行
rm -rf node_modules bun.lockb .turbo
bun install
bun turbo typecheck  # 验证
```

### 干跑模式

```bash
# 先输出将影响的文件列表，不实际修改
grep -rl 'pattern' --include="*.ts" packages/ | wc -l
```

## 批量操作 Checklist

- [ ] 先 dry-run 统计影响文件数
- [ ] 正则锚定精确（避免误替换，如 `opencode` 不应匹配 `opencode-gitlab-auth` 等第三方包名）
- [ ] 替换后立即 `bun turbo typecheck`
- [ ] git diff 范围合理性审查
- [ ] 每次替换单独 commit（便于回滚）

## 排除规则

以下内容不参与批量替换：

- `node_modules/`、`dist/`、`.turbo/`、`.git/`
- CHANGELOG 历史记录
- 第三方 npm 包名（`opencode-gitlab-auth`、`opencode-poe-auth`）
- 兼容层中故意保留的旧名称（`OCTOPUS_X || OPENCODE_X`）
