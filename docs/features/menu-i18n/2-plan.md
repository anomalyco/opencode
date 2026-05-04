---
feat-id: menu-i18n
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 实施计划 + 决策轨迹

## 实施前情报

进入实施扫了一下 `packages/app/src/i18n/`,发现 **i18n 框架已经搭好**:
- 17 种语言 dict 文件,每本 ~900 行
- `@solid-primitives/i18n` + `useLanguage` context (`packages/app/src/context/language.tsx`)
- 调用方式 `language.t("key", params?)`
- en.ts 是 source of truth,zh/zht/其他 用 `satisfies Partial<Record<Keys, string>>` 校验
- 缺 key 自动 fallback 到 en

**结论**:1-spec 估的 1-2 天工作量降到几小时,因为只剩"把 fileTree 域的硬编码中文换 key 调用"。

## 步骤 + 决策

### 步骤 1:写 1-spec.md(锁版前评估)
- 命名空间用 `fileTree.*`,grep 确认无冲突 → 通过
- key 数量约 38(后实际增到 49,因 single/bulk 拆分 + Mac 端新增项)
- 翻译策略:**只翻 en/zh/zht 三本**,其他 14 种自动 fallback en — 接受英文 fallback 是可取舍

### 步骤 2:三本 dict 加 FORK 块
按 R2 / R3 在每本 dict 末尾加 `// FORK-BEGIN: 文件树菜单 i18n 2026-05-04` ... `// FORK-END` 块。这种**追加 fork 自有命名空间** 不冲突上游 key 的做法,后续 sync upstream 0 冲突。

### 步骤 3:file-tree.tsx 14 处 t() 替换
**中途踩坑 — DEV 不同步**

写到一半 user 让我对一下 dev 状态,发现 **本地 dev 落后服务端 10 个 commit**(Mac 端今天 11:54-12:02 推了一笔 `file-tree-ux-polish`,直接动了同一个 file-tree.tsx 右键菜单结构):
- 节点菜单 4 组重排(原 7 项混合 → 4 组分类)
- **删了**打印
- **加了**复制文件路径 / 刷新单节点 / 刷新递归
- 空白处菜单也重整,刷新改用 `refreshAll`

**决策**:走 A 方案 — commit 老结构 i18n 工作 → 同步 dev → rebase → 解决 file-tree.tsx 5 处冲突 + 顺手把 Mac 端引入的 2 处新硬编码也 t() 化。理由:rebase 比 reset 干净,保留 git history。

### 步骤 4:rebase + 冲突解决
checkpoint commit `311f0d7de` → 同步 dev 到 `454e8baa6`(快进 10 commits)→ rebase → 5 处冲突 in file-tree.tsx:
- 冲突 #1(line 658-664):新文件 dialog placeholder 简化("文件名(默认 .md)" → "文件名")— 取我的 t() 调用,dict 值改为简化版
- 冲突 #2(line 969-982):菜单结构区,git 困惑放了双份内容 — 取 Mac 的新 4 组结构,t() 应用到新结构
- 冲突 #3(line 1017-1021):新建文件 label "新建文件 (.md)" → "新建文件" — 取 t(),dict 值同步去 .md 后缀
- 冲突 #4(line 1046-1050):同冲突 #3,空白菜单
- 冲突 #5(line 1061-1068):刷新方法 `refresh` → `refreshAll`(Mac 改为递归刷)+ label t() 化

**额外清理**:auto-merge 给 `cut` 留了重复硬编码项,以及 Mac 新增的 `revealInFolder` / `copyPath` / `refreshNode` 都没 t() 化 — 一并处理。

### 步骤 5:audit i18n key 集合
对应菜单结构变化,dict 增删改:
- **删** `fileTree.menu.print`(打印没了)
- **加** `fileTree.menu.copyPath`(en="Copy path" / zh="复制文件路径" / zht="複製檔案路徑")
- **加** `fileTree.toast.copyPathSuccessSingle` + `copyPathSuccessBulk`({{count}} 插值)
- **改值** `fileTree.menu.newFile`:去 "(.md)" 后缀
- **改值** `fileTree.dialog.newFile.placeholder`:去 "(默认 .md)" 后缀

### 步骤 6:typecheck + build
- typecheck 15/15 全过(2 次跑,rebase 前后各一次)
- DeskFox.exe build:**rebase 前 32.23 MB / 2m01s**,**rebase 后 32.24 MB / 1m07s**(增量缓存命中)
- ExitCode 0,无新警告

## 测试覆盖

i18n 改造**不应**改变行为,只换文案。runtime 验证项(等 user 实测):

| # | 项 | 操作 | 预期 |
|---|---|---|---|
| T1 | zh locale 菜单 | 切到 zh,文件右键 | 4 组菜单文字与改造前完全一致(注:newFile 去 .md 后缀是 file-tree-ux-polish 既定改动,非 i18n 副作用) |
| T2 | en locale 菜单 | 切到 en,文件右键 | "Rename / Copy / Cut / Paste / Delete / Reveal in folder / Copy path / New file / New folder / Refresh" |
| T3 | zht locale 菜单 | 切到 zht | "重新命名 / 複製 / 剪下 / 貼上 / 刪除 / 在資料夾中顯示 / 複製檔案路徑 / 新增檔案 / 新增資料夾 / 重新整理" |
| T4 | 重命名 dialog | rename 文件 | title/label/confirm/取消 全部按 locale 切换 |
| T5 | 删除确认 dialog | 删除 1 项 vs 多选删 | single message "Are you sure ... \"X\"?" / bulk "Are you sure ... 3 items?" 各 locale 形态正确 |
| T6 | 名称校验 | 输入空 / 含 `/` / 重名 | 三条 validation 文案随 locale 切换 |
| T7 | 复制路径 toast | 单选/多选复制 | "Path copied" / "3 paths copied" 按 locale |
| T8 | 失败 toast | 模拟权限错误删除 | "Delete failed" / "3 items failed to delete" 按 locale |

## 工作量实绩

| 项 | 估算 | 实际 |
|---|---|---|
| 三本 dict 加 key | 30 分钟 | 25 分钟(parallel Edit 高效) |
| file-tree.tsx 替换 | 60 分钟 | 50 分钟(14 处 parallel Edit) |
| dialog-file-tree.tsx 替换 | 15 分钟 | 10 分钟 |
| rebase + 冲突解决 + audit | — | 35 分钟(中途路线) |
| typecheck + build × 2 | 10 分钟 | 6 分钟 |
| 三文档 + INDEX + 改动日志 | 30 分钟 | 25 分钟(本笔) |
| **总** | ~2.5 小时 | **~2.5 小时** |

中途的 rebase 路线插曲没让总时长超支,因为初次实施已经走到 typecheck + build,rebase 主要是把成果迁到新基线 + 处理两处新增 callsite。
