---
feat-id: html-viewer-ux-polish
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# HTML 文件查看器 UX 优化

## 需求来源

User 2026-05-14 实测 `html-viewer-allow-scripts` 成果(PPT 翻页恢复)后,继续提三项 UX 反馈:

1. **去掉顶部悬浮**:`预览/源码` toggle toolbar 占视觉空间,user 想要 iframe 占满
2. **右键菜单一致**:HTML 预览区域右键应弹自家菜单(添加到聊天/编辑/复制/导出 Word),与 .md 文件查看器一致,不是 WebView2 原生菜单(返回/刷新/打印)
3. **点击编辑后进入 HTML 源码编辑界面**:既然 toolbar 去掉,源码查看入口走右键→编辑→CodeMirror html 语法模式

实施期间追加两项:
- 阈值 2MB→10MB(user 反馈大 PPT/Slides 常 >2MB)
- 右键菜单"左键点 iframe 内不消失"bug(后续发现并修)

搜索框(WebView2 Ctrl+F)调研后接受现状不改 —— 系统 chrome 级控件位置写死。

## 验收标准

- [ ] A1:.html 文件预览,iframe 占满整个文件查看区域,无顶部 toolbar
- [ ] A2:iframe 内任意位置右键 → 弹 DeskFox 自家菜单,4 项(添加到聊天/编辑/复制/导出 Word),不是 WebView2 原生菜单
- [ ] A3:右键菜单 4 项灰显规则与 .md 一致 — 添加到聊天/复制 按选区灰显,编辑常亮,导出 Word 在 .html 上始终灰(Q3 决议)
- [ ] A4:在 iframe 内选一段文字 → 右键 → "添加到聊天"和"复制"可点,带选区文本
- [ ] A5:右键菜单弹出后,左键点 iframe 内任意位置 → 菜单立即关闭
- [ ] A6:点编辑 → 进 CodeMirror,含 HTML 语法高亮 + 标签匹配
- [ ] A7:保存后回到 iframe 预览
- [ ] A8:文件 >10MB → placeholder "文件 >10MB,不支持预览/编辑,请用本机软件打开"
- [ ] A9:PPT 翻页等内嵌 JS 功能保留(上一笔 allow-scripts 不破)

## 架构选型

### 跨 origin iframe 右键事件转父窗口 — 三方案对比

| 方案 | 描述 | 评估 |
|---|---|---|
| **A. Rust handler 注入 contextmenu 桥** | localasset:// HTML 响应里追加 `<script>` 监听 contextmenu + preventDefault + postMessage | ✅ 选定 — 一次注入对所有 .html 生效,父子解耦,选区文本可传 |
| B. srcdoc 包裹用户 HTML | iframe `srcdoc=...` 注入 shim | ❌ srcdoc 改 iframe URL 为 `about:srcdoc`,相对资源(./img.png)解析破 |
| C. 透明 overlay div 捕获右键 | iframe 上盖透明 div,catch contextmenu | ❌ pointer-events 全 / 无,捕获右键会阻断正常左键;无法做"只对右键透传"语义 |

### 大文件 >10MB 处理

| 选项 | 评估 |
|---|---|
| **placeholder 文案** | ✅ 选定 — 诚实告知"不支持预览/编辑" |
| fallback 到源码视图 | ❌ toolbar 已删,无切换回预览入口;>10MB 源码渲染本身也慢 |

### CodeMirror HTML 语法支持

| 选项 | 评估 |
|---|---|
| **新增 `@codemirror/lang-html` 依赖** | ✅ 选定 — 触发 R4(bun.lock 自动重生)但 UX 价值大 |
| 接受纯文本编辑(无高亮) | ❌ 与"HTML 源码编辑界面"预期落差大,降级明显 |
| vendor 进 fork(几百行 lezer 代码) | ❌ 维护成本爆炸,与上游 npm 包脱钩 |

## 安全模型

- iframe sandbox 沿用 `allow-same-origin allow-scripts`(上一笔 `html-viewer-allow-scripts` 跨 origin 论证仍成立)
- 注入脚本极小(单行 IIFE,`__deskfox` 命名空间),与用户页脚本冲突风险低
- postMessage 父侧严格检查 `data.__deskfox === true && type ∈ {contextmenu, mousedown}`,其他 message 忽略
- 注入失败(非 UTF-8 / 无 head 锚点)走前置兜底或原样返回,不阻断渲染

## 文档关系

- 反转项:`md-office-improvements` Phase 1 立的"HTML 预览必显 toolbar"决策(那笔本身不算 spec 硬规,本笔自然演进)
- 延续项:`html-viewer-allow-scripts`(allow-scripts + 跨 origin 论证)
