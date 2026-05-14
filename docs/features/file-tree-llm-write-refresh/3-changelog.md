---
feat-id: file-tree-llm-write-refresh
status: done
related: ./3-changelog.md
---

# AI 创建新文件后右侧文件树不刷新

## 需求来源

User 2026-05-15 实测反馈:LLM 任务里 AI 创建新文件后,右侧文件树不会自动出现新文件,**需要 F5 / 重启 app** 才能看到。

## 根因(read-only trace 定位)

触发路径:

1. User 之前展开过某目录(比如 `output/`)→ `tree-store` 记录 `loaded: true, expanded: true, children: [...]`
2. User 折叠该目录 → `expanded: false`,但 `loaded: true` **保留**(缓存优化,避免重复 fetch)
3. AI 写入 `output/newfile.html` → 后端发 `file.edited` 事件
4. `watcher.ts` 主路径(line 38)对 `!hasFile && !isOpen` 直接 return — **不刷目录树**
5. `session-side-panel.tsx` 的 busy→idle 兜底刷新调 `refreshAllExpanded("")` — 只 force-list **当前 expanded** 的目录(`tree-store.ts:171`),`output/` 因 `expanded=false` 被跳过
6. User 重新展开 `output/` → `expandDir → listDir` 不带 force → 见 `loaded:true` 直接 `Promise.resolve()`(`tree-store.ts:47`)→ 拿到**旧 children 列表**,看不到 newfile
7. 唯一破解 = `reset()` 整个 tree(F5 / app 重启)

## 修法

`watcher.ts` 的 `file.edited` 分支扩展:`!hasFile && !isOpen` 时不再直接 return,**先看父目录是否 loaded**,是则 `refreshDir(parent)` 把新文件加进 children,让下次展开自动浮现。

```ts
if (!ops.hasFile(path) && !ops.isOpen?.(path)) {
  const parent = path.split("/").slice(0, -1).join("/")
  if (ops.isDirLoaded(parent)) ops.refreshDir(parent)
  return
}
```

5 行实质改动 + 注释。`file.edited` 命中已存在文件的 reload 走原 loadFile 路径,无回归。

## 边界情况

| 场景 | 行为 |
|---|---|
| AI 修改已存在文件 | `hasFile=true` → loadFile reload 文件内容(原行为)|
| AI 新建文件,父目录已加载(loaded) | ✅ refreshDir(parent),children 立即更新 |
| AI 新建文件,父目录未加载(从未展开过)| isDirLoaded=false,不动;user 首次展开时自然 fetch 到最新列表 ✅ |
| AI 新建嵌套深目录 `a/b/c/d.html`,`c/` 未 loaded | 父目录刷不到;若 `b/` loaded,等服务端发 `file.watcher.updated kind=add` 由现有代码兜底(line 79-83)|
| `.git/` 路径 | `startsWith(".git/")` 早 return ✅ |

## 文件改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/context/file/watcher.ts` | `file.edited` 主路径加 refresh 父目录分支 + FORK marker 注释 | +9 / -2 |
| `packages/app/src/context/file/watcher.test.ts` | 1 个现有测试 expect 增强(覆盖 refresh 不发) + 2 个新测试覆盖新行为 | +60 / -2 |

总 +69 / -4,Tiny tier。

## R5 测试纪律

**先写复现测试 + bug-repro tag**(R5 修 bug 强制):

| 测试 | 覆盖 |
|---|---|
| `does not loadFile for files not open or cached, and does not refresh dir when parent not loaded` | 父目录 isDirLoaded=false → 不动(原行为)|
| `refreshes parent dir on file.edited when path is new but parent loaded (AI create-file scenario)` | **复现+修复验证** — 父目录 loaded → refreshDir(parent) 触发 |
| `file.edited new file at root refreshes root when root loaded` | 根目录场景(parent="") |

`watcher.test.ts` 从 10 → 12 测试,全过。

## 验证

| 项 | 结果 |
|---|---|
| `bun test watcher.test.ts` | ✅ 12/12 全过 |
| `bun run typecheck` | ✅ 16/16 全过 |
| `build-deskfox.ps1 -Env dev -NoBundle` | ✅ 3m00s |
| user runtime 实测 — AI 创建新文件后文件树自动出现 | ✅ |

## R 合规

- **R2**:`watcher.ts` 加 FORK marker `2026-05-15` + feat-id
- **R3**:不涉及品牌/主题/icon
- **R4**:0 override,`packages/app/src/context/file/` 在白名单
- **R5**:复现测试先写 + `[bug-repro: ...]` commit tag + 增量测试覆盖 — 强制项全过
- **R6**:不涉及网络监听

## 回退

```
git revert 5aa50eeec
```

`watcher.ts` 回到原状(`file.edited !hasFile && !isOpen` 直接 return),user 重新撞此 bug;新增测试需手动删(它们会 fail)。

## 关联

- **复用**:`查看器-自动刷新`(2026-04-28 立的 `file.edited` 事件 + dirty 守卫)— 本笔在同一 watcher 主路径补漏
- **关联**:`file-tree-ux-polish` 的 busy→idle 边沿刷新(`refreshAllExpanded`)— 本笔补 watcher 层即时刷新,与 busy→idle 兜底层互不冲突;watcher 实时 + busy→idle 全量,两层防护
