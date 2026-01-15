# /af-ui-prompts — 基于 SPEC 生成 UI Prompt Pack（调用 ui-prompt-generator）

## Steps
1) 读取 docs/product/SPEC.md
2) 启动 subagent：ui-prompt-generator
3) 生成 docs/ui/PROMPT_PACK.md
   - 至少 6 个 prompts
   - 每个 prompt 都包含：页面清单/组件/状态/mock 数据/错误与空态/禁止项/验收点
4) 输出“如何挑选最适合 Gemini Build 的那一个”的建议（对比表即可）
