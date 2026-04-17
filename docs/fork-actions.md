# Fork Actions Guide

这份文档是给 fork 仓库维护者用的，目标是两件事：

- 自动跟进官方 `anomalyco/opencode` 的最新代码
- 在 GitHub 上远端构建你自己的 Windows `OpenCode Desktop` 安装包

## GitHub Actions 是什么

GitHub Actions 可以理解成“GitHub 帮你跑脚本的地方”。

- 代码和工作流文件都在仓库里
- 当你点按钮、推代码，或者到了定时任务时间，GitHub 会开一台临时机器
- 这台机器会按工作流里的步骤执行，比如拉代码、安装依赖、编译、上传产物、发 Release

你现在只要记住 3 个页面：

1. 仓库主页的 `Actions`
2. 仓库 `Settings -> Actions -> General`
3. 仓库 `Settings -> Secrets and variables -> Actions`

## 这次新增了什么

### 1. `fork-sync`

文件：`.github/workflows/fork-sync.yml`

用途：

- 定时检查官方仓库有没有新提交
- 自动把上游改动合并到一个同步分支
- 自动创建或更新一个 PR，让你审查后再合并到自己的 `dev`

这个工作流不会直接往你的 `dev` 强推，先走 PR，风险更低。

### 2. `build-fork-windows-desktop`

文件：`.github/workflows/build-fork-windows-desktop.yml`

用途：

- 在 GitHub 的 Windows runner 上构建 fork 版桌面安装包
- 复用官方 Tauri Windows 构建流程
- 去掉 Windows 签名步骤
- 生成一个 unsigned 的 `.exe` 安装包
- 可选上传到 GitHub Release

## 第一次使用前要配置什么

### 1. 开启工作流写权限

打开 `Settings -> Actions -> General`，确认：

- `Allow all actions and reusable workflows` 已开启，或者至少允许当前仓库用到的 actions
- `Workflow permissions` 选择 `Read and write permissions`

如果没有写权限，`fork-sync` 就没法推同步分支和创建 PR。

### 2. 配置可选变量

打开 `Settings -> Secrets and variables -> Actions -> Variables`，建议添加：

- `UPSTREAM_REPOSITORY` = `anomalyco/opencode`
- `UPSTREAM_BRANCH` = `dev`
- `FORK_BRANCH` = `dev`

不配也能跑，因为工作流里已经写了同样的默认值。

### 3. 本地 remote

本地建议保留这两个 remote：

- `origin`: 你的 fork
- `upstream`: 官方仓库

当前仓库已经配置成：

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
```

## 怎么手动运行工作流

### 手动同步上游

1. 打开仓库 `Actions`
2. 点左侧 `fork-sync`
3. 点右侧 `Run workflow`
4. 一般不用改输入框，直接运行
5. 跑完后去 `Pull requests` 看新建的同步 PR

如果工作流失败，最常见原因是 merge conflict。这个时候不是 Actions 坏了，而是说明上游和你的 fork 改到了同一块，需要人工处理。

### 手动构建 Windows Desktop

1. 打开仓库 `Actions`
2. 点左侧 `build-fork-windows-desktop`
3. 点 `Run workflow`
4. 填 `version`
5. 如果希望自动上传到 Release，再填：
   - `release_tag`
   - `release_name`（可选）
6. 点击运行

构建完成后有两个看结果的地方：

- `Artifacts`：下载这次构建出的安装包
- `Releases`：如果你填了 `release_tag`，安装包会被上传到对应 Release

## 推荐使用方式

### 日常同步官方功能

1. 先让 `fork-sync` 自动创建同步 PR
2. 看 PR 的 diff
3. 如果没冲突，直接合并
4. 如果有冲突，本地切到同步分支处理
5. 合并回 `dev`

### 发你自己的 Windows 桌面版

1. 先把需要的 fork 改动合并到 `dev`
2. 运行 `build-fork-windows-desktop`
3. `version` 填你想展示的版本号，比如 `1.4.7-fork.1`
4. 想长期保留下载链接就填 `release_tag`
5. 在 `Artifacts` 或 `Releases` 下载安装包

## 产物说明

`build-fork-windows-desktop` 产出的是 unsigned 安装包。

这意味着：

- Windows 可能会提示“未知发布者”
- 这不是构建失败，是因为你没有做代码签名
- 对 fork 项目很常见，尤其是内部版、自用版、测试版

## skill 怎么配合用

新增 skill：`.opencode/skills/fork-upstream-merge/SKILL.md`

这个 skill 适合在你要“把官方最新功能并到 fork”时使用。它的重点不是无脑覆盖，而是：

- 先看 fork 和 upstream 的差异
- 用同步分支来合并
- 优先保留 upstream 默认逻辑
- 只把 fork 的最小差异补回去

## 常见问题

### 1. 为什么不同步到 `dev`，而是先开 PR？

因为 fork 往往有自己的补丁。直接自动推到 `dev` 风险更高，PR 更安全。

### 2. 为什么 Windows 安装包没有签名？

因为官方流程依赖签名基础设施。fork 一般没有官方签名证书，所以这里专门做了 unsigned 构建。

### 3. 如果以后我有自己的签名证书怎么办？

可以再加一套 fork 专用签名流程，把 `OPENCODE_WINDOWS_SIGN=false` 去掉，再补你自己的签名脚本和 secrets。
