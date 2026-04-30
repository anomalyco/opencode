---
feat-id: 查看器-自动刷新
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 查看器-自动刷新 — plan

## 实施步骤

### 1. `packages/app/src/context/file/watcher.ts` — 加 `file.edited` 分支

改前结构:
```ts
if (event.type !== "file.watcher.updated") return
const props = ...
const rawPath = ... typeof props?.file === "string" ? props.file : undefined
const kind = ... typeof props?.event === "string" ? props.event : undefined
if (!rawPath) return
if (!kind) return
// 后续:normalize → hasFile/isOpen → loadFile,kind === "change/add/unlink" 决定是否 refreshDir
```

改后结构(早分支):
```ts
const props = (typeof event.properties === "object" && event.properties)
  ? (event.properties as Record<string, unknown>) : undefined
const rawPath = typeof props?.file === "string" ? props.file : undefined
if (!rawPath) return

// 主路径:tool 直发的 file.edited(单文件刷新,不动目录树)
if (event.type === "file.edited") {
  const path = ops.normalize(rawPath)
  if (!path) return
  if (path.startsWith(".git/")) return
  if (ops.hasFile(path) || ops.isOpen?.(path)) {
    if (ops.isDirty?.(path)) {
      ops.notifyDirtyConflict?.(path)
      return
    }
    ops.loadFile(path)
  }
  return
}

// 兜底:OS watcher 触发的 file.watcher.updated(原逻辑)
if (event.type !== "file.watcher.updated") return
// ... 原逻辑,只在 hasFile/isOpen 命中后追加 isDirty 守卫
```

`file.watcher.updated` 路径里 `loadFile` 调用前也加 `isDirty` 守卫(顺手补,不让外部编辑也覆盖 draft)。

### 2. `packages/app/src/context/file.tsx` — 暴露 dirty 守卫接口

- 内部新建 `dirtyPaths: Set<string>`(普通 JS Set,不需要 reactive,只用作 watcher 守卫的查表)
- 暴露三个 op:
  - `markDirty(input: string, dirty: boolean)` — normalize 后 add/delete
  - `isDirty(input: string): boolean` — normalize 后 has
  - `notifyDirtyConflict(path: string)` — 复用 `showToast`(language.t 多语言键 `toast.file.dirtyConflict.title` + description)
- `WatcherOps` type 加可选字段 `isDirty?` / `notifyDirtyConflict?`
- `sdk.event.listen` 回调里把这俩 op 接进去

### 3. `packages/app/src/pages/session/file-tabs.tsx` — 在编辑态切换时调 markDirty

- `startEdit` / `cancelEdit` / `reloadAndExitEdit` / `saveEdit` 成功后:都要调 `file.markDirty(path, false)`(退出编辑态 = 不再 dirty)
- `setDraft` 之后:`createEffect(on(dirty, ...))` 监听 dirty memo 变化,调 `file.markDirty(path, dirty())`
- 注意:`dirty()` 是 createMemo,以 `draft() !== contents()` 推算;watcher 触发的 `setLoaded` 会更新 `contents()`,可能导致 `dirty()` 反转(从 true 变 false 因为 draft 与新 contents 巧合相同)— 这种巧合极低概率,可忽略

### 4. `packages/app/src/i18n/{en,zh,zht,...}.ts` — 加多语言键

- `toast.file.dirtyConflict.title`:中文 "AI 修改了此文件" / 英文 "AI modified this file"
- `toast.file.dirtyConflict.description`:中文 "你的草稿已保留。保存时会让你选择是否覆盖磁盘版本。" / 英文 "Your draft is preserved. On save you'll be prompted to choose."
- 其他语言走英文(原项目 i18n 习惯,新键不强制全语言齐)

### 5. `packages/app/src/context/file/watcher.test.ts` — 加测试

- 验 `file.edited` 事件分支:hasFile=true / isOpen=true / 都 false / isDirty 守卫
- 不动原有 `file.watcher.updated` 测试

### 6. 同笔 commit

5 个文件强耦合,中间态(只改 watcher.ts 没暴露 isDirty 接口)无法编译,合 1 笔。预估 ~50-80 行 staged,在 Medium 区间(<500),无 large-diff 标。

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| `file.edited` 处理位置 | A. 复用同 handler 加分支 / B. 独立 handler | A | watcher.ts 已经是事件分发函数,新分支自然嵌入,不引入第二个 listener;原 file.tsx 也保持单点订阅 |
| dirty 守卫存储 | A. solid store / B. 普通 Set | B | dirty 守卫只用作 watcher 查表,无 UI 反应性需求;Set 轻量,避免触发不必要的 createEffect |
| dirty 守卫接口位置 | A. 暴露在 useFile / B. 单独 createDirtyStore | A | 守卫与 file 生命周期绑定,API 收口在 useFile 一致;新 store 增加一层无收益 |
| 编辑态保护策略 | A. 跳过 reload + 弹提示 / B. reload 但保留 draft | A | B 会让 contents() 改变,CodeMirror 的 createEffect 可能重写 doc 内容(`code-mirror-view.tsx:46-51` 检测 doc 不等就 dispatch);A 简单且语义清晰 |
| toast vs window.confirm | A. toast(被动通知) / B. confirm(强制选择) | A | confirm 阻塞用户,且 saveEdit 时已有 mtime conflict 二选一弹窗;此处只是"通知发生了"足够,不需立即决策 |
| 是否同时清理 watcher.ts 里的 console.debug | A. 顺手清 / B. 留着 | B | 反对"顺手改";debug 是诊断价值的,本 fix 不为它,留作未来诊断工具;若想清,单开 commit |

## 风险

- **dirty 守卫漏调用**:如果 `markDirty` 在某个编辑态切换路径漏调(如 tab 切换 / 文件切换 / 异常退出),Set 残留 stale path → 后续即使没在编辑也会被守卫挡住 reload。**对策**:`createEffect(on(path, ...))` 切 path 时 cleanup 旧 path 的 dirty 标记,加 `onCleanup` 兜底
- **`file.edited` 路径与 `file.watcher.updated` 顺序**:不一定哪个先到,但 `load` 的 `inflight` 去重保证只发一次网络请求,无副作用
- **server 不存在 `file.edited` 事件类型时**:不会发生 — schema 已经在 SDK gen 文件里(`packages/sdk/js/src/v2/gen/types.gen.ts:58`),server 三个 tool 也已发,client 只是新加监听,无依赖风险
- **i18n 键缺失语言**:其他语言落英文 fallback,不报错(原项目机制)
- **回退**:`git revert <hash>` 一次到位,无 schema 变更

## 预算

| 项 | 行数 |
|---|---|
| `context/file/watcher.ts`(新分支 + dirty 守卫调用)| ~25 行 |
| `context/file.tsx`(dirty Set + 3 个 op + ops 注入)| ~20 行 |
| `pages/session/file-tabs.tsx`(markDirty 调用 + 切 path cleanup)| ~10 行 |
| `i18n/{en,zh,zht,ja,ko,...}.ts`(2 个键 × 多语言)| ~30 行(占总行数大头但内容简单) |
| `context/file/watcher.test.ts`(新分支测试)| ~30 行 |
| **代码 staged** | **~115 行**(<500 阈值,Medium 级,无 large-diff) |
| 文档(本目录三件) | ~250 行(不计阈值) |

## 验证脚本

照规范走 `D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle`(memory 已记会自动杀进程不询问),~2 分钟出 `DeskFox.exe`,user 双击验 R1-R6。

## 走过的弯路 / 中途调整

- **R1 首轮验证失败 — Windows 路径分隔符不一致**(主弯路):写完代码 + 测试全过 + release build 后,user 双击验 R1 仍失败,需 F5。
  - 调研发现 `packages/app/src/context/file/path.ts` 在 upstream commit `082f0cc12` 故意保留 native separators(Windows 返回反斜杠相对路径如 `"docs\\foo.md"`),但 store key 经 tab URL `encodeFilePath` → `decodeFilePath` 后实际是正斜杠(`"docs/foo.md"`)。`hasFile` / `isOpen` 直接比对必丢。**单段文件巧合命中**(无分隔符),**多段必丢** — user 测试用的 `.md` 在子目录里,正中陷阱。
  - 修法选项:① 改 `path.normalize` 始终返正斜杠(动 upstream 还要更新现有测试,顶 upstream 设计);② 在 watcher.ts(fork-only)做局部 `toUnix` 转换。**选 ②**,理由 P1 隔离,不顶 upstream。
- **R7 临时新增 — toast 洪泛**(工艺细节):R1 通过后,user 反馈编辑态被 AI 写时**3 个堆叠 toast**。原因:同一次 AI 写触发 ① `file.edited`(tool 直发)② `file.watcher.updated`(write.ts:64 显式发)③ parcel/watcher OS 监听 ④ 可能的 format pass 多次写。各路径都 isDirty 守卫命中 → 各弹 1 个 toast。
  - 修法:`notifyDirtyConflict` 加按 path 的 2 秒去重窗口,Map 内部维护 last-shown 时间。Set/Map 大小超 32 时顺手清过期项,不无限增长。
  - 这点 spec 阶段没预见到,加进 1-spec.md 验收的话会是 R7。本次直接在第二轮 build 修复并验过。
- **设计 / 架构层零弯路**:核心思路(`file.edited` 主链路 + `file.watcher.updated` 兜底 + 编辑态守卫)从一开始就对,代码量也符合预算。两个弯路都是 Windows 平台的实现细节。
