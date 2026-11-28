import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "セッション、タブ、差分、内蔵ブラウザ、拡張機能。macOS、Windows、Linux に対応。",
      action: "ダウンロード",
    },
    mobile: {
      name: "Mobile",
      body: "外出先でも、スマートフォンからセッションを始め、指示を出し、変更を承認できます。",
      action: "ダウンロード",
    },
    terminal: {
      name: "Terminal",
      body: "どのシェル、エディター、リモートサーバーでも動く高速なターミナル UI。",
      action: "インストール",
    },
    sdk: {
      name: "SDK",
      body: "スクリプト、CI ジョブ、独自のツールから OpenCode を操作できます。",
      action: "ドキュメントを読む",
    },
    mini: {
      name: "Mini",
      body: "必要最小限のターミナル UI。返答はスクロールバックに流れ、画面下部には入力欄が 1 つだけ。",
      action: "インストール",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | macOS、Windows、Linux 向けデスクトップアプリ",
      description:
        "OpenCode のエージェントを好きなだけ並行実行。すべての変更を隣のブラウザで確認でき、どのデバイスでも続きから再開できます。macOS、Windows、Linux に対応。",
      intro:
        "セッションごとにタブを開き、複数のエージェントを同時に実行できます。すべての変更を差分で確認し、どの行にもコメントでき、結果は内蔵ブラウザで確認できます。macOS、Windows、Linux に対応。",
      showcase: {
        "parallel-agents": {
          title: "エージェントを並行実行",
          body: "エージェントを好きなだけ起動して、同時に作業を進められます。終わったものから切り替えて確認できます。",
        },
        "see-it-in-the-browser": {
          title: "ブラウザで確認",
          body: "エージェントの隣で開発中のアプリをブラウザ表示。反映された変更を、エージェントと一緒にその場で確認できます。",
        },
        "on-every-device": {
          title: "どのデバイスからでも",
          body: "どのデバイスからでもエージェントを起動。デスクトップアプリ、ターミナル、スマートフォンで作業を再開できます。",
        },
        "extend-it": {
          title: "自分仕様に拡張",
          body: "ツールやサービスを接続して、エージェントにできることを広げましょう。OpenCode にプラグインを作らせ、その専用 UI をサイドバーに表示することもできます。",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile でコーディングセッションを手のひらに",
      description:
        "スマートフォンから OpenCode のセッションを始めて、指示を出せます。手元のコンピューターで作業するエージェントと、そのまま話せます。",
      intro:
        "どこからでも、スマートフォンでセッションを始めて指示を出せます。セッションを開いて作業を再開したり、通話でエージェントと話したり。OpenCode はすべて自分のコンピューター上で動きます。",
      features: {
        "notify-when-done": { title: "完了を通知", body: "開始したセッションが終わると、短い要約が届きます。" },
        "pair-from-anywhere": {
          title: "どこからでも接続",
          body: "opencode pair --remote で、どのネットワークからでも接続できます。",
        },
        "every-computer": { title: "すべてのPC", body: "ペアリングしたコンピューターをワンタップで切り替えられます。" },
        "siri-and-shortcuts": {
          title: "Siriとショートカット",
          body: "Siriやコントロールセンターから通話やセッションを開始できます。",
        },
        "follow-along": { title: "進捗を追う", body: "エージェントの作業に合わせてタイムラインが更新されます。" },
        "your-computer": { title: "自分のPC", body: "自分のマシンで動くOpenCodeに接続します。" },
        "share-sheet": { title: "共有シート", body: "アプリを開かずに、何でもセッションに共有できます。" },
        "mute-sessions": { title: "ミュート", body: "通知を受け取らずに、セッションをリストに残せます。" },
      },
      showcase: {
        voice: { title: "音声", body: "通話を始めて、頼みたいことを話すだけ。エージェントが声で答えます。" },
        sessions: { title: "セッション", body: "セッションを開いて進捗を確認し、その場で作業を再開できます。" },
        results: { title: "結果", body: "依頼した作業が終わると、何が変わったかを通話で知らせてくれます。" },
      },
    },
    terminal: {
      title: "OpenCode | オープンソースのコーディングエージェントをターミナルで",
      description:
        "どのシェル、エディター、リモートサーバーでも動く、OpenCode の高速なターミナル UI。やりたいことを伝え、変更を差分で確認し、コマンドの実行を承認できます。",
      intro:
        "どのシェル、エディター、リモートサーバーでも動く高速なターミナル UI。普段の言葉で依頼すると、編集のたびに差分を確認できます。どのコマンドを自動実行するかも選べます。",
      features: {
        "any-terminal": {
          title: "ターミナルを選ばない",
          body: "どのシェルでも、エディターのターミナルでも、リモートサーバーでも動きます。",
        },
        "diffs-in-the-timeline": {
          title: "タイムラインに差分",
          body: "エージェントが編集するたびに、タイムラインで差分を確認できます。",
        },
        "pick-up-later": {
          title: "後から再開",
          body: "-c で前回のセッションを、-s で任意のセッションを再開できます。",
        },
        "one-off-runs": { title: "単発で実行", body: "opencode run でメッセージを 1 件送り、返答を出力できます。" },
        "agents-and-commands": {
          title: "エージェントとコマンド",
          body: "shift+tab でエージェントを切り替え、ctrl+p ですべてのコマンドを開けます。",
        },
        "auto-approve": {
          title: "自動承認",
          body: "--auto を付けて実行すると、拒否していないすべての操作を許可します。",
        },
        "any-server": { title: "任意のサーバー", body: "--server で URL を指定して OpenCode サーバーに接続できます。" },
        "usage-stats": { title: "使用量の統計", body: "opencode stats で、共有可能な使用量の統計を表示できます。" },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "普段の言葉で依頼",
          body: "やりたいことを入力すると、エージェントが作業しながら計画を示します。",
        },
        "approve-what-runs": {
          title: "実行内容を承認",
          body: "変更は差分で確認でき、コマンドは承認してから実行されます。",
        },
        "make-it-yours": {
          title: "自分好みに",
          body: "デフォルトや tokyonight など、キー 1 つでテーマを切り替えられます。",
        },
        mini: { title: "Mini", body: "opencode mini を実行すると、返答がターミナルのスクロールバックに出力されます。" },
      },
    },
    sdk: {
      title: "OpenCode | スクリプト、CI ジョブ、ツール向けの TypeScript SDK",
      description:
        "スクリプト、CI ジョブ、独自のツールから OpenCode を操作できます。型付き TypeScript クライアントでセッションを作成し、プロンプトを送り、すべてのイベントをリアルタイムに受け取れます。",
      intro:
        "スクリプト、CI ジョブ、独自のツールから OpenCode を操作できます。SDK はお使いの設定とモデルで OpenCode をプロセス内で実行します。型付きクライアントでセッションを作成し、プロンプトを送り、すべてのイベントをストリーミングで受け取れます。",
      features: {
        "typescript-client": {
          title: "TypeScript クライアント",
          body: "型付きのリクエストとイベント。@opencode/client と同じ値を使います。",
        },
        "sessions-from-code": {
          title: "コードからセッションを作成",
          body: "どのスクリプトからでもセッションを作成し、プロンプトを送れます。",
        },
        "any-model": { title: "任意のモデル", body: "OpenCode の設定にあるモデルをそのまま使います。" },
        "npm-or-bun": {
          title: "npm または Bun",
          body: "npm i @opencode/sdk または bun add @opencode/sdk でインストールできます。",
        },
        "in-process-host": {
          title: "インプロセスホスト",
          body: "ネットワークを介さず、メモリ内で OpenCode を実行します。",
        },
        "your-plugins": {
          title: "自分のプラグイン",
          body: "インプロセスホストの作成時に、独自のプラグインを渡せます。",
        },
        "promise-or-effect": { title: "Promise または Effect", body: "Promise API と Effect API は同じ値を返します。" },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Workers 上の Cloudflare Durable Object 内で OpenCode を実行できます。",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "コードで CI を修正",
          body: "短いスクリプトで、失敗したテストを OpenCode に修正させ、再実行できます。",
        },
        "follow-every-step": {
          title: "すべてのステップを追う",
          body: "イベントをストリーミングで受け取り、エージェントがどのツールを呼び出したかをリアルタイムで確認できます。",
        },
        "build-your-own-tools": {
          title: "独自のツールを作る",
          body: "数行のコードで、ボット、ダッシュボード、ワークフローに OpenCode を組み込めます。",
        },
        "in-your-process": {
          title: "プロセス内で実行",
          body: "お使いの設定とモデルで、OpenCode をプロセス内で実行します。",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini、エージェントのための最小限のターミナル UI",
      description:
        "Mini は、必要最小限のターミナル UI で OpenCode を実行します。返答はターミナルのスクロールバックに出力され、画面下部には入力欄とステータス行だけが残ります。",
      intro:
        "OpenCode のための必要最小限のターミナル UI。opencode mini を実行すると、返答はターミナルのスクロールバックに直接出力されます。通常の出力と同じようにスクロール、検索、コピーでき、画面下部には入力欄とステータス行だけが残ります。",
      features: {
        "your-scrollback": { title: "スクロールバック", body: "返答は通常のターミナル履歴になります。" },
        "one-prompt": {
          title: "入力欄はひとつだけ",
          body: "エージェント、モデル、コンテキスト、コストを 1 行で表示します。",
        },
        permissions: { title: "権限", body: "入力欄から編集やコマンドの実行を許可できます。" },
        "how-much-shows": {
          title: "表示量を調整",
          body: "推論とツール出力の表示量を、控えめ、デフォルト、すべてから選べます。",
        },
        "pick-up-later": {
          title: "後から再開",
          body: "-c で前回のセッションを、-s で任意のセッションを再開できます。",
        },
        "same-opencode": { title: "いつもの OpenCode", body: "ほかのアプリと同じサーバー、エージェント、モデルが使えます。" },
        agents: { title: "エージェント", body: "入力欄から直接エージェントを切り替えられます。" },
        compact: { title: "コンパクション", body: "/compact で長いセッションを圧縮できます。" },
      },
    },
  },
  extensionCard: {
    name: "拡張機能",
    body: "OpenCode を VS Code で。Zed などのエディターでも ACP 経由で使えます。",
    action: "インストール",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "エージェントが普段のブラウザを使えます。",
      title: "OpenCode | Browse でいつものブラウザをコーディングエージェントに",
      description:
        "Browse を使えば、OpenCode などの MCP クライアントから普段のブラウザを操作できます。エージェントがページの読み取り、クリック、入力、スクリーンショット撮影、タブの録画を行い、サインインや 2FA が必要なときは操作を引き継げます。",
      intro:
        "MCP サーバーと Chromium 拡張機能を通じて、エージェントが普段のブラウザを、タブもサインイン状態も拡張機能もそのまま使えます。エージェントはタブをバックグラウンドで開いてグループにまとめるので、作業の邪魔になりません。ページを読み取り、クリックや入力を行い、スクリーンショットを撮ったり、タブを録画したりできます。サインインや 2FA、支払いが必要なときは自分でタブを操作し、「Continue」をクリックするとエージェントが作業を再開します。",
      features: {
        "your-real-browser": {
          title: "普段のブラウザ",
          body: "Chrome、Edge、Brave、Arc、Helium、Vivaldi、Opera、Chromium。",
        },
        "out-of-your-way": {
          title: "邪魔にならない",
          body: "エージェントのタブはバックグラウンドで開き、折りたたんだグループにまとまります。",
        },
        handoffs: { title: "操作を引き継ぐ", body: "サインインや 2FA は自分で行い、終わったら「Continue」をクリックします。" },
        "lend-a-tab": {
          title: "タブを貸す",
          body: "ツールバーのボタンをクリックして、開いているタブをエージェントに渡せます。",
        },
        "record-and-capture": {
          title: "録画と記録",
          body: "スクリーンショット、タブの録画、ネットワーク通信。",
        },
        "any-mcp-client": { title: "MCP クライアントを選ばない", body: "OpenCode、Claude Code、Cursor、Codex、Zed などに対応。" },
        "all-your-logins": {
          title: "サインイン状態をそのままに",
          body: "エージェントはサインイン済みのサイトをそのまま使えます。キーも設定も不要です。",
        },
        "allowed-sites": { title: "アクセス先の制限", body: "エージェントがタブで開けるサイトを指定できます。" },
      },
      install:
        "まず [Chrome 拡張機能] をインストールしてください。続きは拡張機能の案内に従ってください。CLI を直接インストールする場合（通常は不要）は、次のいずれかの方法を使います。",
    },
  },
  apps: {
    browse: {
      category: "エージェント向けブラウザ操作",
      body: "サインイン状態もタブもそのまま。エージェントがいつものブラウザを使えます。",
    },
    opentunnel: { category: "ローカルトンネル", body: "ローカルアプリに公開 HTTPS URL を。" },
    opentui: { category: "ライブラリ", body: "ターミナル UI のためのライブラリ。" },
    hex: { category: "音声入力", body: "どのアプリでも使える、端末内で完結する音声入力。" },
  },
  getStarted: {
    title: "はじめる",
    lead: "OpenCode をダウンロードして無料モデルを使うのが、いちばん簡単です。アカウントは不要。さらに多くのモデルを使うなら、お使いのサブスクリプションか OpenCode Go を利用できます。",
    phrases: {
      "download-opencode": { text: "OpenCode をダウンロード" },
      "free-models": { text: "無料モデル" },
      "your-own-subscription": { text: "お使いのサブスクリプション" },
      "a-subscription-you-already-have": { text: "すでにお持ちのサブスクリプション" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "ダウンロード", line: "デスクトップ、ターミナル、モバイル。" },
      "use-free-models": {
        title: "無料モデルを使う",
        line: "OpenCode には、アカウントなしで使える無料モデルがあります。",
      },
      "add-more-models": {
        title: "モデルを追加",
        line: "お使いのサブスクリプションを利用するか、月額 $10 からの OpenCode Go で厳選モデルを使えます。",
      },
    },
    sentence:
      "OpenCode をダウンロードして、まずは無料モデルから。さらに使いたいときは、お使いのサブスクリプションか OpenCode Go を利用できます。",
  },
  byos: {
    title: "いつものサブスクリプションで",
    headline: "すでにお持ちのサブスクリプションを使えます。",
    line: "ChatGPT Plus または Pro、GitHub Copilot でサインインできます。OpenCode のサブスクリプションも使えます。",
    yours: { label: "お使いのサブスクリプション", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode のサブスクリプション", "OpenCode Go"],
    ours: { label: "OpenCode のプラン" },
  },
  brand: {
    hero: { copy: { text: "エージェント用ルール", copied: "ルールをコピーしました" } },
    naming: {
      title: "表記",
      body: "OpenCode は、O と C を大文字にして 1 語で書きます。Opencode、Open Code、OpenCode AI、Open-Code とは書きません。",
      code: "小文字の `opencode` は、`opencode-figma` や `@acme/opencode-plugin` のように、コードとパッケージ名でのみ使います。",
    },
    families: {
      logo: {
        title: "ロゴ",
        body: "ロゴ単体。アプリアイコン、アバターなどの小さなスペース向けです。正方形版は、正方形に切り抜かれる場所のために余白を加えています。",
        assets: {
          light: { name: "ライト" },
          dark: { name: "ダーク" },
          "square-light": { name: "正方形、ライト" },
          "square-dark": { name: "正方形、ダーク" },
        },
      },
      wordmark: {
        title: "ワードマーク",
        body: "OpenCode の正式名称を専用の字形で表したものです。名称をすべて表示できるスペースがある場所で使います。",
        assets: { light: { name: "ライト" }, dark: { name: "ダーク" } },
      },
      "simple-wordmark": {
        title: "シンプルなワードマーク",
        body: "ワードマークの単色版。印刷、刺しゅう、1色しか使えない場所向けです。",
        assets: { light: { name: "ライト" }, dark: { name: "ダーク" } },
      },
    },
    icons: {
      title: "アバター",
      body: "Slack、Discord、GitHubなどのプロフィール用の1024pxの正方形アバター。背景が正方形全体を埋め、ロゴは円の内側に十分収まっているので、丸く切り抜いても問題ありません。",
      items: { dark: { name: "ダーク" }, light: { name: "ライト" } },
    },
    colors: {
      title: "カラー",
      body: "ロゴとワードマークは1つのインクを3段階の不透明度で使い、暗い背景にはより明るいインクを使います。下の値は標準ファイルの色です。これらはロゴとワードマークだけに使用し、ほかのテキストや背景には使用しないでください。値をクリックするとコピーできます。",
      palettes: {
        light: {
          name: "ライト",
          swatches: {
            ink: { name: "インク", use: "ロゴの輪郭と「code」の文字。" },
            "ink-70": { name: "インク 70%", use: "「open」の文字。", ink: "不透明度70%のインク。" },
            "ink-20": { name: "インク 20%", use: "ロゴの内側の陰影。", ink: "不透明度20%のインク。" },
          },
        },
        dark: {
          name: "ダーク",
          swatches: {
            ink: { name: "インク", use: "ロゴの輪郭と「code」の文字。" },
            "ink-72": { name: "インク 72%", use: "「open」の文字。", ink: "不透明度72%のインク。" },
            "ink-28": { name: "インク 28%", use: "ロゴの内側の陰影。", ink: "不透明度28%のインク。" },
          },
        },
      },
    },
    variants: {
      title: "バリエーション",
      body: "背景に対してロゴがはっきり見えるものを選んでください。明るい背景にはダーク、暗い背景にはライトを使います。ロゴとワードマークは別のファイルなので、どちらか一方を使います。",
      groups: {
        default: {
          name: "デフォルト",
          body: "ほぼすべての場所で使うロゴです。内側の陰影は透明なので、白や黒の上では2トーンのグレーとまったく同じに見え、写真、グラデーション、色の上では背景が透けて見えます。",
          rows: {
            logo: { title: "ロゴ", tiles: { dark: { name: "ダーク" }, light: { name: "ライト" } } },
            wordmark: { title: "ワードマーク", tiles: { dark: { name: "ダーク" }, light: { name: "ライト" } } },
          },
        },
        simple: {
          name: "シンプル",
          body: "単色で、カウンターが開いており、内側の陰影はありません。単色の背景、1色印刷、グレーを使えない場所で使います。明るい色にはシンプルのダーク、暗い色にはシンプルのライトを使います。",
          rows: { wordmark: { title: "ワードマーク", tiles: { dark: { name: "ダーク" }, light: { name: "ライト" } } } },
        },
      },
    },
    usage: {
      title: "使い方",
      body: "明るい背景にはライト版、暗い背景にはダーク版を使います。ロゴとワードマークは別のものなので、どちらか一方を使い、両方を一緒に使わないでください。",
      stroke: {
        title: "1ストローク",
        body: "このページの余白のルールはストロークで測ります。1ストロークはロゴの輪郭の太さで、ロゴの幅の4分の1です。つまりロゴは幅4ストローク、高さ5ストロークです。",
      },
      clearSpace: {
        title: "余白",
        body: "ロゴとワードマークの四辺すべてに、少なくとも2ストローク分の余白をとります。ロゴでは1ストロークは輪郭の太さで幅の4分の1、ワードマークでは文字の太さで高さの7分の1です。",
      },
      pixels: {
        title: "整数ピクセル",
        body: "ロゴの縦横比は4:5に固定され、1ストロークは幅の4分の1です。4 × 5pxの刻みで拡大縮小すれば、すべての辺とストロークが整数ピクセルにそろいます。",
        do: "すべての辺と4pxのストロークを整数ピクセルにそろえる。",
        dont: "ロゴを4:5以外の比率にする。辺がピクセルの間にずれてぼやけます。",
        sizes: { logo: { title: "ロゴ" }, wordmark: { title: "ワードマーク" } },
      },
      minimumTitle: "最小サイズ",
      minimum: {
        logo: { title: "ロゴ", body: "16 × 20px以上、ストロークは4px。これより小さいとぼやけます。" },
        wordmark: { title: "ワードマーク", body: "117 × 21px以上、ストロークは3px。これより小さいとぼやけます。" },
      },
    },
    donts: {
      title: "禁止事項",
      body: "ロゴとワードマークを使うときに避けたい、よくある間違いです。",
      examples: {
        "two-tone": { caption: "ロゴを新しい色に塗り替える。" },
        bright: { caption: "明るい単色にする。" },
        gradient: { caption: "ロゴをグラデーションで塗る。" },
        inverted: { caption: "トーンを入れ替える。" },
        stretch: { caption: "ロゴを引き伸ばしたり、つぶしたりする。" },
        shadow: { caption: "ドロップシャドウを付ける。" },
        glow: { caption: "光彩やアウトラインを付ける。" },
        lockup: { caption: "ロゴの横にほかの言葉を置く。" },
        "low-contrast": { caption: "グレーの上にグレーを置き、コントラストを下げる。" },
        color: { caption: "グレー2トーンのロゴを色付きの背景に置く。グレーがくすんで見えます。" },
      },
    },
    integrations: {
      title: "連携",
      body: "OpenCode と連携するプラグイン、プロバイダー、ツールや、OpenCode を使って作ったプロジェクトは、OpenCode との関係を表示できます。バッジまたはパートナーロックアップを使い、独自のプロジェクトだとわかる名前を付けてください。",
      badges: {
        body: "README、ドキュメント、Web サイトにバッジを掲載し、opencode.ai にリンクしてください。背景に合わせてライト版かダーク版を選びます（HTML 版は自動で切り替わります）。色やテキストは変更しないでください。",
        sizes: "各スタイルに 20、32、44px のサイズがあり（Shields は 20px のみ）、SVG と 2 倍サイズの PNG を用意しています。",
        mono: "各ファイルには、文字に OpenMono を使った版もあります。opencode-works-with-a-light-20-mono.svg のように拡張子の直前に -mono を付けると通常版、-mono-caps を付けると大文字版になります。",
        groups: {
          "works-with": {
            title: "Works with",
            alt: "Works with OpenCode",
            body: "OpenCode と連携するプラグイン、プロバイダー、ツール向け。",
          },
          "built-with": { title: "Built with", alt: "Built with OpenCode", body: "OpenCode で作ったプロジェクト向け。" },
        },
        styles: { a: { name: "フレーム" }, c: { name: "セル" }, f: { name: "ソリッド" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "パートナーロックアップ",
        body: "OpenCodeのロゴとパートナーのロゴを、間に×を挟んで横に並べます。×の両側に3ストローク分の余白をとり、パートナーのロゴはOpenCodeのロゴと同じ高さに見えるように調整し、ロックアップ全体のまわりに余白を確保してください。",
        partners: { github: { name: "GitHub" } },
      },
      naming: {
        title: "プロジェクトの名前",
        body: "独自のプロジェクトだとわかるよう、プロジェクト名を先に記載してください。",
        rule: "`Linear for OpenCode` と書くか、パッケージ名を `opencode-linear` にします。`OpenCode Linear` や `Linear by OpenCode` とは書きません。",
      },
    },
    trademarks: {
      title: "商標",
      body: "OpenCodeとOpenCodeのロゴはAnomalyの商標です。Anomalyがあなたを推奨または支援していると受け取られる使い方、製品名や会社名への使用、許可のない商品への使用はしないでください。",
      contact: { before: "ご質問は", after: "までメールでお送りください。" },
    },
  },
  press: {
    title: "OpenCode | プレスキット、企業情報とブランド素材",
    description:
      "OpenCode のプレスキットです。OpenCode と開発元の Anomaly に関する情報、ロゴとワードマークのダウンロード、報道関係のお問い合わせ先をまとめています。",
    hero: { title: "プレス", body: "OpenCode と Anomaly の取材・執筆に役立つ企業情報、ブランド素材、お問い合わせ先。" },
    company: {
      title: "Anomaly について",
      lead: "OpenCode を開発する Anomaly は、開発者向けのオープンソースツールを作っています。",
      more: "SST や OpenTUI なども手がけ、すべて [GitHub](github) でオープンソースとして公開しています。",
      learnMore: "詳しくは[anoma.ly](site)をご覧ください。",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "オープンソースのコーディングエージェント。デスクトップ、ターミナル、モバイル向けアプリと SDK を提供。MIT ライセンスで、GitHub スターは 220,000 以上。",
        },
        sst: {
          name: "SST",
          body: "自前のインフラにフルスタックアプリを構築するためのフレームワーク。2020年から MIT ライセンスで公開。GitHub スターは 26,000 以上。",
        },
        opentui: {
          name: "OpenTUI",
          body: "TypeScript、React、Solid でターミナル UI を作るためのライブラリ。コアは Zig 製で、OpenCode が本番環境で使用。GitHub スターは 13,000 以上。",
        },
        "models-dev": {
          name: "Models.dev",
          body: "AI モデルの仕様、価格、機能をまとめたオープンソースのデータベース。公開 API を備え、200 以上のプロバイダーから 8,900 以上のモデルを掲載しています。",
        },
        hex: {
          name: "Hex",
          body: "Mac、Windows、Linux 向けの音声入力。Hex は端末内で文字起こしし、どのアプリにも貼り付けられます。音声が端末の外に出ることはありません。",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "手元のマシンで動くアプリに公開 HTTPS URL を付与する CLI と SDK。TLS は手元のマシンで終端するため、中継サーバーに平文は渡りません。",
        },
      },
    },
    about: {
      title: "OpenCode について",
      body: "そのまま使える OpenCode と各製品の紹介文です。長文版と短文版を用意しています。",
      boilerplate: {
        long: "OpenCode はオープンソースのコーディングエージェントです。デスクトップアプリ、ターミナル UI、モバイルアプリ、SDK を提供し、Claude、GPT、Gemini など、あらゆるプロバイダーのモデルで動作します。Anomaly が開発し、MIT ライセンスで公開しています。GitHub スターは 220,000 以上、コントリビューターは 1,000 人以上で、毎月 2,200 万人以上の開発者に利用されています。",
        short:
          "OpenCode は Anomaly が開発するオープンソースのコーディングエージェントです。デスクトップ、ターミナル、モバイル向けのアプリと SDK を提供しています。",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console は、開発者やチームが OpenCode などのコーディングエージェントで使う AI モデルへのアクセスを購入・管理する Web アプリです。フロンティアモデルとオープンウェイトモデルの従量課金による推論に対応し、リクエストごとに前払いクレジットから課金します。OpenCode Go のサブスクリプションも提供しています。チームは、メンバー、管理者、オーナーのロールや、ワークスペースとユーザーごとの支出上限を設定でき、Okta、Microsoft Entra ID、Google Workspace によるシングルサインオンや SCIM を利用できます。Console は 30 以上のプロバイダーに対応しているため、お使いのプロバイダーのアカウントを接続できます。Console の推論を使う必要はありません。URL は opencode.ai/console です。",
          short:
            "OpenCode Console は Anomaly の Web アプリです。従量課金で使える AI モデル、OpenCode Go のサブスクリプション、予算やシングルサインオンなどのチーム管理機能を提供します。",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go は、コーディングモデルを月額固定で使いたい開発者向けのサブスクリプションです。Go は月額 $10、利用枠の大きい Go Plus は月額 $40、Go Teams はメンバー 1 人あたり月額 $20 です。どのプランも、エージェント型コーディング向けに検証したモデルを厳選しています。モデルごとの月間利用上限を米ドルで定め、直近 5 時間と 1 週間の利用枠はそれぞれ月間上限の 20% と 50% です。契約者はクレジットをチャージして従量課金の残高から支払うことも、いつでも解約することもできます。Go は OpenCode でも、ほかのエージェントでも使えます。URL は opencode.ai/console/go です。",
          short:
            "OpenCode Go は、月間利用枠の範囲で厳選コーディングモデルを使える、Anomaly のサブスクリプションです。月額 $10 から利用できます。",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data は、OpenCode で使われている AI モデルと、その利用割合の推移がわかる公開ダッシュボードです。利用上位のモデル、トークン使用量、セッションとトークンの費用、キャッシュ率、市場シェア、国別の内訳を公開しています。集計は 1 時間ごとで、日と週の区切りは UTC に準じます。ユーザー数とセッション数は概算で、費用は OpenCode のモデルカタログに掲載された定価に基づきます。報道関係者は OpenCode Data（opencode.ai/data）を、ページの更新時刻とともに出典として記載できます。",
          short:
            "OpenCode Data は opencode.ai/data で公開しているダッシュボードです。OpenCode での実際の使用量に基づき AI モデルをランク付けし、トークン使用量、費用、市場シェアを 1 時間ごとに更新しています。",
        },
      },
    },
    facts: {
      title: "概要",
      items: {
        license: { label: "ライセンス" },
        "first-release": { label: "初回リリース" },
        "made-by": { label: "開発元" },
      },
    },
    milestones: {
      title: "沿革",
      items: {
        "first-release-v0-0-1": { date: "2025年4月", text: "初回リリース、v0.0.1" },
        "1-million-downloads": { date: "2025年10月", text: "ダウンロード数100万突破" },
        "opencode-1-0": { date: "2025年10月", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "2025年12月", text: "Desktopアプリ公開" },
        "10-million-downloads": { date: "2026年1月", text: "ダウンロード数1,000万突破" },
        "opencode-2-0": { date: "2026年9月", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "2026年11月", text: "GitHubスター220,000突破" },
      },
    },
    news: {
      title: "最新リリース",
      intro: "OpenCode は頻繁にアップデートしています。新機能が加わった最新のリリースはこちらです。",
      changelog: { text: "すべての変更履歴" },
      feed: { text: "RSS フィード" },
    },
    media: {
      title: "メディア",
      intro: "各アプリの実際の画面を収録した静止画と短い動画です。OpenCode の記事にご利用いただけます。",
      note: "すべてダークテーマで収録しています。静止画とポスターは最大 1920 × 1080（縦向きは 1080 × 1350）の JPG です。動画は音声なしの MP4 です。",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktopの動画" },
            "frame-1": { title: "Desktopの静止画1" },
            "frame-2": { title: "Desktopの静止画2" },
            "frame-3": { title: "Desktopの静止画3" },
            "frame-4": { title: "Desktopの静止画4" },
            "feature-1": { title: "エージェントを並行実行" },
            "feature-2": { title: "ブラウザで確認" },
            "feature-3": { title: "どのデバイスからでも" },
            "locked-portrait": { title: "Desktopの動画（縦）" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobileの動画" },
            "frame-1": { title: "Mobileの静止画1" },
            "frame-2": { title: "Mobileの静止画2" },
            "frame-3": { title: "Mobileの静止画3" },
            "feature-1": { title: "音声" },
            "feature-2": { title: "セッション" },
            "feature-3": { title: "結果" },
            "locked-portrait": { title: "Mobileの動画（縦）" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminalの動画" },
            "frame-1": { title: "Terminalの静止画1" },
            "frame-2": { title: "Terminalの静止画2" },
            "frame-3": { title: "Terminalの静止画3" },
            "frame-4": { title: "Terminalの静止画4" },
            "feature-1": { title: "普段の言葉で依頼" },
            "feature-2": { title: "実行内容を承認" },
            "feature-3": { title: "自分好みに" },
            "locked-portrait": { title: "Terminalの動画（縦）" },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": { title: "SDKの動画" },
            "frame-1": { title: "SDKの静止画1" },
            "frame-2": { title: "SDKの静止画2" },
            "frame-3": { title: "SDKの静止画3" },
            "frame-4": { title: "SDKの静止画4" },
            "feature-1": { title: "コードでCIを修正" },
            "feature-2": { title: "すべてのステップを追う" },
            "feature-3": { title: "独自のツールを作る" },
            "locked-portrait": { title: "SDKの動画（縦）" },
          },
        },
      },
    },
    people: { title: "メンバー" },
    anomalyLogo: {
      title: "Anomaly のロゴ",
      body: "Anomaly のマークとワードマーク（黒と白）。PNG の幅は 2048 px です。",
      assets: {
        "mark-black": { name: "マーク、黒" },
        "mark-white": { name: "マーク、白" },
        "wordmark-black": { name: "ワードマーク、黒" },
        "wordmark-white": { name: "ワードマーク、白" },
      },
      avatars: {
        body: "X、GitHub、Slack、LinkedInなどのプロフィール用の正方形アバター。マークは円の内側に十分収まっているので、丸く切り抜いても問題ありません。PNGの幅は1024 pxと400 pxです。",
        items: {
          "avatar-dark": { name: "アバター、ダーク" },
          "avatar-light": { name: "アバター、ライト" },
        },
      },
      all: { text: "一括ダウンロード" },
    },
    coverage: { title: "掲載実績" },
    brand: {
      title: "ブランド",
      before:
        "OpenCode のロゴとワードマークを ZIP ファイルで一括ダウンロードできます。個別のファイル、バリエーション、使用ルールについては、",
      link: { text: "ブランドページ" },
      after: "をご覧ください。",
      usage:
        "OpenCode についての記事にご利用いただけます。ファイルを変更したり、OpenCode が活動を推奨していると受け取られる使い方をしたりしないでください。",
    },
    product: {
      title: "製品",
      items: {
        desktop: {
          name: "Desktop",
          body: "複数のエージェントを、それぞれ専用のタブで同時に実行できます。macOS、Windows、Linuxに対応。すべての変更を差分で確認し、プレビューできます。",
        },
        mobile: {
          name: "Mobile",
          body: "OpenCode の最新アプリ。通話でエージェントと話し、どこからでもスマートフォンで変更を確認・承認できます。",
        },
        terminal: {
          name: "Terminal",
          body: "どのシェル、エディター、リモートサーバーでも動くターミナル UI。編集ごとの差分を確認し、自動実行するコマンドを選べます。",
        },
        sdk: {
          name: "SDK",
          body: "スクリプト、CI ジョブ、独自のツール向けの型付き TypeScript クライアント。セッションの作成、プロンプトの送信、すべてのイベントのストリーミングに対応します。",
        },
      },
    },
    contact: {
      title: "連絡先",
      items: {
        press: {
          title: "プレス",
          body: "報道関係者とアナリストの方向け。メディアからのお問い合わせにのみ返信します。",
        },
        support: {
          links: { "github-issues": { text: "GitHub の Issue" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "サポート",
          body: "OpenCode の使い方でお困りの場合は、Issue を作成するか、コミュニティで質問してください。アカウントや請求に関するご質問はメールでお送りください。",
        },
        security: {
          links: {
            "report-a-vulnerability": { text: "脆弱性を報告" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
          title: "セキュリティ",
          body: "脆弱性は GitHub から報告してください。6 営業日以内に返信がなければ、メールでご連絡ください。",
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "スクリプト" } } },
    extensions: {
      title: "拡張機能",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
    faq: {
      items: {
        "how-do-i-use-opencode": { answer: [undefined, undefined, undefined] },
        "can-i-use-my-existing-ai-subscriptions-with-opencode": { answer: [undefined, undefined, undefined] },
        "what-about-data-and-privacy": { answer: [undefined, undefined, undefined] },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "スクリプト" } } },
    sdk: { more: { label: "SDK のドキュメントを読む" } },
    mini: {
      commands: { curl: { name: "スクリプト" } },
      lead: "Mini は OpenCode CLI に含まれています。次のいずれかの方法でインストールし、opencode mini を実行してください。",
    },
  },
  pair: {
    title: "スマートフォンを接続",
    cardTitle: "コマンド 1 つでスマートフォンとペアリング",
    intro:
      "OpenCode Mobile は、コンピューターで動く OpenCode を遠隔操作するアプリです。コンピューターで動き続けるセッションを、スマートフォンで確認しながら操作できます。",
    steps: {
      "get-the-app": {
        title: "アプリを入手",
        body: "iPhone では TestFlight から OpenCode のベータ版を、Android スマートフォンでは OpenCode アプリをインストールしてください。",
      },
      "run-this-on-your-computer": {
        title: "コンピューターで実行",
        body: "1 回だけ使えるリンクと QR コードが表示されます。どちらも有効期限は 5 分です。",
      },
      "scan-the-code": {
        title: "コードを読み取る",
        body: "アプリで QR コードを読み取るか、リンクを貼り付けます。コンピューターの最近のセッションがスマートフォンで開きます。",
      },
    },
    note: "--remote では OpenTunnel のアドレスを経由するため、どのネットワークからでも接続できます。同じ Wi-Fi に接続している場合は、opencode service set hostname 0.0.0.0 を 1 回実行してから、opencode pair を実行します。",
    facts: [
      "--remote は OpenTunnel のアドレスを経由するため、どのネットワークからでもペアリングできます。",
      "リンクとコードは 1 回だけ使えます。有効期限は 5 分です。",
      "エージェントはスマートフォンではなくコンピューターで動くので、コンピューターの電源は入れたままにしてください。",
      "同じ Wi-Fi に接続している場合は、opencode service set hostname 0.0.0.0 を 1 回実行してから、opencode pair を実行します。",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "デスクトップ用プラグインの作成、インストール、共有に対応。",
      link: "2.2 の新機能を見る",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Desktop のターミナルは再起動してもそのまま。",
      link: "v2.2.4 を見る",
    },
    "agents-can-now-generate-images": {
      text: "エージェントが画像を生成できるようになりました。",
      link: "v2.2.1 を見る",
    },
    "steer-your-sessions-from-your-phone": {
      text: "スマートフォンからセッションを操作できます。",
      link: "OpenCode Mobile を見る",
    },
    "a-refreshed-desktop-app": { text: "デスクトップアプリを刷新しました。", link: "2.2 の新機能を見る" },
  },
} satisfies ContentOverlay
