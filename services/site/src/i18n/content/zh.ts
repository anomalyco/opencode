import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "在 macOS、Windows 和 Linux 上使用会话、标签页、diff、内置浏览器和扩展。",
      action: "下载",
    },
    mobile: { name: "Mobile", body: "无论身在何处，都能在手机上启动、引导和批准会话。", action: "下载" },
    terminal: { name: "Terminal", body: "快速的终端界面，可在任意 shell、编辑器或远程服务器中使用。", action: "安装" },
    sdk: { name: "SDK", body: "在您自己的脚本、CI 任务和工具中驱动 OpenCode。", action: "阅读文档" },
    ide: {
      name: "IDE 扩展",
      body: "在 VS Code、Cursor 和 Windsurf 中打开 OpenCode，或通过 ACP 在 Zed 和 JetBrains IDE 中使用。",
      action: "安装",
    },
    mini: {
      name: "Mini",
      body: "极简的终端界面，回复直接输出到滚动记录中，下方只有一个提示词输入框。",
      action: "安装",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | 适用于 macOS、Windows 和 Linux 的桌面应用",
      description:
        "并行运行任意多个 OpenCode 代理，在旁边的浏览器中查看每处更改，并在任意设备上继续。适用于 macOS、Windows 和 Linux。",
      intro:
        "同时运行多个代理，每个会话都有独立的标签页。以 diff 审查每处更改，在任意一行添加评论，并在内置浏览器中检查结果。支持 macOS、Windows 和 Linux。",
      showcase: {
        "parallel-agents": {
          title: "并行代理",
          body: "想启动多少个代理都可以，让它们全部并行工作。哪个完成了，就切换过去查看。",
        },
        "see-it-in-the-browser": {
          title: "在浏览器中查看",
          body: "你的应用会在代理旁边的浏览器中打开，你和代理都能看到每处更改落地。",
        },
        "on-every-device": {
          title: "在每台设备上",
          body: "在你的所有设备上启动代理，并在桌面应用、终端或手机上继续。",
        },
        "extend-it": {
          title: "扩展它",
          body: "连接你的工具和服务，让代理能处理任何事情。或者让 OpenCode 为自己构建插件，并在侧边栏中拥有自己的界面。",
        },
      },
    },
    mobile: {
      title: "OpenCode | 在手机上引导编程代理的移动应用",
      description:
        "在手机上启动并引导 OpenCode 会话。代理在您的电脑上运行时，您可以与它对话。",
      intro:
        "无论身在何处，都能在手机上启动并引导会话。给会话打电话与代理交谈，或打开任意会话从上次中断处继续，一切都在您自己电脑上的 OpenCode 中运行。",
      features: {
        "notify-when-done": { title: "完成时通知", body: "您启动的会话完成后，会收到一段简短总结。" },
        "pair-from-anywhere": { title: "随处配对", body: "使用 opencode pair --remote 从任意网络连接。" },
        "every-computer": { title: "每台电脑", body: "一键切换已配对的电脑。" },
        "siri-and-shortcuts": { title: "Siri 和快捷指令", body: "通过 Siri 或控制中心发起通话或会话。" },
        "follow-along": { title: "实时跟进", body: "看着时间线随代理的工作实时更新。" },
        "your-computer": { title: "您的电脑", body: "连接到您自己机器上运行的 OpenCode。" },
        "share-sheet": { title: "共享菜单", body: "无需打开应用，即可把任何内容分享到会话。" },
        "mute-sessions": { title: "静音会话", body: "将会话保留在列表中，但不接收它的通知。" },
      },
      showcase: {
        results: { title: "结果", body: "您交代的工作完成后，通话会告诉您改了什么。" },
        voice: { title: "语音", body: "呼叫会话，说出您的需求。代理会出声回答。" },
        sessions: { title: "会话", body: "打开任意会话查看进度，然后从上次中断的地方继续。" },
        steer: { title: "引导", body: "发送后续消息，在会话中途调整方向。" },
      },
    },
    terminal: {
      title: "OpenCode | 开源编程代理的终端界面",
      description:
        "OpenCode 的快速终端界面，可在任意 shell、编辑器或远程服务器中使用。描述您的需求，以 diff 查看每处编辑，并批准命令。",
      intro:
        "快速的终端界面，可在任意 shell、编辑器或远程服务器中使用。用自然语言描述需求，看着每处编辑以 diff 呈现，并选择哪些命令可以自动运行。",
      features: {
        "any-terminal": { title: "任意终端", body: "可在任意 shell、编辑器的终端或远程服务器中使用。" },
        "diffs-in-the-timeline": { title: "时间线中的 diff", body: "代理每做一处编辑，都会以 diff 显示在时间线中。" },
        "pick-up-later": { title: "稍后继续", body: "用 -c 继续上一个会话，或用 -s 继续任意会话。" },
        "one-off-runs": { title: "单次运行", body: "opencode run 发送一条消息并输出回复。" },
        "agents-and-commands": { title: "代理和命令", body: "用 shift+tab 切换代理，用 ctrl+p 打开所有命令。" },
        "auto-approve": { title: "自动批准", body: "使用 --auto 运行，即可允许所有您未拒绝的操作。" },
        "any-server": { title: "任意服务器", body: "使用 --server 通过 URL 连接到 OpenCode 服务器。" },
        "usage-stats": { title: "使用统计", body: "opencode stats 显示可分享的使用统计。" },
      },
      showcase: {
        "ask-in-plain-words": { title: "用自然语言提问", body: "输入您的需求，代理会在工作时展示计划。" },
        "approve-what-runs": { title: "批准要运行的内容", body: "编辑以 diff 显示，命令会等待您的许可。" },
        "make-it-yours": { title: "随心定制", body: "一键切换主题，从默认主题到 tokyonight 等。" },
        mini: { title: "Mini", body: "运行 opencode mini，回复会输出到您自己的滚动记录中。" },
      },
    },
    sdk: {
      title: "OpenCode | 在代码中驱动代理的 TypeScript SDK",
      description:
        "在您自己的脚本、CI 任务和工具中驱动 OpenCode。带类型的 TypeScript 客户端可以创建会话、发送提示词，并实时流式传输每个事件。",
      intro:
        "在您自己的脚本、CI 任务和工具中驱动 OpenCode。SDK 在您的进程内运行 OpenCode，使用您的配置和模型，其带类型的客户端可以创建会话、发送提示词并流式传输每个事件。",
      features: {
        "typescript-client": { title: "TypeScript 客户端", body: "带类型的请求和事件，与 @opencode/client 的值相同。" },
        "sessions-from-code": { title: "用代码创建会话", body: "在任意脚本中创建会话并发送提示词。" },
        "any-model": { title: "任意模型", body: "使用您的 OpenCode 配置中的任意模型。" },
        "npm-or-bun": { title: "npm 或 bun", body: "使用 npm i @opencode/sdk 或 bun add @opencode/sdk 安装。" },
        "in-process-host": { title: "进程内宿主", body: "在内存中运行 OpenCode，无需经过网络。" },
        "your-plugins": { title: "您的插件", body: "创建进程内宿主时传入您自己的插件。" },
        "promise-or-effect": { title: "Promise 或 Effect", body: "Promise API 和 Effect API，返回相同的值。" },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "在 Workers 上的 Cloudflare Durable Object 中运行 OpenCode。",
        },
      },
      showcase: {
        "in-your-process": { title: "在您的进程内", body: "在您的进程内运行 OpenCode，使用您的配置和模型。" },
        "fix-ci-from-code": {
          title: "用代码修复 CI",
          body: "一段简短的脚本让 OpenCode 修复失败的测试，然后重新运行。",
        },
        "follow-every-step": { title: "跟踪每一步", body: "流式传输事件，实时查看代理调用的每个工具。" },
        "build-your-own-tools": {
          title: "构建自己的工具",
          body: "只需几行代码，就能把 OpenCode 接入机器人、仪表盘和工作流。",
        },
      },
    },
    ide: {
      title: "OpenCode | 适用于 VS Code、Cursor、Zed 等的 IDE 扩展",
      description:
        "在编辑器中使用 OpenCode。VS Code、Cursor、Windsurf 和 VSCodium 有专用扩展，Zed、JetBrains IDE 和其他 ACP 编辑器可使用 opencode acp。",
      intro:
        "在编辑器中使用 OpenCode。在 VS Code、Cursor、Windsurf 和 VSCodium 中，在集成终端里运行 opencode，扩展就会自动安装。Zed、JetBrains IDE 以及其他支持 Agent Client Protocol 的编辑器可通过 opencode acp 运行 OpenCode。",
      features: {
        "quick-launch": { title: "快速启动", body: "Cmd+Esc 或 Ctrl+Esc 在分屏终端中打开 OpenCode。" },
        "new-session": { title: "新会话", body: "Cmd+Shift+Esc 或 Ctrl+Shift+Esc 开启另一个会话。" },
        context: { title: "上下文", body: "将当前选中内容或标签页分享给 OpenCode。" },
        "file-references": { title: "文件引用", body: "Cmd+Option+K 或 Alt+Ctrl+K 插入 @File#L37-42。" },
        "installs-itself": { title: "自动安装", body: "在集成终端中运行 opencode 即可添加。" },
        "acp-editors": { title: "ACP 编辑器", body: "Zed、JetBrains IDE、Avante.nvim 和 CodeCompanion.nvim。" },
        "open-vsx": { title: "Open VSX", body: "也在 Open VSX 上提供，适用于 Cursor、Windsurf 和 VSCodium。" },
        "same-agent": { title: "同一个代理", body: "就是您在终端中运行的 OpenCode，就在代码旁边。" },
      },
    },
    mini: {
      title: "OpenCode | Mini，代理的极简终端界面",
      description:
        "Mini 在极简的终端界面中运行 OpenCode。回复直接输出到终端自身的滚动记录中，下方只保留提示词输入框和一行状态栏。",
      intro:
        "OpenCode 的极简终端界面。运行 opencode mini，回复会直接输出到终端自身的滚动记录中，您可以像处理其他输出一样滚动、搜索和复制。底部只保留提示词输入框和一行状态栏。",
      features: {
        "your-scrollback": { title: "您的滚动记录", body: "回复就是普通的终端历史。" },
        "one-prompt": { title: "一个输入框", body: "代理、模型、上下文和费用都在一行状态栏中。" },
        permissions: { title: "权限", body: "在输入区域批准编辑和命令。" },
        "how-much-shows": { title: "显示多少", body: "思考过程和工具输出可设为安静、默认或全部。" },
        "pick-up-later": { title: "稍后继续", body: "用 -c 继续上一个会话，或用 -s 继续任意会话。" },
        "same-opencode": { title: "同一个 OpenCode", body: "服务器、代理和模型与其他应用相同。" },
        agents: { title: "代理", body: "直接在输入框中切换代理。" },
        compact: { title: "压缩", body: "用 /compact 压缩冗长的会话。" },
      },
    },
  },
  extensionCard: {
    name: "扩展",
    body: "在 VS Code 中使用 OpenCode，或通过 ACP 在 Zed 等编辑器中使用。",
    action: "安装",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "让代理使用您真实的浏览器。",
      title: "OpenCode | Browse，为编程代理准备的真实浏览器",
      description:
        "Browse 让 OpenCode 和其他 MCP 客户端使用您真实的浏览器。代理通过 Playwright 操作后台标签页，并把登录和双重验证交还给您。",
      intro:
        "一个 MCP 服务器加一个 Chromium 扩展，让您的代理使用真实的浏览器，包括您的标签页、登录状态和扩展。代理通过 Playwright 打开和操作标签页、截图和录屏，这些标签页都在后台分组，不会打扰您。轮到您操作时，比如登录、双重验证或付款，代理会把标签页交还给您，您点击“继续”后它再接着工作。",
      features: {
        "your-real-browser": {
          title: "真实的浏览器",
          body: "Chrome、Edge、Brave、Arc、Helium、Vivaldi、Opera 和 Chromium。",
        },
        "out-of-your-way": { title: "不打扰您", body: "代理的标签页在后台打开，并收进折叠的分组中。" },
        handoffs: { title: "交接", body: "自己完成登录或双重验证，然后点击“继续”。" },
        "lend-a-tab": { title: "借出标签页", body: "点击工具栏按钮，把已打开的标签页交给代理。" },
        "record-and-capture": { title: "录制和捕获", body: "截图、录屏，以及 HAR 格式的网络流量。" },
        "any-mcp-client": {
          title: "任意 MCP 客户端",
          body: "OpenCode、Claude Code、Cursor、Codex、Zed 等众多客户端。",
        },
        "named-sessions": { title: "命名会话", body: "每个会话都保留自己的标签页，重启后依然存在。" },
        allowlists: { title: "允许列表", body: "将会话的标签页限制在您指定的网站内。" },
      },
      install:
        "一行命令安装 Browse，把它添加到找到的代理并配对扩展。在 Windows 上运行 irm https://opencode.ai/browse/install.ps1 | iex。也可以让代理帮你设置。",
    },
  },
  apps: {
    hex: { category: "语音听写", body: "适用于任意应用的设备端语音听写。" },
    opentunnel: { category: "本地隧道", body: "为本地应用提供公开的 HTTPS URL。" },
    opentui: { category: "库", body: "用于构建终端用户界面的库。" },
  },
  getStarted: {
    title: "开始使用",
    lead: "最简单的入门方式是下载 OpenCode 并使用免费模型，无需账户。想要更多，可以使用您自己的订阅或 OpenCode Go。",
    phrases: {
      "download-opencode": { text: "下载 OpenCode" },
      "free-models": { text: "免费模型" },
      "your-own-subscription": { text: "您自己的订阅" },
      "a-subscription-you-already-have": { text: "已有的订阅" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "下载", line: "桌面端、终端或移动端。" },
      "use-free-models": { title: "使用免费模型", line: "OpenCode 内置一组免费模型，无需账户。" },
      "add-more-models": {
        title: "添加更多模型",
        line: "使用您自己的订阅，或选择 OpenCode Go 的精选模型，每月 $10 起。",
      },
    },
    sentence: "下载 OpenCode，从免费模型开始，想要更多时再使用您自己的订阅或 OpenCode Go。",
  },
  byos: {
    title: "自带订阅",
    headline: "使用您已有的订阅。",
    line: "使用 ChatGPT Plus 或 Pro 或 GitHub Copilot 登录，或者使用 OpenCode 订阅。",
    yours: { label: "您的订阅", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode 订阅", "OpenCode Go"],
    ours: { label: "OpenCode 套餐" },
  },
  brand: {
    hero: { copy: { text: "给代理的规范", copied: "规范已复制" } },
    naming: {
      title: "命名",
      body: "OpenCode 写作一个词，O 和 C 大写。不要写成 Opencode、Open Code、OpenCode AI 或 Open-Code。",
      code: "小写的 `opencode` 仅用于代码和包名，例如 `opencode-figma` 或 `@acme/opencode-plugin`。",
    },
    families: {
      logo: {
        title: "Logo",
        body: "单独的 Logo，用于应用图标、头像和其他小空间。方形版本增加了内边距，适合会裁剪成方形的场景。",
        assets: {
          light: { name: "浅色" },
          dark: { name: "深色" },
          "square-light": { name: "方形，浅色" },
          "square-dark": { name: "方形，深色" },
        },
      },
      wordmark: {
        title: "文字标识",
        body: "以 OpenCode 字形写出的完整名称。只要有足够空间写出全名，就使用它。",
        assets: { light: { name: "浅色" }, dark: { name: "深色" } },
      },
      "simple-wordmark": {
        title: "简版文字标识",
        body: "单色版本的文字标识，适用于印刷、刺绣以及只允许使用一种颜色的场景。",
        assets: { light: { name: "浅色" }, dark: { name: "深色" } },
      },
    },
    icons: {
      title: "头像",
      body: "1024px 的方形头像，适用于 Slack、Discord、GitHub 等个人资料。背景铺满整个方形，Logo 位于圆形区域内，即使被裁成圆形也能完整显示。",
      items: { dark: { name: "深色" }, light: { name: "浅色" } },
    },
    colors: {
      title: "颜色",
      body: "Logo 和文字标识使用同一种墨色的三种不透明度，深色背景则使用更浅的墨色。下方数值是该墨色叠加在白色或 #0B0B0B 上的效果，与标准文件一致。点击数值即可复制。",
      palettes: {
        light: {
          name: "浅色",
          swatches: {
            ink: { name: "墨色", use: "Logo 的轮廓和“code”的字母。" },
            "ink-70": { name: "墨色 70%", use: "“open”的字母。", ink: "70% 不透明度的墨色。" },
            "ink-20": { name: "墨色 20%", use: "Logo 的内部阴影。", ink: "20% 不透明度的墨色。" },
          },
        },
        dark: {
          name: "深色",
          swatches: {
            ink: { name: "墨色", use: "Logo 的轮廓和“code”的字母。" },
            "ink-72": { name: "墨色 72%", use: "“open”的字母。", ink: "72% 不透明度的墨色。" },
            "ink-28": { name: "墨色 28%", use: "Logo 的内部阴影。", ink: "28% 不透明度的墨色。" },
          },
        },
      },
    },
    variants: {
      title: "变体",
      body: "选择能让 Logo 在背景上清晰显示的版本，浅色背景用深色版，深色背景用浅色版。Logo 和文字标识是独立的文件，二者择一使用。",
      groups: {
        default: {
          name: "默认",
          body: "几乎所有场景都使用这个 Logo。它的内部阴影是透明的，在白色或黑色背景上看起来与双色灰完全一样，在照片、渐变和彩色背景上则会透出背景。",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "深色" }, light: { name: "浅色" } } },
            wordmark: { title: "文字标识", tiles: { dark: { name: "深色" }, light: { name: "浅色" } } },
          },
        },
        simple: {
          name: "简版",
          body: "单色，字怀镂空，没有内部阴影。用于纯色背景、单色印刷以及无法使用灰色的场景，浅色背景用深色简版，深色背景用浅色简版。",
          rows: { wordmark: { title: "文字标识", tiles: { dark: { name: "深色" }, light: { name: "浅色" } } } },
        },
      },
    },
    usage: {
      title: "使用",
      body: "浅色背景使用浅色版本，深色背景使用深色版本。Logo 和文字标识相互独立，二者择一使用，不要同时使用。",
      stroke: {
        title: "1 笔画",
        body: "本页的间距规则以笔画为单位。1 笔画等于 Logo 轮廓的粗细，即其宽度的四分之一，因此 Logo 宽 4 笔画、高 5 笔画。",
      },
      clearSpace: {
        title: "留白",
        body: "Logo 和文字标识四周至少各留 2 笔画的空间。对 Logo 来说，1 笔画是其轮廓的粗细，即宽度的四分之一；对文字标识来说，是其字母的粗细，即高度的七分之一。",
      },
      pixels: {
        title: "整像素",
        body: "Logo 的比例固定为 4:5，1 笔画是其宽度的四分之一。请按 4 × 5px 的步长缩放，让每条边和每个笔画都落在整像素上。",
        do: "让每条边和 4px 的笔画都落在整像素上。",
        dont: "使用非 4:5 的尺寸，否则边缘会落在像素之间而变模糊。",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "文字标识" } },
      },
      minimumTitle: "最小尺寸",
      minimum: {
        logo: { title: "Logo", body: "至少 16 × 20px，笔画为 4px。再小就会模糊。" },
        wordmark: { title: "文字标识", body: "至少 117 × 21px，笔画为 3px。再小就会模糊。" },
      },
    },
    donts: {
      title: "禁止事项",
      body: "使用 Logo 和文字标识时应避免的常见错误。",
      examples: {
        "two-tone": { caption: "给 Logo 换成新的颜色。" },
        bright: { caption: "使用单一的鲜艳颜色。" },
        gradient: { caption: "用渐变填充 Logo。" },
        inverted: { caption: "互换色调。" },
        stretch: { caption: "拉伸或压扁 Logo。" },
        shadow: { caption: "添加投影。" },
        glow: { caption: "添加发光或描边。" },
        lockup: { caption: "在 Logo 旁边加其他文字。" },
        "low-contrast": { caption: "使用低对比度的灰配灰。" },
        color: { caption: "把双色灰 Logo 放在彩色背景上，灰色会变得浑浊。" },
      },
    },
    integrations: {
      title: "集成",
      body: "与 OpenCode 配合使用的插件、提供商和工具，以及基于 OpenCode 构建的项目，都可以注明这一点。请使用徽章或合作伙伴组合标识，并为项目命名，清楚表明它属于您。",
      badges: {
        body: "在 README、文档或网站中放置徽章，并链接到 opencode.ai。根据背景选择浅色或深色文件（HTML 会自动切换），不要修改颜色或文字。",
        sizes: "每种样式都提供 20、32 和 44px（Shields 仅 20px），格式为 SVG 和 2 倍 PNG。",
        mono: "每个文件还有使用 OpenTUI Mono 字体的版本，在扩展名前加 -mono，例如 opencode-works-with-a-light-20-mono.svg；加 -mono-caps 则为大写 OpenTUI Mono。",
        groups: {
          "works-with": { title: "兼容", alt: "兼容 OpenCode", body: "适用于配合 OpenCode 运行的插件、提供商和工具。" },
          "built-with": { title: "构建于", alt: "基于 OpenCode 构建", body: "适用于用 OpenCode 制作的项目。" },
        },
        styles: { a: { name: "边框" }, c: { name: "格子" }, f: { name: "实心" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "合作伙伴组合标识",
        body: "将 OpenCode Logo 和合作伙伴 Logo 并排放置，中间加一个 ×。× 两侧各留 3 笔画的空间，合作伙伴 Logo 的视觉高度与 OpenCode Logo 一致，并在整个组合标识四周保留留白。",
        partners: { github: { name: "GitHub" } },
      },
      naming: {
        title: "为项目命名",
        body: "以您自己的名称开头，清楚表明项目属于您。",
        rule: "写作 `Linear for OpenCode`，或将包命名为 `opencode-linear`。不要写成 `OpenCode Linear` 或 `Linear by OpenCode`。",
      },
    },
    trademarks: {
      title: "商标",
      body: "OpenCode 和 OpenCode Logo 是 Anomaly 的商标。未经许可，不得用它们暗示 Anomaly 认可或赞助您，不得用于您的产品或公司名称，也不得用于周边商品。",
      contact: { before: "如有疑问，请发送邮件至 ", after: "。" },
    },
  },
  press: {
    title: "OpenCode | 包含公司信息和品牌资产的媒体资料包",
    description:
      "OpenCode 媒体资料包，包含 OpenCode 及其背后公司 Anomaly 的相关信息，可下载的 Logo 和文字标识，以及媒体咨询联系方式。",
    hero: { title: "媒体", body: "报道 OpenCode 和 Anomaly 所需的信息、品牌资产和联系方式。" },
    company: {
      title: "关于 Anomaly",
      lead: "Anomaly 是 OpenCode 背后的公司，专为开发者打造开源工具。",
      more: "其他项目包括 SST 和 OpenTUI，全部在 [GitHub](github) 上开源。",
      learnMore: "了解更多，请访问 [anoma.ly](site)。",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "开源编程代理，提供桌面、终端和移动应用以及 SDK。采用 MIT 许可，GitHub 星标超过 220,000。",
        },
        sst: {
          name: "SST",
          body: "在您自己的基础设施上构建全栈应用的框架。采用 MIT 许可，自 2020 年起开源，GitHub 星标超过 26,000。",
        },
        opentui: {
          name: "OpenTUI",
          body: "用 TypeScript、React 或 Solid 构建终端界面的库，核心以 Zig 编写。OpenCode 在生产环境中使用它。GitHub 星标超过 13,000。",
        },
        "models-dev": {
          name: "Models.dev",
          body: "开源的 AI 模型规格、价格和能力数据库，提供公开 API。收录了来自 200 多家提供商的 8,900 多个模型。",
        },
        hex: {
          name: "Hex",
          body: "适用于 Mac、Windows 和 Linux 的语音听写工具。Hex 在设备上完成转录并粘贴到任意应用，音频从不离开设备。",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "为本机应用提供公开 HTTPS URL 的 CLI 和 SDK。TLS 在您的机器上终止，中继服务器永远看不到明文。",
        },
      },
    },
    about: {
      title: "关于 OpenCode",
      boilerplate: {
        long: "OpenCode 是一个开源编程代理。它提供桌面应用、终端界面、移动应用和 SDK，并支持任意提供商的模型，包括 Claude、GPT 和 Gemini。OpenCode 采用 MIT 许可，由 Anomaly 打造。它在 GitHub 上拥有超过 220,000 个星标和 1,000 多位贡献者，每月有超过 2200 万开发者使用。",
        short: "OpenCode 是 Anomaly 推出的开源编程代理，提供桌面、终端和移动应用以及 SDK。",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console 是一款 Web 应用，开发者和团队可以在这里为 OpenCode 及其他编程代理购买和管理 AI 模型访问权限。它为前沿模型和开放权重模型提供按量付费的推理服务，按请求从预付额度中扣费，同时提供 OpenCode Go 订阅。团队可以获得带有成员、管理员和所有者角色的工作区，工作区级和单个用户的支出上限，通过 Okta、Microsoft Entra ID 或 Google Workspace 进行单点登录，以及 SCIM。Console 支持 30 多家提供商，团队可以接入已有的提供商账户，其自有推理服务是可选的。访问地址为 opencode.ai/console。",
          short:
            "OpenCode Console 是 Anomaly 的 Web 应用，提供按量付费的 AI 模型访问、OpenCode Go 订阅，以及预算和单点登录等团队管控功能。",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go 是为希望以固定月费使用编程模型的开发者提供的订阅。Go 每月 $10，额度更高的 Go Plus 每月 $40，Go Teams 每位成员每月 $20。每个套餐都包含一组针对代理式编程测试过的精选模型。使用上限是每个模型的月度金额，另有滚动的 5 小时和每周额度，分别为月度上限的 20% 和 50%。订阅者可以充值额度、在超出后使用按量付费余额，并可随时取消。Go 适用于 OpenCode 和其他代理。访问地址为 opencode.ai/console/go。",
          short: "OpenCode Go 是 Anomaly 推出的月度订阅，为开发者提供一组精选编程模型的月度使用额度，每月 $10 起。",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data 是一个公开仪表盘，展示开发者在 OpenCode 中使用哪些 AI 模型，以及这一组合如何随时间变化。它发布热门模型排行榜、token 用量、会话和 token 成本、缓存比率、市场份额以及按国家划分的数据。数据每小时汇总一次，天和周以 UTC 计算。用户数和会话数为近似值，成本使用 OpenCode 模型目录中的标价。记者可以引用为 OpenCode Data (opencode.ai/data)，并注明页面上显示的更新时间。",
          short:
            "OpenCode Data 是位于 opencode.ai/data 的公开仪表盘，按 OpenCode 中的真实使用量为 AI 模型排名，token、成本和市场份额每小时更新。",
        },
      },
    },
    facts: {
      title: "概览",
      items: { license: { label: "许可证" }, "first-release": { label: "首次发布" }, "made-by": { label: "开发者" } },
    },
    milestones: {
      title: "里程碑",
      items: {
        "first-release-v0-0-1": { date: "2025 年 4 月", text: "首次发布 v0.0.1" },
        "1-million-downloads": { date: "2025 年 10 月", text: "下载量突破 100 万" },
        "opencode-1-0": { date: "2025 年 10 月", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "2025 年 12 月", text: "桌面应用发布" },
        "10-million-downloads": { date: "2026 年 1 月", text: "下载量突破 1000 万" },
        "opencode-2-0": { date: "2026 年 9 月", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "2026 年 11 月", text: "GitHub 星标突破 220,000" },
      },
    },
    news: {
      title: "最新发布",
      intro: "OpenCode 更新频繁。以下是包含新功能的最新版本。",
      changelog: { text: "完整更新日志" },
      feed: { text: "RSS 订阅源" },
    },
    media: {
      title: "媒体",
      intro: "各应用的截图和短视频，均录制自真实产品。您可以在报道 OpenCode 时使用。",
      note: "所有素材均使用深色主题。截图和封面为 JPG，最大 1920 × 1080，竖版为 1080 × 1350。视频为无声 MP4 片段。",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop 影片" },
            "frame-1": { title: "Desktop 截图 1" },
            "frame-2": { title: "Desktop 截图 2" },
            "frame-3": { title: "Desktop 截图 3" },
            "frame-4": { title: "Desktop 截图 4" },
            "feature-1": { title: "标签页中的会话" },
            "feature-2": { title: "审查和评论" },
            "feature-3": { title: "在浏览器中查看" },
            "locked-portrait": { title: "Desktop 影片，竖版" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile 影片" },
            "frame-1": { title: "Mobile 截图 1" },
            "frame-2": { title: "Mobile 截图 2" },
            "frame-3": { title: "Mobile 截图 3" },
            "feature-1": { title: "语音" },
            "feature-2": { title: "批准" },
            "feature-3": { title: "会话" },
            "locked-portrait": { title: "Mobile 影片，竖版" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal 影片" },
            "frame-1": { title: "Terminal 截图 1" },
            "frame-2": { title: "Terminal 截图 2" },
            "frame-3": { title: "Terminal 截图 3" },
            "frame-4": { title: "Terminal 截图 4" },
            "feature-1": { title: "用自然语言提问" },
            "feature-2": { title: "批准要运行的内容" },
            "feature-3": { title: "随心定制" },
            "locked-portrait": { title: "Terminal 影片，竖版" },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": { title: "SDK 影片" },
            "frame-1": { title: "SDK 截图 1" },
            "frame-2": { title: "SDK 截图 2" },
            "frame-3": { title: "SDK 截图 3" },
            "frame-4": { title: "SDK 截图 4" },
            "feature-1": { title: "用代码修复 CI" },
            "feature-2": { title: "跟踪每一步" },
            "feature-3": { title: "构建自己的工具" },
            "locked-portrait": { title: "SDK 影片，竖版" },
          },
        },
      },
    },
    people: { title: "团队" },
    anomalyLogo: {
      title: "Anomaly Logo",
      body: "Anomaly 的标志和文字标识，提供黑色和白色版本。PNG 宽 2048 px。",
      assets: {
        "mark-black": { name: "标志，黑色" },
        "mark-white": { name: "标志，白色" },
        "wordmark-black": { name: "文字标识，黑色" },
        "wordmark-white": { name: "文字标识，白色" },
      },
      all: { text: "全部下载" },
    },
    coverage: { title: "媒体报道" },
    brand: {
      title: "品牌",
      before: "在一个 ZIP 文件中下载 OpenCode 的 Logo 和文字标识。如需单独的文件、变体和使用规则，请前往",
      link: { text: "品牌页面" },
      after: "。",
      usage: "您可以在报道 OpenCode 时使用这些文件。请勿修改它们，也不要暗示 OpenCode 为您的作品背书。",
    },
    product: {
      title: "产品",
      items: {
        desktop: {
          name: "Desktop",
          body: "在 macOS、Windows 和 Linux 上同时运行多个代理，每个都在独立的标签页中。以 diff 审查每处更改并预览。",
        },
        mobile: {
          name: "Mobile",
          body: "最新的 OpenCode 应用。呼叫会话与代理对话，然后随时随地在手机上审查并批准它的更改。",
        },
        terminal: {
          name: "Terminal",
          body: "可在任意 shell、编辑器或远程服务器中使用的终端界面。以 diff 查看每处编辑，并选择哪些命令可以自动运行。",
        },
        sdk: {
          name: "SDK",
          body: "面向脚本、CI 任务和自有工具的带类型 TypeScript 客户端。创建会话、发送提示词，并实时流式传输每个事件。",
        },
      },
    },
    contact: {
      title: "联系方式",
      items: {
        press: { title: "媒体", body: "面向记者和分析师。我们只回复媒体请求。" },
        support: {
          links: { "github-issues": { text: "GitHub 议题" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "支持",
          body: "如需 OpenCode 使用帮助，请提交 issue 或在社区提问。账户和账单问题请发送邮件给我们。",
        },
        security: {
          links: { "report-a-vulnerability": { text: "报告漏洞" }, "security-anoma-ly": { text: "security@anoma.ly" } },
          title: "安全",
          body: "请通过 GitHub 报告漏洞。如果 6 个工作日内无人回复，请发送邮件给我们。",
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "脚本" } } },
    extensions: {
      title: "扩展",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "脚本" } } },
    sdk: { more: { label: "阅读 SDK 文档" } },
    ide: {
      links: {
        "vs-code-marketplace": { label: "VS Code 扩展市场" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      lead: "在编辑器的集成终端中运行 opencode，扩展就会自动安装，也可以手动安装。",
      more: { label: "设置 Zed、JetBrains IDE 和其他 ACP 编辑器" },
    },
    mini: {
      commands: { curl: { name: "脚本" } },
      lead: "Mini 随 OpenCode CLI 一起提供。用以下任一方式安装，然后运行 opencode mini。",
    },
  },
  pair: {
    title: "连接手机",
    cardTitle: "一条命令配对手机",
    intro: "OpenCode Mobile 是您电脑上 OpenCode 的遥控器。会话继续在电脑上运行，应用负责显示它们，并让您引导它们。",
    steps: {
      "get-the-app": {
        title: "获取应用",
        body: "从 TestFlight 在 iPhone 上安装 OpenCode 测试版。Android 应用即将推出。",
      },
      "run-this-on-your-computer": {
        title: "在电脑上运行",
        body: "它会输出一个一次性链接和二维码。它们只能使用一次，5 分钟后过期。",
      },
      "scan-the-code": { title: "扫码", body: "用应用扫描二维码，或粘贴链接。电脑上最近的会话就会在手机上打开。" },
    },
    note: "--remote 通过 OpenTunnel 地址连接，因此可在任意网络中使用。在同一 Wi-Fi 下，先运行一次 opencode service set hostname 0.0.0.0，然后运行 opencode pair。",
    facts: [
      "可在任意网络中使用，--remote 通过 OpenTunnel 地址连接。",
      "链接和二维码只能使用一次，5 分钟后过期。",
      "请保持电脑开机，代理在电脑上运行，而不是在手机上。",
      "如果在同一 Wi-Fi 下，先运行一次 opencode service set hostname 0.0.0.0，然后运行 opencode pair。",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": { text: "创建、安装和分享桌面插件。", link: "查看 2.2 的新功能" },
    "desktop-terminals-now-survive-restarts": { text: "桌面端终端现在重启后依然保留。", link: "查看 v2.2.4" },
    "agents-can-now-generate-images": { text: "代理现在可以生成图片了。", link: "查看 v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "在手机上引导您的会话。", link: "认识 OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "焕然一新的桌面应用。", link: "查看 2.2 的新功能" },
  },
} satisfies ContentOverlay
