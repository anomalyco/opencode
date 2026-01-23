# OpenCode 版本更新流程（mo-release 分支）

## 目标
当官方 release 发布（如 `v1.1.35`）时，把 `mo-release` 分支更新到该 release，同时保留本地补丁。

## 当前基线
- `mo-release/v1.1.34`
  - 基线：`release: v1.1.34`（`c130dd425`）
  - 本地补丁：
    - `24c58d373`（basePath/前端注入）
    - `d99db6f8e`（server.basePath 配置）

## 更新步骤（示例 v1.1.35）

### 1) 拉取 upstream 并找 release commit
```
cd /Users/zhaofengli/projects/goldersgreen/pyserver/jupyterhub/base-notebook-tf211py39/opencode-src
git fetch origin
git log --oneline --grep "release: v1.1.35" -n 1
```

### 2) 基于 release 新建分支
```
git checkout -b mo-release/v1.1.35 <release-commit>
```

### 3) 迁移本地补丁（cherry-pick）
```
git cherry-pick 24c58d373
git cherry-pick d99db6f8e
```
如有冲突，按提示解决 → `git add ...` → `git cherry-pick --continue`

### 4) 验证
```
bun install
cd packages/app && bun run build
cd ../opencode && bun run script/build.ts
```
再跑一遍 basePath + 会话消息验证清单。

### 5) 推送到 momodel fork
```
git push -u momodel mo-release/v1.1.35
```

## 建议的补丁管理
为避免漏掉补丁，建议记录补丁清单：
```
git log --oneline <release-commit>..mo-release/v1.1.34
```
也可用 `git format-patch` 输出补丁包，后续批量应用：
```
git format-patch <release-commit>..mo-release/v1.1.34 -o patches/
git am patches/*.patch
```

## 回滚策略
若新版本验证失败：
```
git checkout mo-release/v1.1.34
```
直接回退到稳定分支并重新构建部署。
