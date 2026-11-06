import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "在 macOS、Windows 和 Linux 上使用工作階段、分頁、diff、內建瀏覽器和擴充功能。",
      action: "下載",
    },
    mobile: { name: "Mobile", body: "不論身在何處，都能用手機啟動、引導和核准工作階段。", action: "下載" },
    terminal: {
      name: "Terminal",
      body: "快速的終端機介面，可在任何 shell、編輯器或遠端伺服器中使用。",
      action: "安裝",
    },
    sdk: { name: "SDK", body: "從你自己的腳本、CI 工作和工具驅動 OpenCode。", action: "閱讀文件" },
    ide: {
      name: "IDE 擴充功能",
      body: "在 VS Code、Cursor 和 Windsurf 中開啟 OpenCode，或透過 ACP 在 Zed 和 JetBrains IDE 中使用。",
      action: "安裝",
    },
    mini: {
      name: "Mini",
      body: "極簡的終端機介面，回覆直接輸出到捲動紀錄中，下方只有一個提示詞輸入框。",
      action: "安裝",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | 適用於 macOS、Windows 和 Linux 的桌面應用程式",
      description:
        "平行執行任意多個 OpenCode 代理，在旁邊的瀏覽器中查看每項變更，並在任何裝置上繼續。適用於 macOS、Windows 和 Linux。",
      intro:
        "同時執行多個代理，每個工作階段都有獨立的分頁。以 diff 審查每項變更，在任何一行留言，並在內建瀏覽器中檢查結果。支援 macOS、Windows 和 Linux。",
      showcase: {
        "parallel-agents": {
          title: "平行代理",
          body: "想啟動多少個代理都可以，讓它們全部平行工作。哪個完成了，就切換過去查看。",
        },
        "see-it-in-the-browser": {
          title: "在瀏覽器中查看",
          body: "你的應用程式會在代理旁的瀏覽器中開啟，你和代理都能看到每項變更落地。",
        },
        "on-every-device": {
          title: "在每台裝置上",
          body: "在你的所有裝置上啟動代理，並在桌面應用程式、終端機或手機上繼續。",
        },
        "extend-it": {
          title: "擴充它",
          body: "連接你的工具和服務，讓代理能處理任何事情。或者讓 OpenCode 為自己建立外掛程式，並在側邊欄中擁有自己的介面。",
        },
      },
    },
    mobile: {
      title: "OpenCode | 用手機引導編碼代理的行動應用程式",
      description:
        "在手機上啟動並引導 OpenCode 工作階段。代理在您的電腦上執行時，您可以與它對話。",
      intro:
        "無論身在何處，都能在手機上啟動並引導工作階段。打電話給工作階段與代理交談，或開啟任一工作階段從上次中斷處繼續，一切都在您自己電腦上的 OpenCode 中執行。",
      features: {
        "notify-when-done": { title: "完成時通知", body: "你啟動的工作階段完成後，會收到一段簡短摘要。" },
        "pair-from-anywhere": { title: "隨處配對", body: "使用 opencode pair --remote 從任何網路連線。" },
        "every-computer": { title: "每台電腦", body: "輕點一下即可切換已配對的電腦。" },
        "siri-and-shortcuts": { title: "Siri 與捷徑", body: "透過 Siri 或控制中心發起通話或工作階段。" },
        "follow-along": { title: "即時跟進", body: "看著時間軸隨代理的工作即時更新。" },
        "your-computer": { title: "你的電腦", body: "連線到你自己電腦上執行的 OpenCode。" },
        "share-sheet": { title: "分享表單", body: "不用開啟應用程式，就能把任何內容分享到工作階段。" },
        "mute-sessions": { title: "靜音工作階段", body: "將工作階段留在清單中，但不接收它的通知。" },
      },
      showcase: {
        results: { title: "結果", body: "你交代的工作完成後，通話會告訴你改了什麼。" },
        voice: { title: "語音", body: "撥打給工作階段，說出你的需求。代理會出聲回答。" },
        sessions: { title: "工作階段", body: "開啟任何工作階段查看進度，再從上次中斷的地方繼續。" },
        steer: { title: "引導", body: "傳送後續訊息，在工作階段中途調整方向。" },
      },
    },
    terminal: {
      title: "OpenCode | 開源編碼代理的終端機介面",
      description:
        "OpenCode 的快速終端機介面，可在任何 shell、編輯器或遠端伺服器中使用。描述你的需求，以 diff 查看每處編輯，並核准指令。",
      intro:
        "快速的終端機介面，可在任何 shell、編輯器或遠端伺服器中使用。用日常語言描述需求，看著每處編輯以 diff 呈現，並選擇哪些指令可以自動執行。",
      features: {
        "any-terminal": { title: "任何終端機", body: "可在任何 shell、編輯器的終端機或遠端伺服器中使用。" },
        "diffs-in-the-timeline": { title: "時間軸中的 diff", body: "代理每做一處編輯，都會以 diff 顯示在時間軸中。" },
        "pick-up-later": { title: "稍後繼續", body: "用 -c 繼續上一個工作階段，或用 -s 繼續任何工作階段。" },
        "one-off-runs": { title: "單次執行", body: "opencode run 傳送一則訊息並輸出回覆。" },
        "agents-and-commands": { title: "代理與指令", body: "用 shift+tab 切換代理，用 ctrl+p 開啟所有指令。" },
        "auto-approve": { title: "自動核准", body: "以 --auto 執行，即可允許所有你未拒絕的動作。" },
        "any-server": { title: "任何伺服器", body: "使用 --server 透過 URL 連線到 OpenCode 伺服器。" },
        "usage-stats": { title: "使用統計", body: "opencode stats 顯示可分享的使用統計。" },
      },
      showcase: {
        "ask-in-plain-words": { title: "用日常語言提問", body: "輸入你的需求，代理會在工作時展示計畫。" },
        "approve-what-runs": { title: "核准要執行的內容", body: "編輯以 diff 顯示，指令會等待你的許可。" },
        "make-it-yours": { title: "隨心打造", body: "一鍵切換主題，從預設主題到 tokyonight 等。" },
        mini: { title: "Mini", body: "執行 opencode mini，回覆會輸出到你自己的捲動紀錄中。" },
      },
    },
    sdk: {
      title: "OpenCode | 用程式碼驅動代理的 TypeScript SDK",
      description:
        "從你自己的腳本、CI 工作和工具驅動 OpenCode。具型別的 TypeScript 用戶端可以建立工作階段、傳送提示詞，並即時串流每個事件。",
      intro:
        "從你自己的腳本、CI 工作和工具驅動 OpenCode。SDK 在你的處理程序內執行 OpenCode，使用你的設定和模型，其具型別的用戶端可以建立工作階段、傳送提示詞並串流每個事件。",
      features: {
        "typescript-client": { title: "TypeScript 用戶端", body: "具型別的請求和事件，與 @opencode/client 的值相同。" },
        "sessions-from-code": { title: "用程式碼建立工作階段", body: "在任何腳本中建立工作階段並傳送提示詞。" },
        "any-model": { title: "任何模型", body: "使用你的 OpenCode 設定中的任何模型。" },
        "npm-or-bun": { title: "npm 或 bun", body: "使用 npm i @opencode/sdk 或 bun add @opencode/sdk 安裝。" },
        "in-process-host": { title: "同處理程序主機", body: "在記憶體中執行 OpenCode，不經過網路。" },
        "your-plugins": { title: "你的外掛", body: "建立同處理程序主機時傳入你自己的外掛。" },
        "promise-or-effect": { title: "Promise 或 Effect", body: "Promise API 和 Effect API，回傳相同的值。" },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "在 Workers 上的 Cloudflare Durable Object 中執行 OpenCode。",
        },
      },
      showcase: {
        "in-your-process": { title: "在你的處理程序內", body: "在你的處理程序內執行 OpenCode，使用你的設定和模型。" },
        "fix-ci-from-code": {
          title: "用程式碼修復 CI",
          body: "一段簡短的腳本請 OpenCode 修復失敗的測試，然後重新執行。",
        },
        "follow-every-step": { title: "追蹤每一步", body: "串流事件，即時查看代理呼叫的每個工具。" },
        "build-your-own-tools": {
          title: "打造自己的工具",
          body: "只要幾行程式碼，就能把 OpenCode 接入機器人、儀表板和工作流程。",
        },
      },
    },
    ide: {
      title: "OpenCode | 適用於 VS Code、Cursor、Zed 等的 IDE 擴充功能",
      description:
        "在編輯器中使用 OpenCode。VS Code、Cursor、Windsurf 和 VSCodium 有專用擴充功能，Zed、JetBrains IDE 和其他 ACP 編輯器可使用 opencode acp。",
      intro:
        "在編輯器中使用 OpenCode。在 VS Code、Cursor、Windsurf 和 VSCodium 中，於整合式終端機執行 opencode，擴充功能就會自動安裝。Zed、JetBrains IDE 以及其他支援 Agent Client Protocol 的編輯器可透過 opencode acp 執行 OpenCode。",
      features: {
        "quick-launch": { title: "快速啟動", body: "Cmd+Esc 或 Ctrl+Esc 在分割終端機中開啟 OpenCode。" },
        "new-session": { title: "新工作階段", body: "Cmd+Shift+Esc 或 Ctrl+Shift+Esc 開啟另一個工作階段。" },
        context: { title: "上下文", body: "將目前選取的內容或分頁分享給 OpenCode。" },
        "file-references": { title: "檔案參照", body: "Cmd+Option+K 或 Alt+Ctrl+K 插入 @File#L37-42。" },
        "installs-itself": { title: "自動安裝", body: "在整合式終端機中執行 opencode 即可加入。" },
        "acp-editors": { title: "ACP 編輯器", body: "Zed、JetBrains IDE、Avante.nvim 和 CodeCompanion.nvim。" },
        "open-vsx": { title: "Open VSX", body: "也在 Open VSX 上提供，適用於 Cursor、Windsurf 和 VSCodium。" },
        "same-agent": { title: "同一個代理", body: "就是你在終端機中執行的 OpenCode，就在程式碼旁邊。" },
      },
    },
    mini: {
      title: "OpenCode | Mini，代理的極簡終端機介面",
      description:
        "Mini 在極簡的終端機介面中執行 OpenCode。回覆直接輸出到終端機本身的捲動紀錄中，下方只保留提示詞輸入框和一行狀態列。",
      intro:
        "OpenCode 的極簡終端機介面。執行 opencode mini，回覆會直接輸出到終端機本身的捲動紀錄中，你可以像處理其他輸出一樣捲動、搜尋和複製。底部只保留提示詞輸入框和一行狀態列。",
      features: {
        "your-scrollback": { title: "你的捲動紀錄", body: "回覆就是一般的終端機歷史紀錄。" },
        "one-prompt": { title: "一個輸入框", body: "代理、模型、上下文和費用都在一行狀態列中。" },
        permissions: { title: "權限", body: "在輸入區域允許編輯和指令。" },
        "how-much-shows": { title: "顯示多少", body: "思考過程和工具輸出可設為安靜、預設或全部。" },
        "pick-up-later": { title: "稍後繼續", body: "用 -c 繼續上一個工作階段，或用 -s 繼續任何工作階段。" },
        "same-opencode": { title: "同一個 OpenCode", body: "伺服器、代理和模型與其他應用程式相同。" },
        agents: { title: "代理", body: "直接在輸入框中切換代理。" },
        compact: { title: "壓縮", body: "用 /compact 壓縮冗長的工作階段。" },
      },
    },
  },
  extensionCard: {
    name: "擴充功能",
    body: "在 VS Code 中使用 OpenCode，或透過 ACP 在 Zed 等編輯器中使用。",
    action: "安裝",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "讓代理使用你真正的瀏覽器。",
      title: "OpenCode | Browse，為編碼代理準備的真正瀏覽器",
      description:
        "Browse 讓 OpenCode 和其他 MCP 用戶端使用你真正的瀏覽器。代理透過 Playwright 操作背景分頁，並把登入和雙重驗證交還給你。",
      intro:
        "一個 MCP 伺服器加上一個 Chromium 擴充功能，讓你的代理使用真正的瀏覽器，包括你的分頁、登入狀態和擴充功能。代理透過 Playwright 開啟並操作分頁、擷取螢幕畫面和錄製螢幕，這些分頁都在背景分組，不會打擾你。輪到你操作時，例如登入、雙重驗證或付款，代理會把分頁交還給你，你按下「繼續」後它再接著工作。",
      features: {
        "your-real-browser": {
          title: "真正的瀏覽器",
          body: "Chrome、Edge、Brave、Arc、Helium、Vivaldi、Opera 和 Chromium。",
        },
        "out-of-your-way": { title: "不打擾你", body: "代理的分頁在背景開啟，並收進摺疊的群組中。" },
        handoffs: { title: "交接", body: "自己完成登入或雙重驗證，然後按下「繼續」。" },
        "lend-a-tab": { title: "借出分頁", body: "按一下工具列按鈕，把已開啟的分頁交給代理。" },
        "record-and-capture": { title: "錄製與擷取", body: "螢幕截圖、螢幕錄影，以及 HAR 格式的網路流量。" },
        "any-mcp-client": {
          title: "任何 MCP 用戶端",
          body: "OpenCode、Claude Code、Cursor、Codex、Zed 等眾多用戶端。",
        },
        "named-sessions": { title: "具名工作階段", body: "每個工作階段都保留自己的分頁，重新啟動後依然存在。" },
        allowlists: { title: "允許清單", body: "將工作階段的分頁限制在你指定的網站內。" },
      },
      install:
        "一行指令安裝 Browse，將它加入找到的代理並配對擴充功能。在 Windows 上執行 irm https://opencode.ai/browse/install.ps1 | iex。也可以請代理幫你設定。",
    },
  },
  apps: {
    hex: { category: "語音聽寫", body: "適用於任何應用程式的裝置端語音聽寫。" },
    opentunnel: { category: "本機通道", body: "為本機應用程式提供公開的 HTTPS URL。" },
    opentui: { category: "函式庫", body: "用於打造終端機使用者介面的函式庫。" },
  },
  getStarted: {
    title: "開始使用",
    lead: "最簡單的入門方式是下載 OpenCode 並使用免費模型，不需要帳號。想要更多，可以使用你自己的訂閱或 OpenCode Go。",
    phrases: {
      "download-opencode": { text: "下載 OpenCode" },
      "free-models": { text: "免費模型" },
      "your-own-subscription": { text: "你自己的訂閱" },
      "a-subscription-you-already-have": { text: "已有的訂閱" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "下載", line: "桌面、行動裝置或終端機。" },
      "use-free-models": { title: "使用免費模型", line: "OpenCode 內建一組免費模型，不需要帳號。" },
      "add-more-models": {
        title: "加入更多模型",
        line: "使用你自己的訂閱，或選擇 OpenCode Go 的精選模型，每月 $10 起。",
      },
    },
    sentence: "下載 OpenCode，從免費模型開始，想要更多時再使用你自己的訂閱或 OpenCode Go。",
  },
  byos: {
    title: "自備訂閱",
    headline: "使用你已有的訂閱。",
    line: "使用 ChatGPT Plus 或 Pro 或 GitHub Copilot 登入，或是使用 OpenCode 訂閱。",
    yours: { label: "你的訂閱", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode 訂閱", "OpenCode Go"],
    ours: { label: "OpenCode 方案" },
  },
  brand: {
    hero: { copy: { text: "給代理的規範", copied: "已複製規範" } },
    naming: {
      title: "命名",
      body: "OpenCode 寫成一個字，O 和 C 大寫。不要寫成 Opencode、Open Code、OpenCode AI 或 Open-Code。",
      code: "小寫的 `opencode` 只用於程式碼和套件名稱，例如 `opencode-figma` 或 `@acme/opencode-plugin`。",
    },
    families: {
      logo: {
        title: "Logo",
        body: "單獨的 Logo，用於應用程式圖示、大頭貼和其他小空間。方形版本加了內距，適合會裁成方形的地方。",
        assets: {
          light: { name: "淺色" },
          dark: { name: "深色" },
          "square-light": { name: "方形，淺色" },
          "square-dark": { name: "方形，深色" },
        },
      },
      wordmark: {
        title: "字標",
        body: "以 OpenCode 字形寫出的完整名稱。只要有空間寫出全名，就使用它。",
        assets: { light: { name: "淺色" }, dark: { name: "深色" } },
      },
      "simple-wordmark": {
        title: "簡版字標",
        body: "單色版本的字標，適用於印刷、刺繡以及只允許使用一種顏色的地方。",
        assets: { light: { name: "淺色" }, dark: { name: "深色" } },
      },
    },
    icons: {
      title: "大頭貼",
      body: "1024px 的方形大頭貼，適用於 Slack、Discord、GitHub 等個人檔案。背景填滿整個方形，Logo 位於圓形範圍內，即使被裁成圓形也能完整顯示。",
      items: { dark: { name: "深色" }, light: { name: "淺色" } },
    },
    colors: {
      title: "色彩",
      body: "Logo 和字標使用同一種墨色的三種不透明度，深色背景則使用較淺的墨色。下方數值是該墨色疊在白色或 #0B0B0B 上的效果，與標準檔案一致。點一下數值即可複製。",
      palettes: {
        light: {
          name: "淺色",
          swatches: {
            ink: { name: "墨色", use: "Logo 的輪廓和「code」的字母。" },
            "ink-70": { name: "墨色 70%", use: "「open」的字母。", ink: "70% 不透明度的墨色。" },
            "ink-20": { name: "墨色 20%", use: "Logo 的內部陰影。", ink: "20% 不透明度的墨色。" },
          },
        },
        dark: {
          name: "深色",
          swatches: {
            ink: { name: "墨色", use: "Logo 的輪廓和「code」的字母。" },
            "ink-72": { name: "墨色 72%", use: "「open」的字母。", ink: "72% 不透明度的墨色。" },
            "ink-28": { name: "墨色 28%", use: "Logo 的內部陰影。", ink: "28% 不透明度的墨色。" },
          },
        },
      },
    },
    variants: {
      title: "變化版本",
      body: "選擇能讓 Logo 在背景上清楚顯示的版本，淺色背景用深色版，深色背景用淺色版。Logo 和字標是不同的檔案，兩者擇一使用。",
      groups: {
        default: {
          name: "預設",
          body: "幾乎所有地方都使用這個 Logo。它的內部陰影是透明的，在白色或黑色背景上看起來和雙色灰完全相同，在照片、漸層和彩色背景上則會透出背景。",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "深色" }, light: { name: "淺色" } } },
            wordmark: { title: "字標", tiles: { dark: { name: "深色" }, light: { name: "淺色" } } },
          },
        },
        simple: {
          name: "簡版",
          body: "單色，字腔鏤空，沒有內部陰影。用於純色背景、單色印刷以及無法使用灰色的地方，淺色背景用深色簡版，深色背景用淺色簡版。",
          rows: { wordmark: { title: "字標", tiles: { dark: { name: "深色" }, light: { name: "淺色" } } } },
        },
      },
    },
    usage: {
      title: "使用",
      body: "淺色背景使用淺色版本，深色背景使用深色版本。Logo 和字標彼此獨立，兩者擇一使用，不要同時使用。",
      stroke: {
        title: "1 筆畫",
        body: "本頁的間距規則以筆畫為單位。1 筆畫等於 Logo 輪廓的粗細，也就是其寬度的四分之一，因此 Logo 寬 4 筆畫、高 5 筆畫。",
      },
      clearSpace: {
        title: "留白",
        body: "Logo 和字標四周至少各留 2 筆畫的空間。對 Logo 而言，1 筆畫是其輪廓的粗細，也就是寬度的四分之一；對字標而言，是其字母的粗細，也就是高度的七分之一。",
      },
      pixels: {
        title: "整數像素",
        body: "Logo 的比例固定為 4:5，1 筆畫是其寬度的四分之一。請以 4 × 5px 為級距縮放，讓每條邊和每個筆畫都落在整數像素上。",
        do: "讓每條邊和 4px 的筆畫都落在整數像素上。",
        dont: "使用非 4:5 的尺寸，否則邊緣會落在像素之間而變得模糊。",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "字標" } },
      },
      minimumTitle: "最小尺寸",
      minimum: {
        logo: { title: "Logo", body: "至少 16 × 20px，筆畫為 4px。再小就會模糊。" },
        wordmark: { title: "字標", body: "至少 117 × 21px，筆畫為 3px。再小就會模糊。" },
      },
    },
    donts: {
      title: "禁止事項",
      body: "使用 Logo 和字標時應避免的常見錯誤。",
      examples: {
        "two-tone": { caption: "把 Logo 改成新的顏色。" },
        bright: { caption: "使用單一的鮮豔顏色。" },
        gradient: { caption: "用漸層填滿 Logo。" },
        inverted: { caption: "互換色調。" },
        stretch: { caption: "拉長或壓扁 Logo。" },
        shadow: { caption: "加上陰影。" },
        glow: { caption: "加上光暈或外框。" },
        lockup: { caption: "在 Logo 旁邊加上其他文字。" },
        "low-contrast": { caption: "使用低對比的灰配灰。" },
        color: { caption: "把雙色灰 Logo 放在彩色背景上，灰色會變得混濁。" },
      },
    },
    integrations: {
      title: "整合",
      body: "與 OpenCode 搭配使用的外掛、供應商和工具，以及用 OpenCode 打造的專案，都可以註明這一點。請使用徽章或合作夥伴組合標誌，並為專案命名，清楚表明它屬於你。",
      badges: {
        body: "在 README、文件或網站中放上徽章，並連結到 opencode.ai。依背景選擇淺色或深色檔案（HTML 會自動切換），不要更改顏色或文字。",
        sizes: "每種樣式都提供 20、32 和 44px（Shields 僅有 20px），格式為 SVG 和 2 倍 PNG。",
        mono: "每個檔案也有使用 OpenTUI Mono 字型的版本，在副檔名前加上 -mono，例如 opencode-works-with-a-light-20-mono.svg；加上 -mono-caps 則為大寫 OpenTUI Mono。",
        groups: {
          "works-with": { title: "相容", alt: "相容 OpenCode", body: "適用於搭配 OpenCode 執行的外掛、供應商和工具。" },
          "built-with": { title: "打造於", alt: "以 OpenCode 打造", body: "適用於用 OpenCode 製作的專案。" },
        },
        styles: { a: { name: "外框" }, c: { name: "格子" }, f: { name: "實心" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "合作夥伴組合標誌",
        body: "將 OpenCode Logo 和合作夥伴 Logo 並排放置，中間加一個 ×。× 兩側各留 3 筆畫的空間，合作夥伴 Logo 的視覺高度與 OpenCode Logo 一致，並在整個組合標誌四周保留留白。",
        partners: { github: { name: "GitHub" } },
      },
      naming: {
        title: "為專案命名",
        body: "以你自己的名稱開頭，清楚表明專案屬於你。",
        rule: "寫成 `Linear for OpenCode`，或將套件命名為 `opencode-linear`。不要寫成 `OpenCode Linear` 或 `Linear by OpenCode`。",
      },
    },
    trademarks: {
      title: "商標",
      body: "OpenCode 和 OpenCode Logo 是 Anomaly 的商標。未經許可，不得用來暗示 Anomaly 認可或贊助你，不得用於你的產品或公司名稱，也不得用於周邊商品。",
      contact: { before: "如有疑問，請寄信至 ", after: "。" },
    },
  },
  press: {
    title: "OpenCode | 含公司資訊與品牌素材的媒體資料包",
    description:
      "OpenCode 媒體資料包，包含 OpenCode 及其背後公司 Anomaly 的相關資訊、可下載的 Logo 和字標，以及媒體詢問的聯絡方式。",
    hero: { title: "媒體", body: "報導 OpenCode 和 Anomaly 所需的資訊、品牌素材和聯絡方式。" },
    company: {
      title: "關於 Anomaly",
      lead: "Anomaly 是 OpenCode 背後的公司，專為開發者打造開源工具。",
      more: "其他專案包括 SST 和 OpenTUI，全部在 [GitHub](github) 上開源。",
      learnMore: "想了解更多，請前往 [anoma.ly](site)。",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "開源編碼代理，提供桌面、行動和終端機應用程式以及 SDK。採用 MIT 授權，GitHub 星星超過 220,000 顆。",
        },
        sst: {
          name: "SST",
          body: "在你自己的基礎架構上打造全端應用程式的框架。採用 MIT 授權，自 2020 年起開源，GitHub 星星超過 26,000 顆。",
        },
        opentui: {
          name: "OpenTUI",
          body: "用 TypeScript、React 或 Solid 打造終端機介面的函式庫，核心以 Zig 撰寫。OpenCode 在正式環境中使用它。GitHub 星星超過 13,000 顆。",
        },
        "models-dev": {
          name: "Models.dev",
          body: "開源的 AI 模型規格、價格與能力資料庫，提供公開 API。收錄來自 200 多家供應商的 8,900 多個模型。",
        },
        hex: {
          name: "Hex",
          body: "適用於 Mac、Windows 和 Linux 的語音聽寫工具。Hex 在裝置上完成轉錄並貼到任何應用程式，音訊從不離開裝置。",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "為本機應用程式提供公開 HTTPS URL 的 CLI 和 SDK。TLS 在你的電腦上終止，中繼伺服器永遠看不到明文。",
        },
      },
    },
    about: {
      title: "關於 OpenCode",
      boilerplate: {
        long: "OpenCode 是一個開源編碼代理。它提供桌面應用程式、行動應用程式、終端機介面和 SDK，並支援任何供應商的模型，包括 Claude、GPT 和 Gemini。OpenCode 採用 MIT 授權，由 Anomaly 打造。它在 GitHub 上擁有超過 220,000 顆星星和 1,000 多位貢獻者，每月有超過 2200 萬名開發者使用。",
        short: "OpenCode 是 Anomaly 推出的開源編碼代理，提供桌面、行動和終端機應用程式以及 SDK。",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console 是一款 Web 應用程式，開發者和團隊可以在這裡為 OpenCode 及其他編碼代理購買和管理 AI 模型存取權。它為前沿模型和開放權重模型提供隨用隨付的推論服務，依請求從預付額度扣款，同時提供 OpenCode Go 訂閱。團隊可以取得具備成員、管理員和擁有者角色的工作區、工作區層級與個別使用者的支出上限、透過 Okta、Microsoft Entra ID 或 Google Workspace 進行單一登入，以及 SCIM。Console 支援 30 多家供應商，團隊可以連接既有的供應商帳號，自家推論服務則為選用。網址為 opencode.ai/console。",
          short:
            "OpenCode Console 是 Anomaly 的 Web 應用程式，提供隨用隨付的 AI 模型存取、OpenCode Go 訂閱，以及預算和單一登入等團隊管控功能。",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go 是為希望以固定月費使用編碼模型的開發者提供的訂閱。Go 每月 $10，額度更高的 Go Plus 每月 $40，Go Teams 每位成員每月 $20。每個方案都包含一組針對代理式編碼測試過的精選模型。使用上限是每個模型的每月金額，另有滾動計算的 5 小時和每週額度，分別為每月上限的 20% 和 50%。訂閱者可以儲值額度、在用完後改用隨用隨付餘額，並可隨時取消。Go 適用於 OpenCode 和其他代理。網址為 opencode.ai/console/go。",
          short: "OpenCode Go 是 Anomaly 推出的月訂閱，為開發者提供一組精選編碼模型的每月使用額度，每月 $10 起。",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data 是一個公開儀表板，顯示開發者在 OpenCode 中使用哪些 AI 模型，以及這個組合如何隨時間變化。它發布熱門模型排行榜、token 用量、工作階段與 token 成本、快取比率、市占率以及依國家區分的資料。數據每小時彙整一次，日和週以 UTC 計算。使用者數和工作階段數為約略值，成本採用 OpenCode 模型目錄中的定價。記者可以引用為 OpenCode Data (opencode.ai/data)，並註明頁面上顯示的更新時間。",
          short:
            "OpenCode Data 是位於 opencode.ai/data 的公開儀表板，依 OpenCode 中的實際用量為 AI 模型排名，token、成本和市占率每小時更新。",
        },
      },
    },
    facts: {
      title: "概覽",
      items: { license: { label: "授權" }, "first-release": { label: "首次發布" }, "made-by": { label: "開發者" } },
    },
    milestones: {
      title: "里程碑",
      items: {
        "first-release-v0-0-1": { date: "2025 年 4 月", text: "首次發布 v0.0.1" },
        "1-million-downloads": { date: "2025 年 10 月", text: "下載次數突破 100 萬" },
        "opencode-1-0": { date: "2025 年 10 月", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "2025 年 12 月", text: "桌面應用程式推出" },
        "10-million-downloads": { date: "2026 年 1 月", text: "下載次數突破 1000 萬" },
        "opencode-2-0": { date: "2026 年 9 月", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "2026 年 11 月", text: "GitHub 星星突破 220,000 顆" },
      },
    },
    news: {
      title: "最新版本",
      intro: "OpenCode 經常推出更新。以下是含有新功能的最新版本。",
      changelog: { text: "完整更新日誌" },
      feed: { text: "RSS 訂閱" },
    },
    media: {
      title: "媒體",
      intro: "各應用程式的截圖和短片，皆錄製自實際產品。你可以在報導 OpenCode 時使用。",
      note: "所有素材皆使用深色主題。截圖和封面為 JPG，最大 1920 × 1080，直式為 1080 × 1350。影片為無聲的 MP4 片段。",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop 影片" },
            "frame-1": { title: "Desktop 截圖 1" },
            "frame-2": { title: "Desktop 截圖 2" },
            "frame-3": { title: "Desktop 截圖 3" },
            "frame-4": { title: "Desktop 截圖 4" },
            "feature-1": { title: "分頁中的工作階段" },
            "feature-2": { title: "審查與留言" },
            "feature-3": { title: "在瀏覽器中查看" },
            "locked-portrait": { title: "Desktop 影片，直式" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile 影片" },
            "frame-1": { title: "Mobile 截圖 1" },
            "frame-2": { title: "Mobile 截圖 2" },
            "frame-3": { title: "Mobile 截圖 3" },
            "feature-1": { title: "語音" },
            "feature-2": { title: "核准" },
            "feature-3": { title: "工作階段" },
            "locked-portrait": { title: "Mobile 影片，直式" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal 影片" },
            "frame-1": { title: "Terminal 截圖 1" },
            "frame-2": { title: "Terminal 截圖 2" },
            "frame-3": { title: "Terminal 截圖 3" },
            "frame-4": { title: "Terminal 截圖 4" },
            "feature-1": { title: "用日常語言提問" },
            "feature-2": { title: "核准要執行的內容" },
            "feature-3": { title: "隨心打造" },
            "locked-portrait": { title: "Terminal 影片，直式" },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": { title: "SDK 影片" },
            "frame-1": { title: "SDK 截圖 1" },
            "frame-2": { title: "SDK 截圖 2" },
            "frame-3": { title: "SDK 截圖 3" },
            "frame-4": { title: "SDK 截圖 4" },
            "feature-1": { title: "用程式碼修復 CI" },
            "feature-2": { title: "追蹤每一步" },
            "feature-3": { title: "打造自己的工具" },
            "locked-portrait": { title: "SDK 影片，直式" },
          },
        },
      },
    },
    people: { title: "團隊" },
    anomalyLogo: {
      title: "Anomaly Logo",
      body: "Anomaly 的標誌和字標，提供黑色和白色版本。PNG 寬 2048 px。",
      assets: {
        "mark-black": { name: "標誌，黑色" },
        "mark-white": { name: "標誌，白色" },
        "wordmark-black": { name: "字標，黑色" },
        "wordmark-white": { name: "字標，白色" },
      },
      all: { text: "全部下載" },
    },
    coverage: { title: "媒體報導" },
    brand: {
      title: "品牌",
      before: "在一個 ZIP 檔案中下載 OpenCode 的 Logo 和字標。如需個別檔案、變化版本和使用規則，請前往",
      link: { text: "品牌頁面" },
      after: "。",
      usage: "你可以在報導 OpenCode 時使用這些檔案。請勿修改它們，也不要暗示 OpenCode 為你的作品背書。",
    },
    product: {
      title: "產品",
      items: {
        desktop: {
          name: "Desktop",
          body: "在 macOS、Windows 和 Linux 上同時執行多個代理，每個都在獨立的分頁中。以 diff 審查每項變更並預覽。",
        },
        mobile: {
          name: "Mobile",
          body: "最新的 OpenCode 應用程式。撥打給工作階段與代理對話，再隨時隨地用手機審查並核准它的變更。",
        },
        terminal: {
          name: "Terminal",
          body: "可在任何 shell、編輯器或遠端伺服器中使用的終端機介面。以 diff 查看每處編輯，並選擇哪些指令可以自動執行。",
        },
        sdk: {
          name: "SDK",
          body: "適用於腳本、CI 工作和自有工具的具型別 TypeScript 用戶端。建立工作階段、傳送提示詞，並即時串流每個事件。",
        },
      },
    },
    contact: {
      title: "聯絡方式",
      items: {
        press: { title: "媒體", body: "適用於記者和分析師。我們只回覆媒體請求。" },
        support: {
          links: { "github-issues": { text: "GitHub 議題" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "支援",
          body: "如需 OpenCode 使用協助，請提交 issue 或在社群中提問。帳號和帳單問題請寄信給我們。",
        },
        security: {
          links: { "report-a-vulnerability": { text: "回報漏洞" }, "security-anoma-ly": { text: "security@anoma.ly" } },
          title: "安全",
          body: "請透過 GitHub 回報漏洞。如果 6 個工作天內無人回覆，請寄信給我們。",
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "指令碼" } } },
    extensions: {
      title: "擴充功能",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "指令碼" } } },
    sdk: { more: { label: "閱讀 SDK 文件" } },
    ide: {
      links: {
        "vs-code-marketplace": { label: "VS Code Marketplace" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      lead: "在編輯器的整合式終端機中執行 opencode，擴充功能就會自動安裝，也可以手動安裝。",
      more: { label: "設定 Zed、JetBrains IDE 和其他 ACP 編輯器" },
    },
    mini: {
      commands: { curl: { name: "指令碼" } },
      lead: "Mini 隨 OpenCode CLI 一起提供。用以下任一方式安裝，然後執行 opencode mini。",
    },
  },
  pair: {
    title: "連接手機",
    cardTitle: "一行指令配對手機",
    intro:
      "OpenCode Mobile 是你電腦上 OpenCode 的遙控器。工作階段繼續在電腦上執行，應用程式負責顯示它們，並讓你引導它們。",
    steps: {
      "get-the-app": {
        title: "取得應用程式",
        body: "透過 TestFlight 在 iPhone 上安裝 OpenCode 測試版。Android 應用程式即將推出。",
      },
      "run-this-on-your-computer": {
        title: "在電腦上執行",
        body: "它會輸出一次性連結和 QR 碼。它們只能使用一次，5 分鐘後失效。",
      },
      "scan-the-code": {
        title: "掃描 QR 碼",
        body: "用應用程式掃描 QR 碼，或貼上連結。電腦上最近的工作階段就會在手機上開啟。",
      },
    },
    note: "--remote 透過 OpenTunnel 位址連線，因此可在任何網路中使用。在同一個 Wi-Fi 下，先執行一次 opencode service set hostname 0.0.0.0，再執行 opencode pair。",
    facts: [
      "可在任何網路中使用，--remote 透過 OpenTunnel 位址連線。",
      "連結和 QR 碼只能使用一次，5 分鐘後失效。",
      "請讓電腦保持開機，代理在電腦上執行，而不是在手機上。",
      "如果在同一個 Wi-Fi 下，先執行一次 opencode service set hostname 0.0.0.0，再執行 opencode pair。",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": { text: "建立、安裝和分享桌面外掛。", link: "查看 2.2 的新功能" },
    "desktop-terminals-now-survive-restarts": { text: "桌面終端機現在重新啟動後依然保留。", link: "查看 v2.2.4" },
    "agents-can-now-generate-images": { text: "代理現在可以產生圖片了。", link: "查看 v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "用手機引導你的工作階段。", link: "認識 OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "煥然一新的桌面應用程式。", link: "查看 2.2 的新功能" },
  },
} satisfies ContentOverlay
