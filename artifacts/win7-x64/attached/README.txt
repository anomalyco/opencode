LINGXI CODE CLI - 企业内网离线版 v1.4.6
========================

快速开始
-----------
1. 首次使用需要配置内网大语言模型服务：
   - 编辑 config\opencode.json 文件
   - 将 YOUR_LLM_SERVER:8080/v1 替换为真实大模型服务地址
   - 将 your-model-name 替换为实际模型名称
   - 设置接口密钥: set ENTERPRISE_API_KEY=sk-your-key-here（lingxicode.bat和lingxicode-harness.bat里修改后去掉注释或修改opencode.json）
2. 首次在Windows 7系统使用需要安装install目录的KexSetup扩展API（参考install目录里的README.txt进行配置）
3、为了支持Windows 7系统，需要确保系统已安装Service Pack 1、KB2533623、KB2670838、KB3020369、KB3125574系统更新
（链接: https://pan.baidu.com/s/52wTRtZKR1ZY5UAVKx-SR9g）
4. 双击 lingxicode_win7.bat（基础功能） 或 lingxicode-harness_win7.bat（加载Harness功能） 启动（Windows 7系统启动时间较长，根据机器性能需要1到5分钟，请耐心等待）

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
bin/opencode.exe                - CLI 主程序（含 Bun 运行时 + 内嵌解析器）
parsers/                        - tree-sitter 离线解析器（外置备用）
lingxicode.bat                  - Windows 10+系统快速启动脚本（基础功能）
lingxicode-harness.bat          - Windows 10+系统快速启动脚本（加载Harness功能）
lingxicode_win7.bat             - Windows 7系统快速启动脚本（基础功能）
lingxicode-harness_win7.bat     - Windows 7系统快速启动脚本（加载Harness功能）
config/                         - 配置目录（包含配置文件、插件、skills等）
cmder_mini/                     - 控制台模拟器

日志
--------------------
日志文件写入位置：
**Windows**: 按 WIN+R 并粘贴 %USERPROFILE%\.local\share\opencode\log

日志文件以时间戳命名（例如 2025-01-09T123456.log），并保留最近的 10 个日志文件。