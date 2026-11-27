import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "在 macOS、Windows 和 Linux 上使用工作階段、分頁、Diff、內建瀏覽器和擴充功能。",
      action: "下載",
    },
    mobile: { name: "Mobile", body: "無論身在何處，都能在手機上啟動工作階段、調整方向和核准操作。", action: "下載" },
    terminal: {
      name: "Terminal",
      body: "快速的終端機介面，可在任何 shell、編輯器或遠端伺服器中使用。",
      action: "安裝",
    },
    sdk: { name: "SDK", body: "用你自己的指令碼、CI 工作和工具操作 OpenCode。", action: "閱讀文件" },
    mini: {
      name: "Mini",
      body: "極簡終端機介面。回覆直接輸出到捲動歷史，下方只留一個輸入框。",
      action: "安裝",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode Desktop｜適用於 macOS、Windows 和 Linux",
      description:
        "想同時執行多少個 OpenCode agent 都可以。在一旁的瀏覽器查看每項變更，再換到任何裝置繼續。適用於 macOS、Windows 和 Linux。",
      intro:
        "同時執行多個 agent，每個工作階段各有一個分頁。透過 Diff 審查每項變更、在任一行留言，再用內建瀏覽器確認結果。支援 macOS、Windows 和 Linux。",
      showcase: {
        "parallel-agents": {
          title: "多個 agent 同時工作",
          body: "想啟動多少個 agent 都可以，讓它們各自工作。哪個完成了，就切過去看結果。",
        },
        "see-it-in-the-browser": {
          title: "在瀏覽器查看變更",
          body: "你的應用程式會在 agent 旁的瀏覽器中開啟，你和 agent 都能即時看到每項變更。",
        },
        "on-every-device": {
          title: "跨裝置接力",
          body: "在任何裝置啟動 agent，再到桌面應用程式、終端機或手機上接著做。",
        },
        "extend-it": {
          title: "擴充 OpenCode",
          body: "連接自己的工具和服務，讓 agent 處理各種工作。也能請 OpenCode 自己寫外掛，在側邊欄提供專屬介面。",
        },
      },
    },
    mobile: {
      title: "OpenCode Mobile｜在手機上繼續編碼工作階段",
      description:
        "從手機啟動 OpenCode 工作階段，也能隨時調整方向。agent 在電腦上工作時，你可以直接和它對話。",
      intro:
        "無論身在何處，都能用手機啟動工作階段、調整方向。發起語音通話，直接和 agent 對話，或開啟任一工作階段接著做。一切都由你電腦上的 OpenCode 執行。",
      features: {
        "notify-when-done": { title: "完成時通知", body: "你啟動的工作階段完成後，會收到一段簡短摘要。" },
        "pair-from-anywhere": { title: "隨處配對", body: "使用 opencode pair --remote 從任何網路連線。" },
        "every-computer": { title: "切換電腦", body: "點一下就能切換到其他已配對的電腦。" },
        "siri-and-shortcuts": { title: "Siri 與捷徑", body: "透過 Siri 或控制中心發起通話或工作階段。" },
        "follow-along": { title: "即時掌握進度", body: "agent 工作時，時間軸會同步更新。" },
        "your-computer": { title: "你的電腦", body: "連線到你自己電腦上執行的 OpenCode。" },
        "share-sheet": { title: "分享選單", body: "不用開啟應用程式，就能將任何內容分享到工作階段。" },
        "mute-sessions": { title: "將工作階段設為靜音", body: "保留清單中的工作階段，但不再收到它的通知。" },
      },
      showcase: {
        results: { title: "結果", body: "你交代的工作完成後，通話會告訴你改了什麼。" },
        voice: { title: "語音", body: "在工作階段發起通話，說出你的需求，agent 就會用語音回答。" },
        sessions: { title: "工作階段", body: "開啟任一工作階段查看進度，從上次停下的地方繼續。" },
      },
    },
    terminal: {
      title: "OpenCode｜開源編碼 agent 的終端機介面",
      description:
        "OpenCode 的快速終端機介面，支援任何 shell、編輯器或遠端伺服器。描述需求、用 Diff 查看每項變更，再核准指令。",
      intro:
        "快速的終端機介面，支援任何 shell、編輯器或遠端伺服器。用平常說話的方式描述需求，即時查看每項變更的 Diff，再決定哪些指令可自動執行。",
      features: {
        "any-terminal": { title: "任何終端機", body: "可在任何 shell、編輯器的終端機或遠端伺服器中使用。" },
        "diffs-in-the-timeline": { title: "在時間軸查看 Diff", body: "agent 每次編輯後，都會立即在時間軸顯示 Diff。" },
        "pick-up-later": { title: "稍後繼續", body: "用 -c 繼續上一個工作階段，或用 -s 繼續任何工作階段。" },
        "one-off-runs": { title: "單次執行", body: "opencode run 傳送一則訊息並輸出回覆。" },
        "agents-and-commands": { title: "agent 與指令", body: "按 shift+tab 切換 agent，按 ctrl+p 開啟指令面板查看所有指令。" },
        "auto-approve": { title: "自動核准", body: "以 --auto 執行，即可允許所有你未拒絕的動作。" },
        "any-server": { title: "任何伺服器", body: "使用 --server 透過 URL 連線到 OpenCode 伺服器。" },
        "usage-stats": { title: "用量統計", body: "opencode stats 會顯示可分享的用量統計。" },
      },
      showcase: {
        "ask-in-plain-words": { title: "用日常語言提問", body: "輸入你的需求，agent 會在工作時展示計畫。" },
        "approve-what-runs": { title: "由你核准要執行的指令", body: "變更會以 Diff 顯示，指令要你核准後才會執行。" },
        "make-it-yours": { title: "自訂你的終端機介面", body: "用快捷鍵切換主題，可選預設、tokyonight 等多款主題。" },
        mini: { title: "Mini", body: "執行 opencode mini，回覆會直接輸出到終端機的捲動歷史。" },
      },
    },
    sdk: {
      title: "OpenCode｜適用於指令碼、CI 工作與工具的 TypeScript SDK",
      description:
        "用自己的指令碼、CI 工作或工具操作 OpenCode。具型別的 TypeScript 用戶端可建立工作階段、傳送提示詞，並即時串流每個事件。",
      intro:
        "用自己的指令碼、CI 工作或工具操作 OpenCode。SDK 在同一個處理程序內執行 OpenCode，沿用你的設定和模型。具型別的用戶端能建立工作階段、傳送提示詞，並串流每個事件。",
      features: {
        "typescript-client": { title: "TypeScript 用戶端", body: "具型別的請求和事件，與 @opencode/client 的值相同。" },
        "sessions-from-code": { title: "用程式碼建立工作階段", body: "透過任一指令碼建立工作階段並傳送提示詞。" },
        "any-model": { title: "任何模型", body: "使用你的 OpenCode 設定中的任何模型。" },
        "npm-or-bun": { title: "npm 或 bun", body: "使用 npm i @opencode/sdk 或 bun add @opencode/sdk 安裝。" },
        "in-process-host": { title: "在同一處理程序內執行", body: "在記憶體中執行 OpenCode，不必經過網路。" },
        "your-plugins": { title: "使用自訂外掛", body: "建立同一處理程序內的主機時，可傳入自己的外掛。" },
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
          body: "用一小段指令碼請 OpenCode 修正失敗的測試，再重新執行測試。",
        },
        "follow-every-step": { title: "追蹤每一步", body: "串流事件，即時查看 agent 呼叫的每個工具。" },
        "build-your-own-tools": {
          title: "打造自己的工具",
          body: "只要幾行程式碼，就能將 OpenCode 整合進機器人、儀表板和工作流程。",
        },
      },
    },
    mini: {
      title: "OpenCode Mini｜agent 的極簡終端機介面",
      description:
        "Mini 在極簡終端機介面執行 OpenCode。回覆直接輸出到終端機的捲動歷史，下方只留輸入框和一行狀態列。",
      intro:
        "OpenCode 的極簡終端機介面。執行 opencode mini，回覆會直接輸出到終端機的捲動歷史，就像其他輸出一樣能捲動、搜尋和複製。底部只留輸入框和一行狀態列。",
      features: {
        "your-scrollback": { title: "原生捲動歷史", body: "回覆會直接成為終端機歷史的一部分。" },
        "one-prompt": { title: "一個輸入框", body: "agent、模型、上下文和費用都在一行狀態列中。" },
        permissions: { title: "權限", body: "直接在輸入區核准編輯和指令。" },
        "how-much-shows": { title: "自訂顯示內容", body: "思考過程和工具輸出可選擇精簡、預設或完整顯示。" },
        "pick-up-later": { title: "稍後繼續", body: "用 -c 繼續上一個工作階段，或用 -s 繼續任何工作階段。" },
        "same-opencode": { title: "同一個 OpenCode", body: "伺服器、agent 和模型與其他應用程式相同。" },
        agents: { title: "agent", body: "直接在輸入框中切換 agent。" },
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
      body: "讓 agent 直接使用你平常用的瀏覽器。",
      title: "OpenCode Browse｜讓編碼 agent 使用你平常用的瀏覽器",
      description:
        "Browse 讓 OpenCode 和其他 MCP 用戶端使用你平常用的瀏覽器。agent 能讀取網頁、點選、輸入、擷取畫面及錄製分頁；遇到登入或雙重驗證（2FA）就交給你操作。",
      intro:
        "透過 MCP 伺服器和 Chromium 擴充功能，讓 agent 使用你平常用的瀏覽器，沿用現有的分頁、登入狀態和擴充功能。agent 會在背景開啟分頁並分組，不打擾你，還能讀取網頁、點選、輸入、擷取畫面及錄製分頁。需要登入、雙重驗證（2FA）或付款時，agent 會把分頁交給你。點選「Continue」後，它就會接著工作。",
      features: {
        "your-real-browser": {
          title: "你平常用的瀏覽器",
          body: "Chrome、Edge、Brave、Arc、Helium、Vivaldi、Opera 和 Chromium。",
        },
        "out-of-your-way": { title: "不打擾你", body: "agent 的分頁在背景開啟，並收進摺疊的群組中。" },
        handoffs: { title: "需要時由你接手", body: "自行完成登入或雙重驗證（2FA），再點選「Continue」。" },
        "lend-a-tab": { title: "借出分頁", body: "按一下工具列按鈕，把已開啟的分頁交給 agent。" },
        "record-and-capture": { title: "錄製與擷取", body: "螢幕截圖、分頁錄製和網路流量。" },
        "any-mcp-client": {
          title: "任何 MCP 用戶端",
          body: "OpenCode、Claude Code、Cursor、Codex、Zed 等眾多用戶端。",
        },
        "all-your-logins": {
          title: "沿用登入狀態",
          body: "agent 可直接使用你已登入的網站。不用金鑰，也不用設定。",
        },
        "allowed-sites": { title: "允許的網站", body: "讓 agent 的分頁只停留在你指定的網站。" },
      },
      install:
        "請先安裝 [Chrome 擴充功能]，它會引導你完成其餘步驟。如需直接安裝 CLI（通常不需要），可使用以下任一指令。",
    },
  },
  apps: {
    browse: { category: "讓 agent 操作瀏覽器", body: "讓 agent 使用你平常用的瀏覽器，沿用登入狀態和分頁。" },
    hex: { category: "語音聽寫", body: "適用於任何應用程式的裝置端語音聽寫。" },
    opentunnel: { category: "本機通道", body: "為本機應用程式提供公開的 HTTPS URL。" },
    opentui: { category: "程式庫", body: "用來打造終端機使用者介面的程式庫。" },
  },
  getStarted: {
    title: "開始使用",
    lead: "下載 OpenCode 就能用免費模型上手，不需要帳號。想用更多模型，可沿用現有訂閱，或選擇 OpenCode Go。",
    phrases: {
      "download-opencode": { text: "下載 OpenCode" },
      "free-models": { text: "免費模型" },
      "your-own-subscription": { text: "現有訂閱" },
      "a-subscription-you-already-have": { text: "已有的訂閱" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "下載", line: "可在桌面、終端機或行動裝置使用。" },
      "use-free-models": { title: "使用免費模型", line: "OpenCode 內建一組免費模型，不需要帳號。" },
      "add-more-models": {
        title: "加入更多模型",
        line: "沿用現有訂閱，或選用 OpenCode Go 的精選模型，每月 $10 起。",
      },
    },
    sentence: "下載 OpenCode，先用免費模型。想用更多模型，就沿用現有訂閱或選擇 OpenCode Go。",
  },
  byos: {
    title: "自備訂閱",
    headline: "沿用你現有的訂閱。",
    line: "用 ChatGPT Plus、ChatGPT Pro 或 GitHub Copilot 帳號登入，也可選擇 OpenCode 訂閱。",
    yours: { label: "你的訂閱", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode 訂閱", "OpenCode Go"],
    ours: { label: "OpenCode 方案" },
  },
  brand: {
    hero: { copy: { text: "給 agent 的規範", copied: "已複製規範" } },
    naming: {
      title: "命名",
      body: "OpenCode 寫成一個字，O 和 C 大寫。不要寫成 Opencode、Open Code、OpenCode AI 或 Open-Code。",
      code: "小寫的 `opencode` 只用於程式碼和套件名稱，例如 `opencode-figma` 或 `@acme/opencode-plugin`。",
    },
    families: {
      logo: {
        title: "Logo",
        body: "單獨的 Logo 適合放在應用程式圖示、大頭貼等空間有限的位置。方形版本留有內距，適用於會裁成方形的版面。",
        assets: {
          light: { name: "淺色" },
          dark: { name: "深色" },
          "square-light": { name: "方形淺色版" },
          "square-dark": { name: "方形深色版" },
        },
      },
      wordmark: {
        title: "字標",
        body: "以 OpenCode 專屬字形呈現完整名稱。版面放得下全名時，就使用字標。",
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
      body: "適用於 Slack、Discord、GitHub 等個人檔案的 1024 px 方形大頭貼。背景填滿整個方形，Logo 則留在內部的圓形範圍內，裁成圓形也能完整顯示。",
      items: { dark: { name: "深色" }, light: { name: "淺色" } },
    },
    colors: {
      title: "色彩",
      body: "Logo 和字標使用同一種墨色的三種不透明度，深色背景則使用較淺的墨色。下方數值是標準檔案中的色彩。這些色彩僅用於 Logo 和字標，請勿用於其他文字或背景。點一下數值即可複製。",
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
      title: "標誌版本",
      body: "選擇能讓 Logo 在背景上清楚顯示的版本，淺色背景用深色版，深色背景用淺色版。Logo 和字標是不同的檔案，兩者擇一使用。",
      groups: {
        default: {
          name: "預設",
          body: "這個 Logo 適用於大多數情境。內部陰影採透明設計，在黑白背景上看起來與雙灰階版本完全相同；在照片、漸層或彩色底上則會透出背景。",
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
      title: "使用規範",
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
        body: "Logo 的比例固定為 4:5，1 筆畫是其寬度的四分之一。縮放時，每次將寬度調整 4 px、高度調整 5 px，讓每條邊和每個筆畫都對齊整數像素。",
        do: "讓每條邊和 4 px 的筆畫都對齊整數像素。",
        dont: "偏離 4:5 比例會讓邊緣無法對齊像素，造成模糊。",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "字標" } },
      },
      minimumTitle: "最小尺寸",
      minimum: {
        logo: { title: "Logo", body: "至少 16 × 20 px，筆畫粗細為 4 px。再小就會模糊。" },
        wordmark: { title: "字標", body: "至少 117 × 21 px，筆畫粗細為 3 px。再小就會模糊。" },
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
        "low-contrast": { caption: "把灰色標誌放在對比不足的灰底上。" },
        color: { caption: "把雙灰階 Logo 放在彩色底上，灰色會變得混濁。" },
      },
    },
    integrations: {
      title: "整合",
      body: "如果你的外掛、供應商或工具支援 OpenCode，或你的專案是用 OpenCode 打造的，都可以用徽章或合作夥伴組合標誌來註明。命名時請清楚表明專案是你自己的。",
      badges: {
        body: "在 README、文件或網站中放上徽章，並連結到 opencode.ai。依背景選擇淺色或深色檔案（HTML 會自動切換），不要更改顏色或文字。",
        sizes: "各樣式都有 20、32 和 44 px 可選（Shields 僅有 20 px），提供 SVG 與 2 倍解析度的 PNG。",
        mono: "每個檔案都有 OpenMono 字型版本。在副檔名前加上 -mono，例如 opencode-works-with-a-light-20-mono.svg；要使用全大寫的 OpenMono，則加上 -mono-caps。",
        groups: {
          "works-with": { title: "相容", alt: "相容 OpenCode", body: "適用於搭配 OpenCode 執行的外掛、供應商和工具。" },
          "built-with": { title: "以此打造", alt: "以 OpenCode 打造", body: "適用於用 OpenCode 製作的專案。" },
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
    title: "OpenCode｜公司資訊與品牌素材的媒體資料包",
    description:
      "OpenCode 媒體資料包收錄 OpenCode 與開發公司 Anomaly 的資訊、可下載的 Logo 和字標，以及媒體聯絡方式。",
    hero: { title: "媒體", body: "報導 OpenCode 和 Anomaly 所需的資訊、品牌素材和聯絡方式。" },
    company: {
      title: "關於 Anomaly",
      lead: "Anomaly 是開發 OpenCode 的公司，專為開發者打造開源工具。",
      more: "其他專案包括 SST 和 OpenTUI，全部在 [GitHub](github) 上開源。",
      learnMore: "想了解更多，請前往 [anoma.ly](site)。",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "開源編碼 agent，提供桌面、終端機及行動應用程式，以及 SDK。採用 MIT 授權，在 GitHub 獲得逾 220,000 顆星。",
        },
        sst: {
          name: "SST",
          body: "在自有基礎架構上打造全端應用程式的框架。自 2020 年起開源，採用 MIT 授權，在 GitHub 獲得逾 26,000 顆星。",
        },
        opentui: {
          name: "OpenTUI",
          body: "用 TypeScript、React 或 Solid 打造終端機介面的程式庫，核心以 Zig 撰寫。OpenCode 已在正式環境中採用，在 GitHub 獲得逾 13,000 顆星。",
        },
        "models-dev": {
          name: "Models.dev",
          body: "收錄 AI 模型規格、價格與功能的開源資料庫，提供公開 API。涵蓋 200 多家供應商、8,900 多個模型。",
        },
        hex: {
          name: "Hex",
          body: "適用於 Mac、Windows 和 Linux 的語音聽寫工具。Hex 在裝置上將語音轉成文字，再貼到任何應用程式，音訊全程不離開裝置。",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "透過 CLI 和 SDK 為本機應用程式提供公開的 HTTPS URL。TLS 連線終止於你的電腦，中繼伺服器接觸不到明文。",
        },
      },
    },
    about: {
      title: "關於 OpenCode",
      body: "OpenCode 及其產品的介紹，有長短兩個版本，可直接複製。",
      boilerplate: {
        long: "OpenCode 是開源編碼 agent，提供桌面應用程式、終端機介面、行動應用程式和 SDK，支援所有供應商的模型，包括 Claude、GPT 和 Gemini。OpenCode 由 Anomaly 開發，採用 MIT 授權。已在 GitHub 獲得超過 220,000 顆星，有 1,000 多位貢獻者，每月有超過 2,200 萬位開發者使用。",
        short: "OpenCode 是 Anomaly 推出的開源編碼 agent，提供桌面、終端機和行動應用程式以及 SDK。",
      },
      products: {
        "opencode-console": {
          name: "OpenCode 控制台",
          long: "OpenCode 控制台是網頁應用程式，供開發者和團隊購買並管理 OpenCode 與其他編碼 agent 的 AI 模型存取權。頂尖模型與開放權重模型的推論服務按用量計費，每次請求從預付額度扣款，也可選擇 OpenCode Go 訂閱。團隊可在工作區指派成員、管理員和擁有者角色，並為工作區或個別使用者設定消費上限。支援透過 Okta、Microsoft Entra ID 或 Google Workspace 單一登入，也支援 SCIM。控制台支援 30 多家供應商，團隊可連接現有的供應商帳號，不必改用 OpenCode 的推論。網址為 opencode.ai/console。",
          short:
            "OpenCode 控制台是 Anomaly 的網頁應用程式，提供按用量計費的 AI 模型、OpenCode Go 訂閱，以及預算和單一登入等團隊管理功能。",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go 讓開發者以固定月費使用編碼模型。Go 每月 $10；Go Plus 額度更高，每月 $40；Go Teams 每位成員每月 $20。無論選哪個方案，都能使用經過編碼 agent 實測的精選模型。各模型都有以金額計算的每月用量上限，另有按滾動時段計算的 5 小時和每週額度，分別為每月上限的 20% 和 50%。訂閱者可以儲值，用完方案額度後改從餘額按用量扣款，也可隨時取消。Go 可搭配 OpenCode 及其他 agent 使用。網址為 opencode.ai/console/go。",
          short: "OpenCode Go 是 Anomaly 推出的月費方案，讓開發者每月都有額度可使用精選編碼模型，每月 $10 起。",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data 是公開儀表板，呈現開發者在 OpenCode 使用哪些 AI 模型，以及各模型用量如何隨時間變動。資料包括熱門模型排行榜、token 用量、工作階段與 token 成本、快取比率、市占率和各國統計。資料每小時彙整，每天和每週的區間以 UTC 為準。使用者數和工作階段數為估計值，成本依 OpenCode 模型目錄的定價計算。媒體引用時可註明 OpenCode Data（opencode.ai/data）及頁面顯示的更新時間。",
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
        "desktop-app-ships": { date: "2025 年 12 月", text: "推出 Desktop" },
        "10-million-downloads": { date: "2026 年 1 月", text: "下載次數突破 1,000 萬" },
        "opencode-2-0": { date: "2026 年 9 月", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "2026 年 11 月", text: "GitHub 星數突破 220,000" },
      },
    },
    news: {
      title: "最新版本",
      intro: "OpenCode 經常更新。這裡收錄近期推出新功能的版本。",
      changelog: { text: "完整變更記錄" },
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
            "feature-1": { title: "多個 agent 同時工作" },
            "feature-2": { title: "在瀏覽器查看變更" },
            "feature-3": { title: "跨裝置接力" },
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
            "feature-2": { title: "工作階段" },
            "feature-3": { title: "結果" },
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
            "feature-2": { title: "由你核准要執行的指令" },
            "feature-3": { title: "自訂你的終端機介面" },
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
      avatars: {
        body: "方形大頭貼，適用於 X、GitHub、Slack、LinkedIn 等個人檔案。標誌位於圓形範圍內，即使被裁成圓形也能完整顯示。PNG 寬 1024 px 和 400 px。",
        items: {
          "avatar-dark": { name: "大頭貼，深色" },
          "avatar-light": { name: "大頭貼，淺色" },
        },
      },
      all: { text: "全部下載" },
    },
    coverage: { title: "媒體報導" },
    brand: {
      title: "品牌",
      before: "一次下載 OpenCode 的 Logo 和字標，全部收在同一個 ZIP 檔案。個別檔案、其他版本及使用規範請見",
      link: { text: "品牌頁面" },
      after: "。",
      usage: "你可以在報導 OpenCode 時使用這些檔案。請勿修改它們，也不要暗示 OpenCode 為你的作品背書。",
    },
    product: {
      title: "產品",
      items: {
        desktop: {
          name: "Desktop",
          body: "在 macOS、Windows 和 Linux 上同時執行多個 agent，每個各有一個分頁。透過 Diff 審查並預覽每項變更。",
        },
        mobile: {
          name: "Mobile",
          body: "最新的 OpenCode 應用程式。在工作階段發起通話與 agent 對話，再隨時隨地用手機審查及核准變更。",
        },
        terminal: {
          name: "Terminal",
          body: "支援任何 shell、編輯器或遠端伺服器的終端機介面。透過 Diff 查看每項變更，再決定哪些指令可自動執行。",
        },
        sdk: {
          name: "SDK",
          body: "適用於指令碼、CI 工作和自訂工具的具型別 TypeScript 用戶端。可建立工作階段、傳送提示詞，並即時串流每個事件。",
        },
      },
    },
    contact: {
      title: "聯絡方式",
      items: {
        press: { title: "媒體", body: "供記者和分析師聯絡。我們只回覆媒體詢問。" },
        support: {
          links: { "github-issues": { text: "GitHub Issues" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "支援",
          body: "使用 OpenCode 時需要協助，可開 issue 或到社群提問。帳號或帳單問題請寄信給我們。",
        },
        security: {
          links: { "report-a-vulnerability": { text: "回報漏洞" }, "security-anoma-ly": { text: "security@anoma.ly" } },
          title: "安全性",
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
    mini: {
      commands: { curl: { name: "指令碼" } },
      lead: "Mini 隨 OpenCode CLI 一起提供。用以下任一方式安裝，然後執行 opencode mini。",
    },
  },
  pair: {
    title: "連接手機",
    cardTitle: "一行指令配對手機",
    intro:
      "用 OpenCode Mobile 遠端操作電腦上的 OpenCode。工作階段仍在電腦上執行，你可以用手機查看進度並調整方向。",
    steps: {
      "get-the-app": {
        title: "取得應用程式",
        body: "在 iPhone 上透過 TestFlight 安裝 OpenCode 測試版，或在 Android 手機上安裝 OpenCode 應用程式。",
      },
      "run-this-on-your-computer": {
        title: "在電腦上執行",
        body: "指令會產生一次性連結和 QR 碼，兩者都只能使用一次，5 分鐘後失效。",
      },
      "scan-the-code": {
        title: "掃描 QR 碼",
        body: "用應用程式掃描 QR 碼，或貼上連結。電腦上最近的工作階段就會在手機上開啟。",
      },
    },
    note: "--remote 透過 OpenTunnel 位址連線，因此可在任何網路中使用。在同一個 Wi-Fi 下，先執行一次 opencode service set hostname 0.0.0.0，再執行 opencode pair。",
    facts: [
      "--remote 透過 OpenTunnel 位址連線，因此在任何網路上都能配對。",
      "連結和 QR 碼只能使用一次，5 分鐘後失效。",
      "請讓電腦保持開機，agent 在電腦上執行，而不是在手機上。",
      "如果在同一個 Wi-Fi 下，先執行一次 opencode service set hostname 0.0.0.0，再執行 opencode pair。",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": { text: "建立、安裝和分享桌面外掛。", link: "查看 2.2 的新功能" },
    "desktop-terminals-now-survive-restarts": { text: "Desktop 的終端機在重新啟動後也會保留。", link: "查看 v2.2.4" },
    "agents-can-now-generate-images": { text: "agent 現在可以產生圖片了。", link: "查看 v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "用手機調整工作階段的方向。", link: "認識 OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "Desktop 改版登場。", link: "查看 2.2 的新功能" },
  },
} satisfies ContentOverlay
