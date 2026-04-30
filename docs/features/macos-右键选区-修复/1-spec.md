---
feat-id: macos-右键选区-修复
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-右键选区-修复 — spec

## 触发原因

User 报:macOS 桌面端(Tauri / WKWebView)文件查看器选中代码 / Markdown 文字 → 在文字上右键 → 选区视觉**消失**,只剩被点中的那个词的高亮。空白处右键正常。Windows 端无此问题(Chromium WebView2)。

更糟的是右键弹出菜单里"添加到聊天窗口"传给模型的文本也是错的 —— 不是用户多行选区,而是 collapse 后的单词("55"、"777"、"openclaw" 之类)。

## 双层根因(实测确认)

### 根因 1 — Pierre 渲染走 Shadow DOM,标准选区 API 取不到文本

代码文件查看器(.py / .ts 等)用 Pierre 的 `<diffs-container>` 自定义元素,内容渲染在 Shadow DOM 里。WebKit:

- `window.getSelection().toString()` 对 Shadow DOM 内容**返空串**
- `ShadowRoot.getSelection()` 是 Chromium 专有,WebKit 没有
- 跨 Shadow 的选区只能用 `Selection.getComposedRanges({ shadowRoots: [...] })` 读(WebKit 17+ 才有,签名必须用 options object 形式 — 与 Pierre 自家 `file-selection.ts:59` 一致)

### 根因 2 — macOS WebKit 右键 OS 级强制 collapse 选区

macOS WKWebView 在右键 mousedown 时,**OS 层**把选区 collapse 到点中的那个词:

- `mousedown preventDefault()`(capture phase)拦不住 — 这是 OS 行为,不在 JS 默认动作范围
- collapse 后立即触发 `selectionchange`,污染任何缓存
- 时机不定:`selectionchange` 可能在 `mousedown` JS handler 之**前**(时机 A)或**后**(时机 B)触发

任何"以 mousedown 为时间锚点"的方案对 A/B 两种时机都难一概到位 —— 实测三轮失败:

1. **第一轮 preventDefault** —— OS 行为拦不住
2. **第二轮 rightClickActive flag 屏蔽 selectionchange** —— 时机 A 失效(flag 还没立坏值已写)
3. **第三轮 mousedown 时 pop 100ms 内栈顶 + 250ms 屏蔽** —— 用户刚选完就右键时把真实选区 pop 掉,栈空 → fallback 读 `window.getSelection()` 拿到 collapse 后的词

## 验收标准

- [ ] R1 `.py` / `.ts` / `.html` 等 Pierre 渲染文件 drag 选 ≥2 行,文字上右键 → 菜单"添加到聊天窗口"携带**完整原始多行文本**,不是单词
- [ ] R2 `.md` 文件(light DOM,Markdown 渲染)同样行为
- [ ] R3 空白处右键(WebKit 不 collapse)继续正常,不退化
- [ ] R4 右键时**红色覆盖块**清晰落在原始选区上(md / py 视觉一致),色号与 Windows 同操作一致
- [ ] R5 点"添加到聊天窗口" → 输入面板 → 点"加入聊天"或"取消"或菜单外空白 → **红色覆盖和原生选区同步消失**,页面回到无选区干净态
- [ ] R6 滚动文档 → 红色覆盖自动清(viewport rect 失效,不 stale)
- [ ] R7 模型回答能复述/识别选中文字(与 `加聊天-preview-fix` 已有链路兼容,本 feat 不动 preview 通道)

## 不做什么

- **不改 Pierre 上游**(`packages/ui/src/pierre/*`):Pierre 自家 `readShadowLineSelection` 已用 `getComposedRanges`,我们只在 fork-only 调用层补齐,不动上游 contract
- **不动 server 端 prompt 管线**:本 feat 纯前端选区捕获 + 视觉,与 server 完全无关
- **不修 Pierre 黄色行选区**(`--diffs-bg-selection` 行底色):那是 Pierre 自家的多行选区视觉,与本 feat 的"右键菜单期间临时高亮"是两码事;关闭菜单时一并清掉即可,不动 Pierre 自家渲染
- **不试图阻止 WebKit collapse**:OS 行为,JS 拦不住,改用"事后挑最长"绕开
- **不重新启用 Tauri devtools 在 release**:仅诊断阶段开过,定位完成后撤回

## 架构选型

### 选区文本捕获 — 选区历史栈 + 最长策略

`selectionchange` **无脑全记录**所有非空选区到 `selectionHistory`(限 16 条),contextmenu 时**从最近 30 秒里挑文本最长的那条** —— WebKit collapse 出的单词永远比用户多行选区短,挑最长就是对的。

理由:
- 时机 A / B 通吃:不依赖 mousedown 时间锚点
- 实现简单:一个数组 + 一个挑选函数,无 flag 状态机
- 实测可靠:用户实测 picked.idx=15 picked.len=80,栈里 [4..N] 都是 1-3 字短词,正确跳过

### 视觉高亮 — overlay div 而非 CSS Custom Highlight

第一版用 `CSS.highlights.set/delete + ::highlight()` pseudo-element,实测 macOS WKWebView 上 `delete()` **不能立即触发 repaint**(WebKit stale 渲染 bug),即便先 `set` 一个 collapsed 空 range 兜底也压不住 —— 用户点"加入聊天"或点空白处关菜单后,红色高亮死活不消失,只能刷新页面才清。

改用 **`range.getClientRects()` + Solid 信号驱动的 fixed overlay div**:
- 显示:每行一个 `<div>` 绝对定位渲染
- 清除:`setHighlightRects(null)` → Solid 立刻 unmount,WebKit 没机会缓存
- 滚动:绑 `scroll` capture 监听,直接清掉(viewport rect 会失效)
- md / py / Pierre Shadow DOM 都走同一渲染路径,视觉天然一致

颜色:`rgba(209, 52, 56, 0.5)` (Microsoft Fluent 系统红 #d13438 半透明),与 Windows 同操作色一致。

### 关闭菜单时统一清理

`closeMdMenu()` 集中清三件:
1. `setSelectionHighlight(null)` 清红色 overlay
2. `window.getSelection()?.removeAllRanges()` 清原生字符级选区
3. `setNote("selected", null)` + `file.setSelectedLines(p, null)` 清 Pierre 整行黄色色块

"加入聊天"提交路径和"取消"按钮路径都走同一份清理,无遗漏。

## 关联

- 上次相关 fix:`加聊天-preview-fix`(synthetic text 加 preview 段),本 feat 解决的是**选区怎么被捕获**,与那个的**选区文本怎么进 prompt** 互补不冲突
- Pierre 自家选区参考:`packages/ui/src/pierre/file-selection.ts:59-61`(getComposedRanges 签名样板)
- 触发的多次迭代讨论详见 `2-plan.md` 决策轨迹段
