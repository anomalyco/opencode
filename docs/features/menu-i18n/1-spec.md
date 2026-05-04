---
feat-id: menu-i18n
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 文件树菜单文案国际化

## 需求来源

`D:\project\OPENCODE-PLAN\需求池\菜单文案国际化.md`(REQ-003)。

> DeskFox 文件树右键菜单/对话框/Toast 全部硬编码中文,只能给中文用户用。需求触发条件:user 决定让 DeskFox 走出国内 / 接英文用户。

2026-05-04 user 拍板做。

## 范围(只这次做的)

`packages/app/src/components/` 下两个 fork 自加文件的硬编码中文:
- `file-tree.tsx` — 文件树主组件:右键菜单 12 项 / 4 个 Dialog 入口 / 6 个 toast 标题
- `dialog-file-tree.tsx` — 通用 Prompt + Confirm 对话框:3 条校验 / 2 个取消按钮 / 2 个失败 toast

**不做**:
- fork 其他文件里的硬编码中文(仅本次扫描出 file-tree 域;其他领域日后另起 feat)
- packages/ui/ 内部组件的中文(那是上游层,P3 适配层不展开)
- packages/desktop/src/menu.ts 的 native menu(下次发现时再处理)

## 架构选型

i18n 框架**已成熟**:`@solid-primitives/i18n` + `useLanguage` context 在 `packages/app/src/context/language.tsx`,17 种语言 dict 已存在(每本 ~900 行)。**不需要选库 / 不需要搭框架**。

- en.ts 是 source of truth(`keyof typeof en` = `Keys` 类型)
- zh.ts / zht.ts 用 `satisfies Partial<Record<Keys, string>>` 校验,翻译一个子集即可
- 其他 14 种语言不动,缺 key 时框架自动 fallback 到 en

调用方式:
```ts
const language = useLanguage()
language.t("fileTree.menu.rename")             // "Rename" / "重命名"
language.t("fileTree.toast.deleteFailedBulk", { count: 3 })  // "3 items failed to delete"
```

## R3 / R2 合规

- **R3**(主题色 / 字号 / 品牌走 override,不改上游 token):dict 文件**是上游文件**,但本次只**追加 fork 自有 namespace `fileTree.*`**,不动任何上游已有 key。每本 dict 末尾用 `// FORK-BEGIN: 文件树菜单 i18n 2026-05-04` ... `// FORK-END` 块标识。
- **R2**(改上游必加 FORK marker):en/zh/zht 三本 dict 追加块各自 marker,符合
- **file-tree.tsx / dialog-file-tree.tsx 是 fork 自加文件**(无需 marker,纯改自家文件)

## key 命名约定

统一 `fileTree.*` 命名空间,二级分组:
- `fileTree.menu.*` — ContextMenu 项(rename / delete / cut / copy / paste.* / newFile / newFolder / refresh / revealInFolder / print)
- `fileTree.dialog.*` — Dialog 标题 / 标签 / 按钮 / 校验文案
- `fileTree.toast.*` — toast 标题(operationFailed / openFailed / deleteFailed{Single,Bulk} / moveFailed{Single,Bulk} / copyFailed{Single,Bulk} / pasteFailed{Single,Bulk} / undoFailedPartial)

约 38 个 key,完整列表见 `2-plan.md`。

## 验收标准

| # | 项 | 验收 |
|---|---|---|
| A1 | typecheck 全过 | `bun run typecheck` 0 error |
| A2 | release build 出 DeskFox.exe | `build-deskfox.ps1 -Env dev -NoBundle` 成功 |
| A3 | 中文 locale 下菜单文案与改造前一致 | user 切到 zh,右键文件树看 12 项菜单 + 删除/新建/重命名 dialog,对照改造前无差别 |
| A4 | 英文 locale 下菜单全部英文 | 切到 en,右键看到 "Rename / Reveal in folder / Print / Cut / Copy / Paste ... / Delete / New file (.md) / New folder",无中文残留 |
| A5 | 繁体 locale 下菜单全部繁中 | 切到 zht,右键看到 "重新命名 / 在資料夾中顯示 / 列印 / 剪下 / 複製 / 貼上... / 刪除 / 新增檔案 / 新增資料夾" |
| A6 | toast / dialog 校验文案也国际化 | 触发 (1) 名字含 `/` (2) 重名 (3) 删除失败,文案随 locale 切换 |

## 工作量

- 新加 key:38 × 3 dict = 114 行
- file-tree.tsx 改:~30 处替换(每处 1 行)
- dialog-file-tree.tsx 改:~6 处替换 + 注入 useLanguage
- 三文档:~200 行

总:medium 规模,~350 行 staged diff,单 commit 即可。

## 风险

- **Dialog 内部 `dialog.show(() => <X .../>)` 渲染回调中 `language.t()` 调用**:Solid 的 i18n 是 reactive,但 dialog 一旦显示后 locale 切换是否实时更新文案?**已知风险接受**:dialog 短命,user 切语言时 dialog 通常已关闭;不实时更新不是缺陷
- **Toast 文案凝固**:`showToast({ title: t("...") })` 取的是触发那一刻的字符串,toast 短命同理可接受
