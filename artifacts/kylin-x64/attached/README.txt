LINGXI CODE CLI - 企业内网离线版 v1.4.6
========================

快速开始
-----------
1. 首次使用需要配置内网大语言模型服务：
   - 编辑 config\opencode.json 文件
   - 将 YOUR_LLM_SERVER:8080/v1 替换为真实大模型服务地址
   - 将 your-model-name 替换为实际模型名称
   - 设置接口密钥: export ENTERPRISE_API_KEY=sk-your-key-here（lingxicode.sh和lingxicode-harness.sh里修改后去掉注释或修改opencode.json文件）
2. 首次使用需要添加执行权限:
   chmod +x lingxicode.sh lingxicode-harness.sh scripts/deploy-plugins.sh bin/opencode
3. 在命令控制台输入 ./lingxicode.sh（基础功能） 或 lingxicode-harness.sh（加载Harness功能） 启动

环境变量说明
--------------------
  OPENCODE_PARSERS_DIR          - tree-sitter 解析器目录（默认: 同目录 parsers\）
  OPENCODE_DISABLE_AUTOUPDATE   - 禁用自动更新（已设为 true）
  OPENCODE_DISABLE_MODELS_FETCH - 禁止从 models.dev 拉取模型数据 (已设为 true)
  OPENCODE_DISABLE_LSP_DOWNLOAD - 禁止 LSP 工具下载 (已设为 true)
  OPENCODE_DISABLE_TELEMETRY    - 禁止 Telemetry 数据收集 (已设为 true)
  OPENCODE_CONFIG_DIR           - 额外配置目录
  OMO_DISABLE_POSTHOG           - 禁止 PostHog 追踪 (已设为 1)
  OPENCODE_SCAN_DIR_PLUGINS     - 加载二级目录插件，如OMO插件 (设置为1是加载)
  ENTERPRISE_API_KEY            - 内网 LLM 服务 API Key

文件说明
--------------------
bin/opencode.exe       - CLI 主程序（含 Bun 运行时 + 内嵌解析器）
parsers/               - tree-sitter 离线解析器（外置备用）
lingxicode.bat         - 快速启动脚本（基础功能）
lingxicode-harness.sh  - 快速启动脚本（加载Harness功能）
config/                - 配置目录（包含配置文件、插件、skills等）

日志
--------------------
日志文件写入位置：
**Kylin**: /home/用户/.local/share/opencode/log

日志文件以时间戳命名（例如 2025-01-09T123456.log），并保留最近的 10 个日志文件。