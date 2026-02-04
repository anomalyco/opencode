# OpenCode 二次开发与上游同步指南

本文档详细介绍了如何对 OpenCode 项目进行二次开发（Fork & Customize），并建立一套稳健的流程以保持与官方上游代码（Upstream）的同步。

## 1. 核心策略

为了在保留自定义修改的同时，能够轻松合并上游的新功能和修复，我们推荐采用 **Git Rebase（变基）** 工作流。

*   **原则**：将你的修改“浮”在上游更新之上。
*   **优势**：提交历史线性清晰，冲突处理更直观，方便随时移除或调整自定义功能。

## 2. 分支管理模型

在本地仓库中，建议维护以下分支结构：

| 分支名 | 作用 | 说明 |
| :--- | :--- | :--- |
| `main` / `upstream/main` | **上游基准** | 始终与官方仓库保持完全一致，**严禁**直接修改。 |
| `sync-upstream` | **同步缓冲** | 用于拉取上游最新代码，作为同步的中转站。 |
| `custom/main` | **二开主分支** | 包含你的所有定制化修改，这是你的“生产环境”代码。 |
| `feature/xxx` | **功能开发** | 基于 `custom/main` 开发新功能的分支。 |

## 3. 环境初始化（首次设置）

假设你已经 Clone 了你的 Fork 仓库到本地。

### 3.1 配置上游仓库 (Remote)

在项目根目录下执行：

```bash
# 1. 添加官方仓库作为 'upstream'
git remote add upstream https://github.com/anomalyco/opencode.git

# 2. 验证配置
git remote -v
# 输出应包含：
# origin   https://github.com/sagoo-cloud/opencode.git (fetch/push)
# upstream https://github.com/anomalyco/opencode.git (fetch/push)

# 3. (可选) 禁止直接推送到 upstream，防止误操作
git remote set-url --push upstream DISABLE
```

### 3.2 初始化同步分支

```bash
# 拉取上游最新代码
git fetch upstream

# 建立 sync-upstream 分支并指向 upstream/main
git checkout -b sync-upstream upstream/main

# 建立你的二开主分支（如果还没建立）
git checkout -b custom/main
```

---

## 4. 日常同步流程

当官方发布了新版本或新提交，你需要同步到你的代码库时，请严格按照以下步骤操作。

### 第一步：更新上游基准

```bash
# 1. 切换到同步分支
git checkout sync-upstream

# 2. 拉取上游最新代码
git fetch upstream

# 3. 强制重置到上游最新状态 (确保完全一致)
git reset --hard upstream/main
```

### 第二步：执行变基 (Rebase)

将你的自定义修改应用到最新的上游代码之上。

```bash
# 1. 切换回你的二开分支
git checkout custom/main

# 2. 执行变基
git rebase sync-upstream
```

### 第三步：处理冲突 (如果存在)

如果在 Rebase 过程中出现冲突，Git 会暂停。

1.  使用编辑器打开冲突文件，查看 `<<<<<<<` 和 `>>>>>>>` 标记。
2.  保留你的逻辑，同时合并上游的新逻辑。
3.  解决完所有文件的冲突后：

```bash
# 标记冲突已解决
git add .

# 继续变基过程
git rebase --continue
```

*注意：不要在解决冲突时运行 `git commit`，除非 `rebase` 提示你这样做。*

### 第四步：推送更新

由于 Rebase 改变了提交历史，你需要强制推送 (Force Push) 到你的远程 Fork 仓库。

```bash
# 使用 lease 选项比较安全，它会检查远程分支是否被其他人覆盖
git push origin custom/main --force-with-lease
```

---

## 5. 代码隔离最佳实践

为了减少同步时的冲突，二次开发应遵循 **“最小侵入原则”**。

### 5.1 组件提取策略 (强烈推荐)

对于像 `SidebarPanel` 这样的大型自定义组件，**不要直接在原文件 (`layout.tsx`) 中编写数千行代码**。

*   **做法**：将自定义组件提取到独立文件中，例如 `packages/app/src/components/custom/SidebarPanel.tsx`。
*   **好处**：`layout.tsx` 中只保留一行引用 `<SidebarPanel />`。当上游修改 `layout.tsx` 时，冲突只会发生在这一行引用上，非常容易解决。而你的核心逻辑在独立文件中，完全不受影响。

### 5.2 优先使用新增文件

*   **UI/样式**：尽量避免修改 `src/index.css` 或核心组件。
    *   ✅ 新建 `src/styles/custom.css` 并在入口文件引入。
    *   ✅ 利用 Tailwind Config 覆盖主题。
*   **逻辑功能**：
    *   ✅ 新建 `src/custom/` 目录存放你的业务逻辑。
    *   ✅ 尽量通过 Hook 或 Wrapper 组件包裹原生组件，而不是直接改写原生组件源码。

### 5.3 利用插件系统

OpenCode 拥有插件架构（位于 `packages/opencode/src/plugin/`）。如果你的需求是增加新功能（如新的 AI 模型支持、新的命令），请优先尝试开发插件。

### 5.4 配置文件管理

`package.json`、`cargo.toml`、`tauri.conf.json` 是冲突高发区。
*   **建议**：在同步这些文件时，务必仔细比对。如果是版本号变更，通常接受上游的；如果是依赖变更，确保你的自定义依赖不被删除。

---

## 6. 冲突应对与安全策略

### 6.1 安全备份 (Rebase 前必做)

在执行 `git rebase` 之前，强烈建议创建一个备份分支，以防万一操作失误导致代码丢失。

```bash
# 在 custom/main 分支下
git branch backup/custom-main-$(date +%Y%m%d)
```

如果 Rebase 搞砸了，你可以随时切回备份分支：
```bash
git reset --hard backup/custom-main-20240205
```

### 6.2 关键文件冲突处理 (`layout.tsx`)

`packages/app/src/pages/layout.tsx` 是我们二开的核心区域，也是最容易发生冲突的文件。

*   **场景**：上游也修改了 `layout.tsx` (例如增加了新的 Context Provider)。
*   **策略**：
    1.  **仔细阅读冲突**：不要盲目选择 "Accept Incoming" 或 "Accept Current"。
    2.  **保留你的结构**：我们的三分栏布局是核心，必须保留。
    3.  **吸收上游逻辑**：如果上游增加了新的 `Provider` 或 `Hook` 调用，将其手动复制到你的布局代码中适当的位置。
    4.  **验证**：解决冲突后，立即运行 `bun dev` 验证页面是否正常加载，功能是否可用。

---

## 7. 自动化脚本 (可选)

你可以创建一个脚本 `scripts/sync-upstream.sh` 来简化日常操作：

```bash
#!/bin/bash
set -e

echo "🔄 Fetching upstream..."
git fetch upstream

echo "⚡ Updating sync-upstream branch..."
git checkout sync-upstream
git reset --hard upstream/main

echo "🚀 Rebasing custom/main..."
git checkout custom/main
git rebase sync-upstream

echo "✅ Sync complete! Please verify changes and run tests."
echo "   To push: git push origin custom/main --force-with-lease"
```

给脚本加上执行权限：
```bash
chmod +x scripts/sync-upstream.sh
```

以后只需运行 `./scripts/sync-upstream.sh` 即可完成同步。
