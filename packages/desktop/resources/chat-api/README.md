# OpenCode 桌面网页模型适配器

本目录是从 `G:\chen\Study\chat-api` 复制并适配到 OpenCode 桌面端的源码。适配器通过 Edge 网页会话使用 DeepSeek 和 ChatGPT；它们不是官方平台 API。

## 安装运行依赖

桌面端需要 Python 3.11 和本目录的 Python 依赖：

```powershell
python -m pip install -r packages/desktop/resources/chat-api/requirements.txt
```

DeepSeek 会从 Edge 当前用户配置读取网页登录状态。Edge 登录 `chat.deepseek.com` 后即可使用。

ChatGPT 使用 Edge 扩展的网页 DOM 通道：

1. 在 Edge 打开 `edge://extensions`，启用开发者模式并加载 `edge_chatgpt_extension` 文件夹。
2. 运行 `python packages/desktop/resources/chat-api/chatgpt_dom_bridge.py`。
3. 在扩展选项页粘贴桥接进程输出的连接配置并连接。该配置会保存在 Edge 扩展存储中，桥接重启后沿用。
4. 在扩展创建的专用 ChatGPT 标签页登录。

桥接配置是本机连接凭据，不要提交到仓库或分享。网页端协议变化时，适配器可能需要同步更新。

## 会话行为

每个 OpenCode 会话分别保留网页端会话标识。正常续聊只发送新用户输入或本地工具结果，网页端保留会话记忆；切换模型、系统提示变化、会话状态丢失或请求中断后，会新建网页会话并同步 OpenCode 的压缩历史。标题从首条用户文本本地生成，不会额外占用网页会话。

网页模型通过完整的 `<opencode_tool_call>` JSON 文本请求 OpenCode 工具。可用工具只包括当前 Agent 与会话权限允许的本地文件和命令工具；不包含子代理、MCP、联网工具或插件工具。工具调用沿用 OpenCode 权限审批，工具结果会发送回对应网页会话。模型最终回复会等网页端确认完成后再交给 OpenCode 处理；不完整响应不会触发工具执行，也不会自动重发。

网页适配器只支持文本输入，不接收本地附件。DeepSeek 的“thinking”模型变体会启用网页端深度思考，默认变体不启用；联网搜索保持关闭。ChatGPT 使用 Edge 当前页面模型，不支持通过 OpenCode 指定网页模型或思考强度。
