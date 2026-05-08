LINGXI CODE CLI - 企业内网离线版 v1.4.6
========================

快速开始
-----------
1. 首次使用需要配置内网大语言模型服务：
   - 编辑 config\opencode.json 文件
   - 将 YOUR_LLM_SERVER:8080/v1 替换为真实大模型服务地址
   - 将 your-model-name 替换为实际模型名称
   - 设置接口密钥: set ENTERPRISE_API_KEY=sk-your-key-here（run.bat里去掉注释或者修改opencode.json）
2. 双击 lingxicode.bat 启动

环境变量说明
--------------------
  OPENCODE_PARSERS_DIR          - tree-sitter 解析器目录（默认: 同目录 parsers\）
  OPENCODE_DISABLE_AUTOUPDATE   - 禁用自动更新（已设为 true）
  OPENCODE_DISABLE_MODELS_FETCH - 禁止从 models.dev 拉取模型数据 (已设为 true)
  OPENCODE_DISABLE_LSP_DOWNLOAD - 禁止 LSP 工具下载 (已设为 true)
  OPENCODE_CONFIG_DIR           - 额外配置目录
  ENTERPRISE_API_KEY            - 内网 LLM 服务 API Key

文件说明
--------------------
opencode.exe           - CLI 主程序（含 Bun 运行时 + 内嵌解析器）
parsers/               - tree-sitter 离线解析器（外置备用）
lingxicode.bat         - 快速启动脚本
config/                - 配置模板目录
plugins/               - 插件扩展目录

日志
--------------------
日志文件写入位置：
**Windows**: 按 WIN+R 并粘贴 %USERPROFILE%\.local\share\opencode\log

日志文件以时间戳命名（例如 2025-01-09T123456.log），并保留最近的 10 个日志文件。