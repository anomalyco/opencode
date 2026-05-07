# Web 前端性能瓶颈分析报告

## 1. 核心问题总结
经过对 `packages/web` 代码库的分析，发现该项目在处理长会话、复杂 Diff 以及大资源加载时存在明显的性能瓶颈。主要诱因是 **主线程执行耗时任务（语法高亮）**、**大尺寸静态资源** 以及 **高频率的 DOM 监听**。

## 2. 重点问题详细分析

### A. 客户端语法高亮阻塞 (Shiki)
*   **位置**: `packages/web/src/components/share/content-code.tsx`, `content-diff.tsx`
*   **分析**:
    *   项目在客户端使用 `shiki` 进行异步代码高亮。
    *   在 Diff 查看器中，每一行差异（Line）都被封装在一个独立的 `ContentCode` 组件中。如果一个补丁有 500 行，则会并发产生 500 个异步高亮任务。
    *   Shiki 加载语言包和渲染 HTML 的过程在 JS 主线程中执行，这会导致页面在 Diff 加载瞬间彻底失去响应（卡死）。
*   **建议**:
    *   **SSR 渲染**: 利用 Astro 的服务端能力，在构建阶段或 SSR 阶段完成语法高亮。
    *   **组件优化**: ContentDiff 应该将整个代码块交给 Shiki 处理一次，而不是逐行处理。

### B. 未优化的静态资源
*   **位置**: `packages/web/src/assets/lander/`
*   **分析**:
    *   `screenshot-vscode.png` (999K) 和 `screenshot-github.png` (903K) 体积过大。
    *   PNG 格式在网页展示中效率较低，且未发现有针对性的 WebP 转码或响应式尺寸配置。
*   **建议**:
    *   使用 Astro 内置的 `<Image />` 组件。
    *   将图片转换为 WebP 或 AVIF 格式，预计可减少 70% 以上的体积。

### C. 频繁的布局重排 (Layout Thrashing)
*   **位置**: `packages/web/src/components/share/common.tsx` 中的 `createOverflow`
*   **分析**:
    *   使用了 `ResizeObserver` 来检测容器高度并设置 `overflow` 状态。
    *   回调函数直接读取 `scrollHeight` 和 `clientHeight`，这两个属性的读取会强制浏览器刷新渲染队列（Forced Reflow）。如果页面中有大量此类监听器，会造成明显的滚动卡顿。
*   **建议**:
    *   引入节流 (Throttle) 机制限制执行频率。
    *   考虑使用纯 CSS 的方法（如容器查询）解决部分溢出逻辑。

### D. 数据转换压力
*   **位置**: `packages/web/src/components/Share.tsx` 中的 `fromV1` 函数
*   **分析**:
    *   该函数在客户端将后端返回的 V1 格式数据实时转换为组件所需的格式。
    *   转换过程涉及大量的对象克隆和嵌套遍历，对于长达数万词的 AI 对话记录，此操作会产生明显的内存峰值和 JS 执行延迟。
*   **建议**:
    *   将数据协议统一，避免客户端进行二次转换。
    *   或者将转换逻辑放入 Web Worker。

### E. CSS 计算负担
*   **位置**: `packages/web/src/styles/custom.css`
*   **分析**:
    *   CSS 中存在大量的 `!important` 覆盖规则，增加了浏览器层叠计算（Cascade）的成本。
    *   复杂的全局选择器（如 `body > .page > .main-frame ...`）会降低样式的匹配效率。

## 3. 改进建议优先级
1.  **高**: 实施语法高亮的服务端渲染 (SSR)，这是消除当前最明显卡顿的关键。
2.  **中**: 压缩并优化静态图片资源，减少带宽占用。
3.  **中**: 为长列表组件（如消息流）引入虚拟化滚动技术。
4.  **低**: 清理冗余 CSS，移除不必要的 `!important`。

---
**报告完成人**: Jules
**日期**: 2025-05-22
