---
feat-id: html-viewer-allow-scripts
status: done
related: ./3-changelog.md
---

# HTML 预览开启 allow-scripts — 翻页等内嵌 JS 生效

## 需求来源

User 2026-05-14 实测:打开 `D:\Kbase\白领AI办公效率课\课程大纲\第一模块 2课时\PPT_第2课时_风格迁移与迭代优化.html`(讲师版 PPT,21 页),底部有 `◀ 1 / 21 ▶` 翻页按钮但点击无反应。本质是页面用 JS 切换 slide 可见性,而 HTML 预览 iframe 当前 sandbox 不允许脚本执行。

## 根因

`packages/app/src/pages/session/file-tabs.tsx:1493` 的 iframe sandbox 写死 `allow-same-origin`,**没有** `allow-scripts`。这是 `md-office-improvements` Phase 1(2026-05-05,commit `5fe16d193`)立的安全约束(spec A1.9:"HTML 内 `<script>` 失活"),当时基于"用户想看渲染后样子,JS 执行属于运行 HTML 应用另一个层面"的判断。

但实际用户场景(本地 .html 文件多是自己写的或可信源,常带翻页 / 折叠 / tab 等纯 DOM 交互),失活 JS = 这些内置功能全废,体验上等于"只能看头一屏静态画面"。原 spec 高估了威胁,低估了使用面。

## 解法

在 iframe sandbox 加 `allow-scripts` token,与既有 `allow-same-origin` 并存。

### MDN "scripts + same-origin 危险组合"警告不适用的论证

MDN 文档警告同时开 `allow-scripts` 和 `allow-same-origin` 时,**前提**是 iframe 内容与父页面同源 — 那种情况下 iframe 内 JS 可访问 `parent.document` 并移除自身 sandbox 属性,等于完全失效。

本场景下:
- 父页面 origin = app webview(`tauri://localhost` / `http://tauri.localhost`)
- iframe URL origin = `localasset://localhost/...`(自定义 protocol)

**跨 origin**,iframe 内 JS 无法访问 parent。`allow-same-origin` 在这里的作用仅是让 iframe 文档保持其 `localasset://` origin(否则会被强制成 null opaque origin,内部 `fetch('./data.json')` 等同源请求会失败 — 这正是某些幻灯片库需要的)。

## 影响范围

- **修复**:.html 预览内的 `<script>` 现在执行 — 翻页 / 折叠 / tab / 简单交互组件全部生效
- **新风险**:打开**未知来源**的恶意 HTML 时,JS 会跑(可能向外发请求探测 / 修改 DOM 等)。可接受 — 用户工作区的 .html 通常自己写或可信源,与浏览器开本地 .html 同等风险。父页面跨 origin 隔离仍在,iframe JS 无法访问 app 自身数据
- **不变**:大文件(>2MB)依然自动退源码;预览 / 源码 toggle 不变;`<iframe>` 不允许 top navigation(没开 `allow-top-navigation`)

## 文件改动

| 文件 | 改动 |
|---|---|
| `packages/app/src/pages/session/file-tabs.tsx` | iframe sandbox:`allow-same-origin` → `allow-same-origin allow-scripts`;注释一并更新 |

实际 diff:2 行。

## 验证

- ✅ 待 user 用问题 PPT 实测翻页

## R2 / R3 / R4 合规

- **R2**:既有 FORK 注释更新,加一行 `// FORK: 2026-05-14 开 allow-scripts ...` 说明反转原因
- **R3**:无关
- **R4**:fork-only 文件,0 黑名单 override
- **规模**:2 行,Tiny,只 3-changelog
- **测试**:R5 此项属"修上游行为反转",不强制单元测试 — runtime 验证由 user 完成

## 关联

- **2026-05-05 `md-office-improvements`** Phase 1:本笔反转其 spec A1.9 的"scripts 失活"决策。spec 文档不改(历史决策快照,首字段 "spec 锁版只补不改"),反转理由 + 安全权衡记录在本 changelog
