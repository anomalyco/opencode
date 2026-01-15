# /af-quality-gate — 质量门禁与 QA 报告（调用 qa-gatekeeper）

## Steps
1) 启动 subagent：qa-gatekeeper
2) 运行/检查（能跑就跑，不能跑就给缺失项与最小补齐方案）：
   - lint / typecheck / unit tests / e2e smoke
3) 输出 docs/qa/QA_REPORT.md
4) 给出 Gate C 是否通过结论（Pass/Fail/Conditional）
