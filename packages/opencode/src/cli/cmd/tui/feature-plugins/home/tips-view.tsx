import { For } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"

const themeCount = Object.keys(DEFAULT_THEMES).length
const themeTip = `Use {highlight}/themes{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${themeCount} built-in themes`

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● 小贴士{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS = [
  "输入 {highlight}@{/highlight} 后接文件名，即可模糊搜索并附加文件",
  "消息以 {highlight}!{/highlight} 开头可直接运行 shell 命令（例如：{highlight}!ls -la{/highlight}）",
  "按下 {highlight}Tab{/highlight} 键在构建代理和规划代理之间切换",
  "使用 {highlight}/undo{/highlight} 撤销上一条消息和文件修改",
  "使用 {highlight}/redo{/highlight} 恢复已撤销的消息和文件修改",
  "将图片或 PDF 拖放到终端中，将其添加为上下文信息",
  "按下 {highlight}Ctrl+V{/highlight} 将剪贴板中的图片粘贴到输入框",
  "按下 {highlight}Ctrl+X E{/highlight} 或输入 {highlight}/editor{/highlight}，在外部编辑器中编写消息",
  "运行 {highlight}/init{/highlight} 根据你的代码库自动生成项目规则",
  "运行 {highlight}/models{/highlight} 或按下 {highlight}Ctrl+X M{/highlight} 查看并切换可用的 AI 模型",
  themeTip,
  "按下 {highlight}Ctrl+X N{/highlight} 或输入 {highlight}/new{/highlight} 开启全新对话会话",
  "使用 {highlight}/sessions{/highlight} 或按下 {highlight}Ctrl+X L{/highlight} 查看并继续历史对话",
  "运行 {highlight}/compact{/highlight} 总结接近上下文限制的长会话",
  "按下 {highlight}Ctrl+X X{/highlight} 或输入 {highlight}/export{/highlight} 将对话保存为 Markdown 格式",
  "按下 {highlight}Ctrl+X Y{/highlight} 将助手的最后一条消息复制到剪贴板",
  "按下 {highlight}Ctrl+P{/highlight} 查看所有可用操作和命令",
  "运行 {highlight}/connect{/highlight} 添加 75 种以上支持的大语言模型服务商的 API 密钥",
  "主快捷键是 {highlight}Ctrl+X{/highlight}；与其他按键组合可执行快捷操作",
  "按下 {highlight}F2{/highlight} 快速切换最近使用的模型",
  "按下 {highlight}Ctrl+X B{/highlight} 显示/隐藏侧边栏面板",
  "使用 {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} 浏览对话历史",
  "按下 {highlight}Ctrl+G{/highlight} 或 {highlight}Home{/highlight} 跳转到对话开头",
  "按下 {highlight}Ctrl+Alt+G{/highlight} 或 {highlight}End{/highlight} 跳转到最新消息",
  "按下 {highlight}Shift+Enter{/highlight} 或 {highlight}Ctrl+J{/highlight} 在输入框中换行",
  "输入时按下 {highlight}Ctrl+C{/highlight} 清空输入框",
  "按下 {highlight}Escape{/highlight} 停止 AI 正在生成的回复",
  "切换到 {highlight}规划{/highlight} 代理，获取建议但不执行实际修改",
  "在输入框中使用 {highlight}@代理名称{/highlight} 调用专用子代理",
  "按下 {highlight}Ctrl+X 右/左箭头{/highlight} 在父会话和子会话之间切换",
  "在配置文件中添加 {highlight}$schema{/highlight}，启用编辑器自动补全功能",
  "在配置中设置 {highlight}model{/highlight} 指定默认模型",
  "通过 {highlight}tui.json{/highlight} 中的 {highlight}keybinds{/highlight} 板块自定义快捷键",
  "将任意快捷键设为 {highlight}none{/highlight} 可完全禁用该快捷键",
  "在 {highlight}mcp{/highlight} 配置板块中配置本地或远程 MCP 服务器",
  "LINGXI CODE 自动处理需要认证的远程 MCP 服务器的 OAuth 验证",
  "在自定义命令中使用 {highlight}$ARGUMENTS{/highlight}、{highlight}$1{/highlight}、{highlight}$2{/highlight} 实现动态输入",
  "在命令中使用反引号注入 shell 输出（例如：{highlight}`git status`{/highlight}）",
  "为每个代理配置 {highlight}编辑{/highlight}、{highlight}bash 命令{/highlight}和{highlight}网络获取{/highlight}工具的权限",
  '使用 {highlight}"git *": "allow"{/highlight} 这类规则精细化控制 bash 命令权限',
  '设置 {highlight}"rm -rf *": "deny"{/highlight} 禁止执行破坏性命令',
  '配置 {highlight}"git push": "ask"{/highlight}，推送代码前需手动确认',
  "LINGXI CODE 使用 prettier、gofmt、ruff 等工具自动格式化文件",
  '在配置中设置 {highlight}"formatter": false{/highlight} 禁用所有自动格式化功能',
  "在配置中按文件扩展名定义自定义格式化命令",
  "LINGXI CODE 使用语言服务器协议实现智能代码分析",
  "工具定义可调用 Python、Go 等语言编写的脚本",
  "使用插件在会话完成时发送系统通知",
  "创建插件防止 LINGXI CODE 读取敏感文件",
  "在拉取请求代码行评论 {highlight}/oc{/highlight} 进行针对性代码审查",
  '设置 {highlight}"theme": "system"{/highlight} 匹配终端的配色方案',
  "主题支持深色/浅色两种模式",
  "自定义主题可引用 0-255 号 ANSI 颜色",
  "在配置中使用 {highlight}{env:VAR_NAME}{/highlight} 语法引用环境变量",
  "在配置中使用 {highlight}{file:路径}{/highlight} 引入文件内容",
  "在配置中使用 {highlight}instructions{/highlight} 加载额外的规则文件",
  "设置代理 {highlight}temperature{/highlight} 参数，范围 0.0（专注）到 1.0（创意）",
  "配置 {highlight}steps{/highlight} 限制每个请求的代理迭代次数",
  '设置 {highlight}"tools": {"bash": false}{/highlight} 禁用指定工具',
  '设置 {highlight}"mcp_*": false{/highlight} 禁用某个 MCP 服务器的所有工具',
  "为每个代理单独覆盖全局工具设置",
  '设置 {highlight}"share": "auto"{/highlight} 自动分享所有会话',
  '设置 {highlight}"share": "disabled"{/highlight} 禁止分享任何会话',
  "运行 {highlight}/unshare{/highlight} 取消会话的公开访问权限",
  "{highlight}无限循环{/highlight} 权限可防止工具无限调用循环",
  "{highlight}外部目录{/highlight} 权限可保护项目外的文件",
  "使用 {highlight}--print-logs{/highlight} 参数在标准错误输出中查看详细日志",
  "按下 {highlight}Ctrl+X G{/highlight} 或输入 {highlight}/timeline{/highlight} 跳转到指定消息",
  "按下 {highlight}Ctrl+X H{/highlight} 切换消息中代码块的显示状态",
  "按下 {highlight}Ctrl+X S{/highlight} 或输入 {highlight}/status{/highlight} 查看系统状态信息",
  "在 {highlight}tui.json{/highlight} 中启用 {highlight}滚动加速{/highlight}，实现流畅的 macOS 风格滚动",
  "通过命令面板（{highlight}Ctrl+P{/highlight}）切换聊天中用户名的显示",
  "将项目的 {highlight}AGENTS.md{/highlight} 文件提交到 Git，方便团队共享",
  "使用 {highlight}/review{/highlight} 审查未提交的修改、分支或拉取请求",
  "运行 {highlight}/help{/highlight} 或按下 {highlight}Ctrl+X H{/highlight} 显示帮助对话框",
  "使用 {highlight}/rename{/highlight} 重命名当前会话",
  ...(process.platform === "win32"
    ? ["按下 {highlight}Ctrl+Z{/highlight} 撤销输入框中的修改"]
    : ["按下 {highlight}Ctrl+Z{/highlight} 挂起终端并返回 shell 界面"]),
]
