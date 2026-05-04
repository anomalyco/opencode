---
feat-id: menu-i18n
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 改动日志

## commit

`b9b85e343` — `feat(i18n): 文件树菜单/对话框/toast 接入 i18n 框架 [feat: menu-i18n]`

(rebase 前 checkpoint `311f0d7de`,rebase 后 `87ccd1c00`,amend 消息后 `b9b85e343`。push 时只看到 `b9b85e343`。)

## 文件改动(6 文件 / +324 / -47)

| 文件 | 改动 |
|---|---|
| `packages/app/src/i18n/en.ts` | FORK-BEGIN/END 块加 49 个 fileTree.* key(source of truth) |
| `packages/app/src/i18n/zh.ts` | 同步 49 个 zh 翻译 |
| `packages/app/src/i18n/zht.ts` | 同步 49 个 zht 翻译 |
| `packages/app/src/components/file-tree.tsx` | useLanguage import + 30 处硬编码 → t();配合 file-tree-ux-polish 重整后的 4 组节点菜单 + 2 组空白菜单 |
| `packages/app/src/components/dialog-file-tree.tsx` | useLanguage import + 7 处硬编码 → t();DialogFileTreePrompt + DialogFileTreeConfirm 各注入 hook |
| `docs/features/menu-i18n/1-spec.md` | 新增 spec 文档 |

(本笔 commit 不含 2-plan / 3-changelog / INDEX / 改动日志.md,这些在下一笔 docs commit。)

## i18n key 列表(49 个)

### `fileTree.menu.*`(11 个,菜单项)
rename / revealInFolder / copyPath / cut / copy / paste.toFolder / paste.toCurrentDir / paste.toRoot / delete / newFile / newFolder / refresh

### `fileTree.dialog.*`(20 个,对话框)
- newFile.{title,label,placeholder}
- newFolder.{title,label,placeholder}
- rename.{fileTitle,folderTitle,label,confirm,unchanged}
- confirmDelete.{fileTitle,folderTitle,bulkTitle,messageSingle,messageBulk,bulkName,detail,confirm}
- create / cancel
- validation.{empty,invalidChar,duplicate}

### `fileTree.toast.*`(14 个,toast 标题)
operationFailed / openFailed / deleteFailed{Single,Bulk} / moveFailed{Single,Bulk} / copyFailed{Single,Bulk} / pasteFailed{Single,Bulk} / undoFailedPartial / copyPathSuccess{Single,Bulk}

bulk 类型用 `{{count}}` 插值;deleteConfirm.message{Single,Bulk} 用 `{{name}}` 插值。

## 影响范围

- **运行时**:文件树右键菜单 + 4 个 dialog(新建文件 / 新建文件夹 / 重命名 / 删除确认)+ 文件树相关 toast 全部走 i18n
- **聊天侧 / 文件查看器 / 其他 UI 区域**:**0 影响**,只改了 fileTree 域
- **上游 sync upstream**:0 风险,fork 块用独立 `fileTree.*` 命名空间,不动任何上游 key

## 回归测试

| # | 项 | 验收 |
|---|---|---|
| ✅ A1 | typecheck 全过 | `bun run typecheck` 15/15 successful, 0 error(rebase 前后各跑一次) |
| ✅ A2 | release build 出 DeskFox.exe | `build-deskfox.ps1 -Env dev -NoBundle` 成功,32.24 MB,exit 0 |
| ✅ A3-A6 | zh locale 文件树菜单 + dialog + 校验 + 删除多选 | user 2026-05-04 runtime 实测全过 |
| ✅ A7 | 单选复制路径 toast | "已复制路径" 正常显示 |
| ⚠️ A7-bulk | 多选复制路径 toast | **不触发**(见下方"遗留挂账");user 评估**不需要此功能**,保持原装 |
| ⏳ A8 | 失败 toast | 触发条件不便构造,跳过(下次出现真实失败时观察) |

## R2 / R3 / R4 合规

- **R2 marker**:三本 dict 都加 `// FORK-BEGIN: 文件树菜单 i18n 2026-05-04` / `// FORK-END` 块
- **R2 marker**:file-tree.tsx import 加 `// FORK: 文件树菜单 i18n 2026-05-04`
- **R3 不改 token**:不动 packages/ui/ 内 i18n token,只在 app 侧加 fork-only 命名空间
- **R4 黑名单**:不涉及黑名单文件
- **diff 阈值**:324 行 < 500 行,无需 [large-diff] override
- **三文档**:Medium 规模,1-spec 改前签 / 2-plan 实施轨迹 / 3-changelog 收尾(本笔)

## 回退方法

```
git revert b9b85e343
```

或 cherry-pick 撤回:
- 删除三本 dict 的 FORK 块(末尾 49 行 × 3)
- file-tree.tsx 30 处 `language.t("fileTree.xxx")` 替换回硬编码中文
- dialog-file-tree.tsx 7 处 `language.t("fileTree.xxx")` 替换回硬编码中文 + 删 useLanguage import / hook
- 删 `docs/features/menu-i18n/`

revert 后 file-tree-ux-polish 既定改动(4 组菜单结构 / 复制路径功能 / refreshAll)继续保留,只是文案回到硬编码中文。

## 遗留挂账

- 其他 fork 文件硬编码中文(packages/app/ 域)未本次扫描;若 user 后续要做"全局 i18n",再起 feat
- packages/desktop/src/menu.ts native menu 硬编码中文未触动
- packages/ui/ 内部组件的硬编码中文(若有)属上游层,P3 适配层不展开
- **多选复制路径实际不触发 bulk toast**:`copyPathToClipboard`(`file-tree-ux-polish` 引入)的 `sel.length > 1` 分支用 `file.tree.node(p)?.absolute` 查 selection 各路径,实测 selection 多选时 node 查不到导致 paths 数组过滤后只剩 1 个,走 single toast。**user 2026-05-04 评估不需要此功能**(同目录多文件路径复制场景几乎不存在),保持原装不修。三本 dict 的 `fileTree.toast.copyPathSuccessBulk` key 保留(冗余 key 0 runtime cost,日后若启用 bulk 复制可直接用)

## 触发条件再评估

需求池(`OPENCODE-PLAN/需求池/菜单文案国际化.md`)REQ-003 触发条件是"DeskFox 走出国内 / 接英文用户"。**user 2026-05-04 拍板做** = 触发条件已被 user 主动激活(虽无明示英文用户落地,但提前铺垫属于轻成本投资,即使 0 海外用户也不亏 — 仅 ~2.5 小时工作)。
