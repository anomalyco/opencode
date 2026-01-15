---
name: ui-prompt-generator
description: 根据产品 SPEC 生成多个 UI 原型 prompt（适配 Gemini Build / nano-banana）。输出 PROMPT_PACK.md，含多风格、多信息密度、可对比的版本。
---

# UI Prompt Generator

## 输入
- docs/product/SPEC.md（必须先读）
- 用户偏好（如有）：风格、品牌色、信息密度、移动端优先等

## 输出
- docs/ui/PROMPT_PACK.md
  - 每个 prompt：目标、页面清单、组件/状态、数据假设、禁止项、验收点
  - 至少 N=6 个变体：极简 / 信息密集 / 类 Gemini Build / 类 Linear / 类 Notion / 设计系统化

## Prompt 规则（给“生成器模型”看的）
- 明确：两栏布局（左 chat 右 workspace tab：Preview/Code tree/editor）
- 右上角：Deploy to AF / Export local / Copy workspace
- 强制列出：Routes、state、mock data、error/loading/empty states
- 要求输出：可运行的 Vite + React + TS 项目结构

## 终止条件
PROMPT_PACK.md 里每个 prompt 都能“直接复制进 Gemini Build”使用，并有对比说明。
