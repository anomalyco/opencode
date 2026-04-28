---
feat-id: 查看器-自动刷新
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 查看器-自动刷新 — changelog

**关联 commit**: `765b53f83`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线
**触发原因**: User 报模型 Edit/Write 修改 `.md` 文件后查看器不刷新,需 F5。详见 `1-spec.md` 触发原因段(server 双事件源,client 漏挂 `file.edited` + Windows 路径分隔符不一致)。

## 实际改动

### `packages/app/src/context/file/watcher.ts`(+37 / -3)

- `WatcherOps` 加可选 `isDirty?: (path) => boolean` / `notifyDirtyConflict?: (path) => void`
- 重排控制流:抽出公共 `props` / `rawPath` 解析在最前
- **新增 `file.edited` 分支**(主路径,tool 直发):normalize → `.git/` 跳过 → 守卫 hasFile/isOpen → 守卫 isDirty(命中则 notifyDirtyConflict 而非 loadFile)→ loadFile force:true。**不动目录树**(单文件事件)
- **`file.watcher.updated` 分支(原)的 loadFile 也加 isDirty 守卫**:外部编辑场景下也保护用户草稿
- **加 `toUnix()` 反斜杠 → 正斜杠转换**:upstream commit `082f0cc12` 故意保留 native separators,但 store key 走 tab URL encode/decode 后实际是正斜杠;不转换会让多段路径(如 `docs/foo.md`)的 hasFile/isOpen 比对必丢。这是首轮 R1 失败的根因
- 加 `console.debug("[fs.watcher] file.edited", ...)` 与原 watcher.updated debug 配对,便于 DevTools 诊断

### `packages/app/src/context/file.tsx`(+43 / -1)

- 内部新建 `dirtyPaths: Set<string>` 守卫存储(普通 JS Set,无 reactive 需求)
- `markDirty(input, dirty)` / `isDirty(input)` 走 `path.normalize` 兜底
- `notifyDirtyConflict(file)`:**带 2 秒去重窗口**(同一 path 2s 内重复触发只弹 1 次 toast)。原因:同一次 AI 写会触发 `file.edited` + `file.watcher.updated`(write.ts:64 显式发) + parcel/watcher OS 监听 + 可能的 format pass 多次写,不去重的话 toast 3-4 个堆叠
- `sdk.event.listen` 回调 ops 注入 `isDirty` / `notifyDirtyConflict`
- `useFile` 返回值暴露 `markDirty` / `isDirty` 给 `FileTabContent` 用

### `packages/app/src/pages/session/file-tabs.tsx`(+16 / -0)

- 加 `createEffect(on(() => ({ p: path(), d: dirty() }), ...))`:path 切换时 cleanup 旧 path 的 dirty 标,新 path 同步当前 dirty 状态
- 加 `onCleanup(() => file.markDirty(path(), false))`:tab 关闭兜底清理

### `packages/app/src/i18n/{en,zh,zht}.ts`(各 +2)

- `toast.file.dirtyConflict.title` / `toast.file.dirtyConflict.description`
- 其他语言落英文 fallback(原项目 i18n 习惯)

### `packages/app/src/context/file/watcher.test.ts`(+147 / -0)

新 `describe("file.edited tool-direct invalidation")` 块,6 个测试:
- 主路径 reload(hasFile / isOpen 两条命中)
- isDirty 守卫(skip load + notifyDirtyConflict)
- 不在 cache/tab 时的 no-op
- `.git/` 路径跳过
- `file.watcher.updated` 路径也支持 isDirty 守卫(外部编辑场景)

### 文档

- `docs/features/查看器-自动刷新/{1-spec,2-plan,3-changelog}.md`(新建)
- `docs/features/INDEX.md` 索引行 status: planning → in-progress → done

## 行数

| 项 | 行数 |
|---|---|
| watcher.ts(主修)| +37 / -3 |
| file.tsx(dirty Set + 守卫)| +43 / -1 |
| file-tabs.tsx(dirty 同步)| +16 |
| i18n × 3 | +6 |
| watcher.test.ts | +147 |
| INDEX.md | +1 |
| **代码 + 测试 staged** | **~246 行**(<500 阈值,Medium 级,无 large-diff) |
| 文档(新文件,不计阈值)| ~470 行 |

## 影响范围

- ✅ `.md` / `.py` / `.html` / `.ts` / `.json` 等文件查看器打开的所有文本格式,模型 Edit/Write 后秒级自动刷新
- ✅ ApplyPatch 多文件批改一次性刷新所有打开的 tab
- ✅ 外部编辑(VSCode / 系统记事本)走 OS watcher 兜底链路,原能力保留
- ✅ 编辑态(用户有未保存 draft)被 AI 写不再覆盖草稿,弹 toast 通知
- ✅ Windows 多段路径(如 `docs/foo.md`)正确匹配 — 反斜杠/正斜杠不一致问题修复
- ⚠️ 同一次 AI 写多事件场景下 toast 不再洪泛(2 秒窗口去重)
- ✅ server 端零改动

## 回归测试点

均按用户在 release `DeskFox.exe`(`packages/desktop/src-tauri/target/release/DeskFox.exe`,1m11s 实编译)双击实测通过:

- **R1 主路径** — `.md` Edit/Write 后秒级自动刷新 → ✅(首轮失败,Windows 路径分隔符问题修复后通过)
- **R2 多格式** — `.py` / `.html` / `.ts` / `.json` → ✅
- **R3 ApplyPatch 多文件** → ✅
- **R4 编辑态保护** — 草稿未被覆盖,弹 toast → ✅
- **R5 外部编辑兜底** — VSCode 改文件 → ✅(parcel/watcher 路径不破坏)
- **R6 重复刷新无副作用** — `inflight` Map 去重正常 → ✅
- **R7(临时新增,工艺细节)** — 编辑态被 AI 写时 toast 数 = 1(2 秒窗口去重生效)→ ✅(第二轮 build 后)

## review 自检

- [x] 仅触动 fork 白名单(`packages/app/src/context/file/` + `packages/app/src/context/file.tsx` + `packages/app/src/pages/session/file-tabs.tsx` + `packages/app/src/i18n/{en,zh,zht}.ts` + `docs/features/`)
- [x] 改 fork-only 文件 `watcher.ts` / `watcher.test.ts` / `file.tsx` 加 FORK 标
- [x] 不动 `path.ts`(upstream 故意保留 native separators 设计,绕过它在 watcher.ts 做转换)
- [x] git diff --stat 在预算内(staged 246 行 vs 预算 ~115 + 测试 30 ≈ 145,实际多 ~100 行因测试更彻底,合理超额)
- [x] 无新增依赖
- [x] typecheck 全过(14/14)
- [x] watcher 测试 10/10 通过
- [x] release 构建 2 次都成(初版 + toast 去重二次)
- [x] 用户双击 R1-R7 全过

## 已知遗留

- **path.normalize 在 Windows 上保留反斜杠是 upstream 设计** — 我们绕过,但本质冲突仍在。后续若 upstream 改为正斜杠,绕过代码可清理;若 upstream 加更多依赖反斜杠的逻辑,需要再评估。
- **server 端 console.debug 残留** — 原 `[fs.watcher]` debug log 是诊断利器,本次顺手为 `file.edited` 也加了同款 debug,留作未来诊断用。不计入"顺手清理"范畴。
- **同一文件 2 秒内多次 AI 写**只弹 1 个 toast — 第二次起的修改用户不会被通知。如果用户错过中间状态可能困惑,但比 toast 洪泛优先级高。

## 回退方法

```
git revert <code commit hash>
```

5 个文件无 schema 变更,server 完全不感知。docs 可保留作为决策记录,无需 revert。
