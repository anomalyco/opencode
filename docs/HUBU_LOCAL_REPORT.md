# HUBU（湖北大学）本地版说明

湖北大学品牌版本（HUBU AI / hubu:// 深链 / 绿金主题）与 MUC 共用本仓库单 Core，
品牌数据唯一事实源：`packages/brand`（@opencode-ai/brand）。

主报告（架构 / 品牌系统 / 隔离拓扑 / 验收 A–M / 启动指南 / 已知限制）：

> /Users/cccc/Desktop/共用/sub2api/docs/HUBU_LOCAL_REPORT.md

要点速记：

- 构建/开发桌面端：`OPENCODE_CHANNEL=hubu bun run build && bun run package:mac -- --dir`（packages/desktop）
- TUI：`BRAND=hubu`（默认主题切 hubu；主题文件 `packages/tui/src/theme/assets/hubu.json`）
- 网关/网站：sub2api 仓库 `./scripts/dev-hubu.sh`（http://localhost:8081，本地隔离栈）
- 凭据 env：`HUBU_API_KEY`；网关覆盖：`HUBU_GATEWAY_URL`（默认 http://localhost:8081）
- 新增学校：`packages/brand/brands/<id>/` + 图标/主视觉 + `resolveBrand` 注册，不 fork Core
