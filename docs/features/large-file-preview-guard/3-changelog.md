---
feat-id: large-file-preview-guard
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# large-file-preview-guard — changelog

**关联 commit**: `<本笔 commit>`(代码 + 测试)+ `<本笔 docs>`(三文档)
**所在分支**: `feat/large-file-preview-guard`
**规模**: Medium(~370 行 / 8 文件 / 3 新)
**需求来源**: REQ-025(`OPENCODE-PLAN/需求池/大文件预览统一防护.md`,2026-05-21 入池)

## 实际改动

### 后端(Rust)

#### `packages/desktop/src-tauri/src/text_file.rs`(+13)

新 Tauri 命令 `get_file_size`,跟 `get_file_mtime` 同套路,返回 `Result<u64, String>`。`!md.is_file()` 防御指向目录的情况。

#### `packages/desktop/src-tauri/src/lib.rs`(+1)

注册 `text_file::get_file_size` 到 `collect_commands![...]`。

### 前端(SolidJS)

#### `packages/app/src/utils/file-size-guard.ts`(新,+97)

pure helper(无 SolidJS context 依赖):
- `SizeCategory` 7 类
- `SIZE_LIMITS` 表(text/markdown/html 10MB / office 200MB / media+binary ∞ / default 100MB)
- `categoryOf(filePath)` ext 分流
- `limitFor` / `tooLargeFor` / `formatSize`

#### `packages/app/src/utils/file-size-guard.test.ts`(新,+126)

19 单测,覆盖:
- `categoryOf` 7 case(markdown 优先 / media / html / office / binary / text 兜底 / 空 undefined)
- `limitFor + tooLargeFor` 7 case(各分类阈值精确比对 + media/binary 无阈值)
- `formatSize` 4 case
- SIZE_LIMITS 表完整性

#### `packages/app/src/components/file-too-large.tsx`(新,+89)

L4 UX 兜底组件,2 按钮(用本机软件打开 / 打开所在文件夹),复用 `open_path` Tauri 命令。

#### `packages/app/src/context/file/types.ts`(+8)

`FileState` 扩 `tooLarge?: { size, category, limit }`,新 `FileTooLargeMark` 类型。

#### `packages/app/src/context/file.tsx`(+47 / -9)

L1 入口闸门:`load()` 重构 async,加 size pre-check:
- `cat === "media"`:直接 setLoaded 空 content 短路(走 localasset 不读)
- `cat !== "binary"`:invoke `get_file_size`,超 `SIZE_LIMITS[cat]` 设 tooLarge 标记
- stat 失败 fallthrough 走原 read 路径(权限/不存在等)

#### `packages/app/src/pages/session/file-tabs.tsx`(+50 / -71)

- L2 媒体 localasset 化:`renderMedia` 同步用 `localAssetUrl(root, abs)` 设 URL,删 base64 链路(`mediaInput` 不再 invoke / `releaseMediaBlob` / `base64ToBlob` / `currentBlobUrl` / `loading` 状态全删)
- `IMAGE_MIME_FALLBACKS` 表 + `MediaKind` 扩 `"image"` + `mediaKindFromPath` 识别图片
- `renderMedia` 加 `<img src=localasset>` Match 分支
- `onMediaError` 签名扩 `HTMLMediaElement | HTMLImageElement` union
- "🔊 用系统播放器打开" → "用本机软件打开"(图片场景去歧义)
- `renderFile` 加 tooLarge 短路 → `<FileTooLarge>`
- `canEdit()` 加 `state.tooLarge` 守卫(防空 draft 覆盖真实文件)
- `editDisabledReason` 加 tooLarge 文案

## 行数

| 项 | 行数 |
|---|---|
| Rust(text_file.rs + lib.rs) | +14 |
| utils/file-size-guard.ts(新) | +97 |
| utils/file-size-guard.test.ts(新) | +126 |
| components/file-too-large.tsx(新) | +89 |
| context/file/types.ts | +8 |
| context/file.tsx | +47 / -9 |
| pages/session/file-tabs.tsx | +50 / -71 |
| **净** | **~370 行(+431 / -80)** |

Medium 规模,超 500 行单 commit 阈值(pre-commit hook 触发),决议拆 2 笔 commit:① backend + helper + tests(~240 行)② frontend integration(~190 行)。Commit message 加 `[large-diff]` 论证拆分理由。

## 验证

| 项 | 结果 |
|---|---|
| `bun run typecheck` | EXIT=0(monorepo 16/16) |
| `bun test src/utils/file-size-guard.test.ts` | ✅ 19/19 |
| `bun test src/utils/ src/components/prompt-input/` 回归 | ✅ 71/71(0 破坏) |
| `bun test src/utils/ src/components/prompt-input/ src/context/` 全量 | ✅ 383/383 |
| `build-deskfox.ps1 -Env dev -NoBundle` 2 次(初版 + 图片 fix) | ✅ ~1m40s |
| user runtime A3(打开 .png/.jpg/.svg) | ✅ 图片正常显示(原"图片不可预览"修复)|
| user runtime A2/A6(打开视频) | ✅ 走 localasset 播放 + seek |
| user runtime A9(中等 PPT 50-200MB) | ✅ 不被拦,正常 LibreOffice 转 PDF |
| user 验收测试 | ✅ 通过 |

## 复审捕获的隐患(commit 前)

| 隐患 | 修复 |
|---|---|
| **canEdit() 漏洞**:tooLarge 文件 contents 已空,原 `tooLarge(contents())` 判断 false → user 能进编辑用空 draft 覆盖真实文件 → **数据丢失** | 加 `state.tooLarge` 短路 + editDisabledReason 文案 |
| **图片 viewer 缺位**:第一版 image 归 media category 短路,但 mediaKindFromPath 只识别 video/audio → 落 renderDefault 显空 → "图片不可预览" | 扩 MediaKind 加 image 分支 + renderMedia 加 `<img>` Match |
| **`onMediaError` 签名只支持 HTMLMediaElement**:img 没 `.error`,直接访问会炸 | 签名扩 union 类型,img case 走 `target.complete && target.naturalWidth === 0` 推断 |

## R 合规

- **R2** FORK marker:Tauri 命令头注(text_file.rs)+ helper 头注(file-size-guard.ts)+ 组件头注(file-too-large.tsx)+ types.ts FileTooLargeMark 段 + file.tsx FORK-BEGIN/END 块 + file-tabs.tsx 各 FORK 段
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全在 fork 白名单)
- **R5** Medium 规模新功能,19 个单测覆盖 helper 全分类边界;集成路径(load → file-tabs)由 user runtime e2e 验收
- **R6** 不涉及网络监听

## 回退

```
git revert <feat-commit-hash> <docs-commit-hash>
```

回退后所有 viewer 回到 OOM-prone 状态(read_binary_file_base64 媒体链路 + 无 size pre-check + 无 tooLarge UX)。

## 关联

- **延续**:`html-viewer-ux-polish` 的"HTML iframe + 10MB + localasset Range" 模式被本笔抽象为通用 L1+L2 套路
- **复用**:`md-office-improvements` 落地的 `localasset://` + Range protocol 是本笔 L2 的现成基础设施(`local_asset.rs:21-286`)
- **基础设施**:`get_file_size` Tauri 命令未来其他需求复用(如 fs 监控 / dirty 检测 / 大文件警告)
- **不重叠**:CodeMirror virtual scrolling 是 viewer 内部优化,本笔是"决定哪些文件不该进 viewer",正交
