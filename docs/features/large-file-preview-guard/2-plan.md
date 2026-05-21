---
feat-id: large-file-preview-guard
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# large-file-preview-guard — 2-plan

## 实施计划(7 步)

### Step 1:后端 `get_file_size` Tauri 命令

`packages/desktop/src-tauri/src/text_file.rs` 加新 command,跟 `get_file_mtime` 同套路:
```rust
#[tauri::command] #[specta::specta]
pub fn get_file_size(root: String, path: String) -> Result<u64, String>
```

注册到 `lib.rs` 的 `collect_commands![...]`。

### Step 2:前端 helper `utils/file-size-guard.ts`(pure module,可单测)

- `type SizeCategory = "text" | "markdown" | "media" | "office" | "html" | "binary" | "default"`
- `SIZE_LIMITS` 表
- `categoryOf(filePath)` 按 ext 分流(markdown > media > html > office > binary > text)
- `limitFor(filePath)` / `tooLargeFor(filePath, size)` / `formatSize(bytes)`

### Step 3:L1 入口闸门 `context/file.tsx` load()

重构为 async,加 size pre-check 分支:
- `cat === "media"`:不读 content,直接 `setLoaded(file, { type: "text", content: "" })` 短路
- `cat !== "binary"`:`invoke<number>("get_file_size", ...)` 比对 `SIZE_LIMITS[cat]`,超阈值设 `tooLarge` 标记跳过 read
- 其他:原 `sdk.client.file.read()` 路径不变

FileState 扩 `tooLarge?: { size, category, limit }` 字段(`context/file/types.ts`)。

### Step 4:L4 UX 组件 `components/file-too-large.tsx`

显示信息 + 2 按钮,复用 `open_path` Tauri 命令。

### Step 5:`file-tabs.tsx` 集成

- `renderMedia` 改 localasset URL,删 base64 链路(`mediaInput` 不再 invoke,直接同步设 URL)
- `renderFile` 加 tooLarge 闸:`state.tooLarge` → `<FileTooLarge>` 短路
- import `FileTooLarge` + `localAssetUrl`
- `IMAGE_MIME_FALLBACKS` 加入,`MediaKind` 扩 `"image"`,`mediaKindFromPath` 识别图片,`renderMedia` 加 `<img>` 分支
- `onMediaError` 签名扩 `HTMLMediaElement | HTMLImageElement` union(img 无 `.error` 字段)
- `canEdit()` 加 `state.tooLarge` 短路(防止编辑空 content 覆盖真实文件)

### Step 6:单元测试 19 个

`file-size-guard.test.ts`:
- `categoryOf` 7 case(markdown 优先 / media / html / office / binary / text 兜底 / 空 undefined)
- `limitFor + tooLargeFor` 7 case(各分类阈值精确比对 + media/binary 无阈值)
- `formatSize` 4 case(B / KB / MB / GB)
- `SIZE_LIMITS` 表完整性

### Step 7:typecheck + 测试回归 + release build + user 验收

---

## 决策轨迹

### 2026-05-21 office 阈值 50MB → 200MB

User 实施期反问"50MB 会不会小,是否需要这层限制"。复盘后给出 3 选项(A 维持 50 / B 升 200 / C 不限),user 选 B。理由:营销/教学 PPT 50-200MB 是常态,不应误拦;但 500MB+ 极端大稿仍需拦防 LibreOffice 卡 sidecar 拖垮其他 plugin。

### 2026-05-21 图片 viewer bug 发现 + 修复(in-feat 回归)

User 实测 .png 报告"图片不可预览"。复盘:第一版 file-size-guard.ts 把图片归 "media" category → file.tsx L2 短路设 content="" → file-tabs renderFile 调用 `mediaKindFromPath(.png)` 返 `null`(只识别 video/audio)→ 落到 renderDefault(source="") → fileComponent 显空。

修法:
1. `IMAGE_MIME_FALLBACKS` 表(png/jpg/jpeg/gif/webp/bmp/svg/ico)
2. `MediaKind` 扩 `"image"`
3. `mediaKindFromPath` 识别图片,返 `{ kind: "image", mimes }`
4. `renderMedia` 加 `<Match when={kind === "image"}>` 渲染 `<img src={localasset URL}>` 跟 video/audio 同套路
5. `onMediaError` 签名扩 union 类型,处理 `<img>` 没 `.error` 字段的情况
6. "🔊 用系统播放器打开"按钮文案 → "用本机软件打开"(图片场景无歧义)

**收益**:不仅修了 bug,还顺带补了原 OpenCode 缺失的图片 viewer 能力(此前打开 .png 走 base64 给 fileComponent 也没正经显示)。

### 2026-05-21 canEdit() 隐患修复(复审捕)

实施完整后复审发现:tooLarge 文件 contents 被设空(""),原 canEdit() 用 `tooLarge(contents())` 判断会返回 false → user 能进编辑模式 → saveEdit 会用空 draft 覆盖真实文件(数据丢失)。

修法:`canEdit()` 加 `if (state()?.tooLarge) return false` 短路,editDisabledReason 显示"文件过大,编辑已禁用"。

### 2026-05-21 build 闸门 stderr 重定向坑

PowerShell 5.1 `2>&1` 在 native exe 上把 stderr 包成 ErrorRecord 触发 ErrorActionPreference=Stop。`build-deskfox.ps1` 跑两次都被 wrap exit 1。改不带 `2>&1` 直接跑,正常通过。(后续 build 一笔脚本改进可以加 `ErrorActionPreference=Continue` 提升健壮性,本笔范围外)
