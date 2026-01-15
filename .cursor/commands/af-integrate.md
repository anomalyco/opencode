# /af-integrate — 从纯前端导入到全栈可上线（调用 fullstack-integrator）

## Preconditions
- 你已经从 Gemini Build 下载代码（纯前端）
- 你知道要接入的后端能力：db/storage/auth/llm（哪怕先 mock）

## Steps
1) 按 docs/build/GEMINI_IMPORT_GUIDE.md 的约定导入到 imports/（如无则创建指南）
2) 启动 subagent：fullstack-integrator
3) 产出：
   - 目录结构调整方案
   - services/api 层
   - 接入点（auth/db/storage/llm）与 env/config 模板
4) 确保本地 dev 可跑（给出命令与预期输出）
