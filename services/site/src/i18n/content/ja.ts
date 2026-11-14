import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "セッション、タブ、差分、内蔵ブラウザ、拡張機能。macOS、Windows、Linuxに対応。",
      action: "ダウンロード",
    },
    mobile: {
      name: "Mobile",
      body: "どこにいても、スマートフォンからセッションを開始、指示、承認できます。",
      action: "ダウンロード",
    },
    terminal: {
      name: "Terminal",
      body: "どのシェル、エディタ、リモートサーバーでも動く高速なターミナルUI。",
      action: "インストール",
    },
    sdk: {
      name: "SDK",
      body: "自分のスクリプト、CIジョブ、ツールからOpenCodeを操作できます。",
      action: "ドキュメント",
    },
    mini: {
      name: "Mini",
      body: "最小限のターミナルインターフェース。返答はスクロールバックに出力され、下にはプロンプトが1つだけ残ります。",
      action: "インストール",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | macOS、Windows、Linux向けデスクトップアプリ",
      description:
        "OpenCodeエージェントを好きなだけ並列で実行し、すべての変更を横のブラウザで確認して、どのデバイスからでも再開できます。macOS、Windows、Linuxに対応。",
      intro:
        "複数のエージェントを同時に実行し、セッションごとに専用のタブで管理できます。すべての変更を差分で確認し、任意の行にコメントして、内蔵ブラウザで結果をチェックできます。macOS、Windows、Linuxに対応しています。",
      showcase: {
        "parallel-agents": {
          title: "並列エージェント",
          body: "エージェントを好きなだけ起動して、すべて並列で作業させられます。終わったものから切り替えて確認できます。",
        },
        "see-it-in-the-browser": {
          title: "ブラウザで確認",
          body: "アプリがエージェントの横のブラウザで開くので、あなたとエージェントの両方がすべての変更をその場で確認できます。",
        },
        "on-every-device": {
          title: "あらゆるデバイスで",
          body: "すべてのデバイスでエージェントを起動し、デスクトップアプリ、ターミナル、スマートフォンから続きを再開できます。",
        },
        "extend-it": {
          title: "拡張する",
          body: "ツールやサービスを接続すれば、エージェントはどんなものでも扱えます。OpenCodeに自分用のプラグインを作らせ、サイドバーに専用のUIを表示することもできます。",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile、スマートフォンで操作するコーディングセッション",
      description:
        "スマートフォンからOpenCodeのセッションを開始して操作できます。エージェントがコンピューターで動く間も、会話できます。",
      intro:
        "どこにいても、スマートフォンからセッションを開始して操作できます。セッションに通話してエージェントと話したり、セッションを開いて続きから再開できます。すべて自分のコンピューターで動くOpenCode上で行われます。",
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
        voice: { title: "音声", body: "セッションに通話して、必要なことを話すだけ。エージェントが声で答えます。" },
        sessions: { title: "セッション", body: "どのセッションも開いて進み具合を確認し、続きから再開できます。" },
        results: { title: "結果", body: "依頼した作業が終わると、何が変わったかを通話で伝えます。" },
        steer: { title: "指示", body: "セッションの途中で追加のメッセージを送り、方向を変えられます。" },
      },
    },
    terminal: {
      title: "OpenCode | オープンソースのコーディングエージェントのターミナルUI",
      description:
        "どのシェル、エディタ、リモートサーバーでも動く、OpenCodeの高速なターミナルUI。やりたいことを伝えれば、各編集を差分で確認し、コマンドを承認できます。",
      intro:
        "どのシェル、エディタ、リモートサーバーでも動く高速なターミナルUI。やりたいことを普段の言葉で伝え、各編集が差分として反映される様子を確認し、どのコマンドを自動で実行するかを選べます。",
      features: {
        "any-terminal": {
          title: "全ターミナル対応",
          body: "どのシェルでも、エディタのターミナルでも、リモートサーバーでも動きます。",
        },
        "diffs-in-the-timeline": {
          title: "タイムラインに差分",
          body: "エージェントが編集するたびに、タイムラインで差分を確認できます。",
        },
        "pick-up-later": {
          title: "後から再開",
          body: "-c で前回のセッションを、-s で任意のセッションを再開できます。",
        },
        "one-off-runs": { title: "単発の実行", body: "opencode run でメッセージを1つ送り、返答を出力します。" },
        "agents-and-commands": {
          title: "エージェントとコマンド",
          body: "shift+tab でエージェントを切り替え、ctrl+p ですべてのコマンドを開けます。",
        },
        "auto-approve": {
          title: "自動承認",
          body: "--auto を付けて実行すると、拒否していないすべての操作を許可します。",
        },
        "any-server": { title: "任意のサーバー", body: "--server でURLを指定してOpenCodeサーバーに接続できます。" },
        "usage-stats": { title: "利用統計", body: "opencode stats で、共有できる利用統計を表示します。" },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "普段の言葉で依頼",
          body: "やりたいことを入力すると、エージェントが作業しながら計画を示します。",
        },
        "approve-what-runs": {
          title: "実行内容を承認",
          body: "編集は差分で表示され、コマンドはあなたの許可を待ちます。",
        },
        "make-it-yours": {
          title: "自分好みに",
          body: "デフォルトからtokyonightまで、キー1つでテーマを切り替えられます。",
        },
        mini: { title: "Mini", body: "opencode mini を実行すると、返答が自分のスクロールバックに出力されます。" },
      },
    },
    sdk: {
      title: "OpenCode | スクリプト、CIジョブ、ツールのためのTypeScript SDK",
      description:
        "自分のスクリプト、CIジョブ、ツールからOpenCodeを操作できます。型付きのTypeScriptクライアントで、セッションの作成、プロンプトの送信、すべてのイベントのストリーミングを行えます。",
      intro:
        "自分のスクリプト、CIジョブ、ツールからOpenCodeを操作できます。SDKはあなたの設定とモデルでOpenCodeをプロセス内で実行し、型付きクライアントでセッションの作成、プロンプトの送信、すべてのイベントのストリーミングを行えます。",
      features: {
        "typescript-client": {
          title: "TypeScriptクライアント",
          body: "型付きのリクエストとイベント。@opencode/client と同じ値を使います。",
        },
        "sessions-from-code": {
          title: "コードでセッション",
          body: "どのスクリプトからでもセッションを作成し、プロンプトを送れます。",
        },
        "any-model": { title: "任意のモデル", body: "OpenCodeの設定にあるモデルをそのまま使います。" },
        "npm-or-bun": {
          title: "npmまたはbun",
          body: "npm i @opencode/sdk または bun add @opencode/sdk でインストールできます。",
        },
        "in-process-host": {
          title: "インプロセスホスト",
          body: "ネットワークを介さず、メモリ内でOpenCodeを実行します。",
        },
        "your-plugins": {
          title: "自分のプラグイン",
          body: "インプロセスホストの作成時に、独自のプラグインを渡せます。",
        },
        "promise-or-effect": { title: "PromiseかEffect", body: "同じ値を返すPromise APIとEffect API。" },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Workers上のCloudflare Durable Object内でOpenCodeを実行できます。",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "コードでCIを修正",
          body: "短いスクリプトで、失敗したテストをOpenCodeに直させて再実行します。",
        },
        "follow-every-step": {
          title: "すべてのステップを追う",
          body: "イベントをストリーミングして、エージェントが呼ぶツールを即座に確認。",
        },
        "build-your-own-tools": {
          title: "独自のツールを作る",
          body: "数行のコードで、ボット、ダッシュボード、ワークフローにOpenCodeを組み込めます。",
        },
        "in-your-process": {
          title: "プロセス内で実行",
          body: "あなたの設定とモデルで、OpenCodeをプロセス内で実行します。",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini、エージェントのための最小限のターミナルUI",
      description:
        "MiniはOpenCodeを最小限のターミナルインターフェースで実行します。返答はターミナル自体のスクロールバックに出力され、下にはプロンプトとステータス行だけが残ります。",
      intro:
        "OpenCodeのための最小限のターミナルインターフェース。opencode mini を実行すると、返答がターミナル自体のスクロールバックに直接出力されるので、ほかの出力と同じようにスクロール、検索、コピーできます。下部に残るのはプロンプトとステータス行だけです。",
      features: {
        "your-scrollback": { title: "スクロールバック", body: "返答は通常のターミナル履歴になります。" },
        "one-prompt": {
          title: "単一プロンプト",
          body: "エージェント、モデル、コンテキスト、コストを1行のステータスに表示。",
        },
        permissions: { title: "権限", body: "プロンプト欄から編集やコマンドを許可できます。" },
        "how-much-shows": {
          title: "表示量を調整",
          body: "思考とツール出力を、控えめ、デフォルト、すべてから選べます。",
        },
        "pick-up-later": {
          title: "後から再開",
          body: "-c で前回のセッションを、-s で任意のセッションを再開できます。",
        },
        "same-opencode": { title: "同じOpenCode", body: "ほかのアプリと同じサーバー、エージェント、モデル。" },
        agents: { title: "エージェント", body: "プロンプトから直接エージェントを切り替えられます。" },
        compact: { title: "圧縮", body: "/compact で長いセッションを縮められます。" },
      },
    },
  },
  extensionCard: {
    name: "拡張機能",
    body: "VS CodeでOpenCodeを使えます。ZedなどのエディタではACP経由で使えます。",
    action: "インストール",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "エージェントが普段のブラウザを使えます。",
      title: "OpenCode | Browse、コーディングエージェントが使う普段のブラウザ",
      description:
        "Browseを使うと、OpenCodeやほかのMCPクライアントが普段のブラウザを使えます。エージェントはPlaywrightでバックグラウンドのタブを操作し、ログインや2FAはあなたに任せます。",
      intro:
        "MCPサーバーとChromium拡張機能で、エージェントが普段のブラウザを使えるようにします。あなたのタブ、ログイン、拡張機能をそのまま使えます。エージェントはPlaywrightでタブを開いて操作し、スクリーンショットを撮り、画面を録画します。タブはバックグラウンドでグループにまとめられ、作業の邪魔になりません。ログイン、2FAの入力、支払いなどあなたの番になると、エージェントはタブをあなたに渡し、「Continue」をクリックすると作業を再開します。",
      features: {
        "your-real-browser": {
          title: "普段のブラウザ",
          body: "Chrome、Edge、Brave、Arc、Helium、Vivaldi、Opera、Chromium。",
        },
        "out-of-your-way": {
          title: "邪魔にならない",
          body: "エージェントのタブは、折りたたまれたグループでバックグラウンドに開きます。",
        },
        handoffs: { title: "引き継ぎ", body: "ログインや2FAの手順は自分で行い、「Continue」をクリックします。" },
        "lend-a-tab": {
          title: "タブを貸す",
          body: "ツールバーのボタンをクリックして、開いているタブをエージェントに渡せます。",
        },
        "record-and-capture": {
          title: "録画と記録",
          body: "スクリーンショット、画面録画、HAR形式のネットワーク通信。",
        },
        "any-mcp-client": { title: "全MCPクライアント", body: "OpenCode、Claude Code、Cursor、Codex、Zedなど多数。" },
        "all-your-logins": {
          title: "ログインはそのまま",
          body: "エージェントは、すでにサインインしているサイトをそのまま使います。キーも設定も不要です。",
        },
        allowlists: { title: "許可リスト", body: "セッションのタブを、指定したサイトだけに制限できます。" },
      },
      install:
        "まず [Chrome 拡張機能] をインストールしてください。残りの手順は拡張機能が案内します。CLI を直接インストールする場合は(通常は不要です)、次のいずれかを使ってください。",
    },
  },
  apps: {
    browse: {
      category: "エージェント向けブラウザ操作",
      body: "ログインもタブもそのまま、いつものブラウザをエージェントが使えます。",
    },
    opentunnel: { category: "ローカルトンネル", body: "ローカルアプリに公開HTTPS URLを。" },
    opentui: { category: "ライブラリ", body: "ターミナルUIのためのライブラリ。" },
    hex: { category: "音声入力", body: "どのアプリでも使える、デバイス上の音声入力。" },
  },
  getStarted: {
    title: "はじめる",
    lead: "いちばん簡単な始め方は、OpenCodeをダウンロードして無料モデルを使うことです。アカウントは不要です。もっと使いたいときは、お使いのサブスクリプションを持ち込むか、OpenCode Goを使えます。",
    phrases: {
      "download-opencode": { text: "OpenCodeをダウンロード" },
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
        line: "OpenCodeには無料モデルが付属しています。アカウントは不要です。",
      },
      "add-more-models": {
        title: "モデルを追加",
        line: "お使いのサブスクリプションを持ち込むか、月額$10からのOpenCode Goの厳選モデルを使えます。",
      },
    },
    sentence:
      "OpenCodeをダウンロードして無料モデルから始め、もっと使いたくなったら、お使いのサブスクリプションかOpenCode Goを使えます。",
  },
  byos: {
    title: "サブスクリプションを持ち込む",
    headline: "すでにお持ちのサブスクリプションを使えます。",
    line: "ChatGPT PlusまたはPro、あるいはGitHub Copilotでログインできます。OpenCodeのサブスクリプションも使えます。",
    yours: { label: "お使いのサブスクリプション", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCodeのサブスクリプション", "OpenCode Go"],
    ours: { label: "OpenCodeのプラン" },
  },
  brand: {
    hero: { copy: { text: "エージェント用ルール", copied: "コピーしました" } },
    naming: {
      title: "表記",
      body: "OpenCodeは、大文字のOと大文字のCを使って1語で書きます。Opencode、Open Code、OpenCode AI、Open-Codeとは書きません。",
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
        body: "OpenCodeの字形で書いた正式名称。名前を書ききるスペースがある場所で使います。",
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
      body: "OpenCodeと連携するプラグイン、プロバイダー、ツールや、OpenCodeで作ったプロジェクトは、そのことを表示できます。バッジかパートナーロックアップを使い、プロジェクトがあなたのものだとわかる名前を付けてください。",
      badges: {
        body: "README、ドキュメント、Webサイトにバッジを置き、opencode.aiにリンクしてください。背景に合わせてライトかダークのファイルを選び（HTMLは自動で切り替わります）、色やテキストは変更しないでください。",
        sizes: "どのスタイルも20、32、44px（Shieldsは20pxのみ）で、SVGと2倍サイズのPNGがあります。",
        mono: "各ファイルには、テキストをOpenTUI Monoにした版もあります。opencode-works-with-a-light-20-mono.svg のように拡張子の前に -mono を付けます。大文字のOpenTUI Monoなら -mono-caps を付けます。",
        groups: {
          "works-with": {
            title: "Works with",
            alt: "Works with OpenCode",
            body: "OpenCodeと一緒に動くプラグイン、プロバイダー、ツール向け。",
          },
          "built-with": { title: "Built with", alt: "Built with OpenCode", body: "OpenCodeで作ったプロジェクト向け。" },
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
        body: "プロジェクトがあなたのものだとわかるように、自分の名前を先に置きます。",
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
    title: "OpenCode | 企業情報とブランド素材のプレスキット",
    description:
      "OpenCodeのプレスキットです。OpenCodeと開発元のAnomalyに関する情報、ダウンロードできるロゴとワードマーク、報道関係のお問い合わせ先をまとめています。",
    hero: { title: "プレス", body: "OpenCodeとAnomalyについて書くための情報、ブランド素材、連絡先。" },
    company: {
      title: "Anomalyについて",
      lead: "AnomalyはOpenCodeを開発している会社です。開発者向けのオープンソースツールを作っています。",
      more: "ほかにもSSTやOpenTUIなどのプロジェクトがあり、すべて[GitHub](github)でオープンソースとして公開しています。",
      learnMore: "詳しくは[anoma.ly](site)をご覧ください。",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "オープンソースのコーディングエージェント。デスクトップ、ターミナル、モバイル向けのアプリとSDKがあります。MITライセンス、GitHubスター220,000以上。",
        },
        sst: {
          name: "SST",
          body: "自分のインフラ上でフルスタックアプリを構築するためのフレームワーク。MITライセンスで2020年から公開され、GitHubスターは26,000以上。",
        },
        opentui: {
          name: "OpenTUI",
          body: "TypeScript、React、Solidでターミナル UIを作るためのライブラリで、コアはZigで書かれています。OpenCodeが本番環境で使っています。GitHubスターは13,000以上。",
        },
        "models-dev": {
          name: "Models.dev",
          body: "AIモデルの仕様、価格、機能をまとめたオープンソースのデータベースで、公開APIがあります。200以上のプロバイダーの8,900以上のモデルを掲載しています。",
        },
        hex: {
          name: "Hex",
          body: "Mac、Windows、Linux向けの音声入力。Hexはデバイス上で文字起こしし、どのアプリにも貼り付けるので、音声が外部に出ることはありません。",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "マシン上のアプリに公開HTTPS URLを付けるCLIとSDK。TLSはあなたのマシンで終端されるので、リレーが平文を見ることはありません。",
        },
      },
    },
    about: {
      title: "OpenCodeについて",
      body: "OpenCodeと各製品の紹介文です。長文版と短文版があり、そのままコピーして使えます。",
      boilerplate: {
        long: "OpenCodeはオープンソースのコーディングエージェントです。デスクトップアプリ、ターミナルUI、モバイルアプリ、SDKとして提供され、Claude、GPT、Geminiなど、あらゆるプロバイダーのモデルで動作します。OpenCodeはMITライセンスで、Anomalyが開発しています。GitHubスターは220,000以上、コントリビューターは1,000人以上で、毎月2,200万人以上の開発者が利用しています。",
        short:
          "OpenCodeはAnomalyが開発するオープンソースのコーディングエージェントで、デスクトップ、ターミナル、モバイル向けのアプリとSDKがあります。",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Consoleは、開発者やチームがOpenCodeやほかのコーディングエージェントで使うAIモデルへのアクセスを購入、管理するWebアプリです。フロンティアモデルとオープンウェイトモデルの従量課金制の推論（前払いクレジットからリクエストごとに課金）と、OpenCode Goのサブスクリプションを提供しています。チームは、Member、Admin、Ownerのロールを持つワークスペース、ワークスペース単位とユーザー単位の利用上限、Okta、Microsoft Entra ID、Google Workspaceによるシングルサインオン、SCIMを利用できます。Consoleは30以上のプロバイダーに対応しているため、チームはすでに持っているプロバイダーのアカウントを接続でき、Console自体の推論は任意です。URLはopencode.ai/consoleです。",
          short:
            "OpenCode Consoleは、従量課金制のAIモデルアクセス、OpenCode Goのサブスクリプション、予算やシングルサインオンなどのチーム管理機能を提供するAnomalyのWebアプリです。",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Goは、コーディングモデルを月額固定で使いたい開発者向けのサブスクリプションです。Goは月額$10、上限が高いGo Plusは月額$40、Go Teamsはメンバー1人あたり月額$20です。各プランには、エージェント型コーディング向けにテストした厳選モデルが含まれます。利用上限はモデルごとの月額のドル建てで、5時間ごとと週ごとに、月間上限の20%と50%の枠が順次回復します。サブスクライバーはクレジットを追加でき、従量課金の残高に切り替えることも、いつでも解約することもできます。GoはOpenCodeとほかのエージェントで使えます。URLはopencode.ai/console/goです。",
          short:
            "OpenCode Goは、厳選したコーディングモデルを月間の利用上限つきで使える、Anomalyの月額サブスクリプションです。月額$10からです。",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Dataは、開発者がOpenCodeでどのAIモデルを使っているか、その構成が時間とともにどう変わるかを示す公開ダッシュボードです。上位モデルのランキング、トークン使用量、セッションとトークンのコスト、キャッシュ率、市場シェア、国別の内訳を公開しています。数値は1時間ごとに集計され、日と週はUTCで区切られます。ユーザー数とセッション数は概算で、コストはOpenCodeのモデルカタログの定価を使っています。報道関係者は、ページに表示される更新時刻とともに、OpenCode Data（opencode.ai/data）として引用できます。",
          short:
            "OpenCode Dataは、opencode.ai/dataで公開しているダッシュボードです。OpenCodeでの実際の利用量に基づいてAIモデルをランク付けし、トークン、コスト、市場シェアを1時間ごとに更新しています。",
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
      intro: "OpenCodeは頻繁にリリースしています。新機能を含む最新のリリースを紹介します。",
      changelog: { text: "変更履歴の全文" },
      feed: { text: "RSS" },
    },
    media: {
      title: "メディア",
      intro: "実際の製品から収録した、各アプリの静止画と短い動画です。OpenCodeについて書く際にご利用いただけます。",
      note: "すべてダークテーマで収録しています。静止画とポスターは最大1920 × 1080（縦向きは1080 × 1350）のJPGです。動画は音声なしのMP4です。",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktopの動画" },
            "frame-1": { title: "Desktopの静止画1" },
            "frame-2": { title: "Desktopの静止画2" },
            "frame-3": { title: "Desktopの静止画3" },
            "frame-4": { title: "Desktopの静止画4" },
            "feature-1": { title: "タブでセッション管理" },
            "feature-2": { title: "レビューとコメント" },
            "feature-3": { title: "ブラウザで確認" },
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
            "feature-2": { title: "承認" },
            "feature-3": { title: "セッション" },
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
      title: "Anomalyのロゴ",
      body: "Anomalyのマークとワードマーク（黒と白）。PNGの幅は2048 pxです。",
      assets: {
        "mark-black": { name: "マーク、黒" },
        "mark-white": { name: "マーク、白" },
        "wordmark-black": { name: "ワードマーク、黒" },
        "wordmark-white": { name: "ワードマーク、白" },
      },
      all: { text: "一括ダウンロード" },
    },
    coverage: { title: "掲載実績" },
    brand: {
      title: "ブランド",
      before:
        "OpenCodeのロゴとワードマークを1つのZIPファイルでダウンロードできます。個別のファイル、バリエーション、使用ルールについては、",
      link: { text: "ブランドページ" },
      after: "をご覧ください。",
      usage:
        "これらのファイルは、OpenCodeについて書くために使えます。ファイルを変更したり、OpenCodeがあなたの活動を推奨しているかのように示したりしないでください。",
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
          body: "最新のOpenCodeアプリ。セッションに通話してエージェントと話し、どこにいてもスマートフォンから変更を確認、承認できます。",
        },
        terminal: {
          name: "Terminal",
          body: "どのシェル、エディタ、リモートサーバーでも動くターミナルUI。各編集を差分で確認し、どのコマンドを自動で実行するかを選べます。",
        },
        sdk: {
          name: "SDK",
          body: "スクリプト、CIジョブ、独自ツールのための型付きTypeScriptクライアント。セッションを作成し、プロンプトを送り、すべてのイベントをストリーミングできます。",
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
          links: { "github-issues": { text: "GitHubのissue" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "サポート",
          body: "OpenCodeについてのヘルプは、issueを作成するか、コミュニティで質問してください。アカウントや請求に関するご質問はメールでお送りください。",
        },
        security: {
          links: {
            "report-a-vulnerability": { text: "脆弱性を報告" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
          title: "セキュリティ",
          body: "脆弱性はGitHubから報告してください。6営業日以内に返信がない場合は、メールでご連絡ください。",
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
    sdk: { more: { label: "SDKのドキュメントを読む" } },
    mini: {
      commands: { curl: { name: "スクリプト" } },
      lead: "MiniはOpenCode CLIに含まれています。次のいずれかでインストールし、opencode mini を実行してください。",
    },
  },
  pair: {
    title: "スマートフォンを接続",
    cardTitle: "1つのコマンドでスマートフォンとペアリング",
    intro:
      "OpenCode Mobileは、コンピューター上のOpenCodeのリモコンです。セッションはコンピューターで動き続け、アプリはそれを表示して操作できるようにします。",
    steps: {
      "get-the-app": {
        title: "アプリを入手",
        body: "TestFlightからiPhoneにOpenCodeのベータ版をインストールします。Androidアプリは近日公開予定です。",
      },
      "run-this-on-your-computer": {
        title: "コンピューターで実行",
        body: "1回限りのリンクとQRコードが表示されます。どちらも1回だけ使え、5分で期限が切れます。",
      },
      "scan-the-code": {
        title: "コードを読み取る",
        body: "アプリでQRコードを読み取るか、リンクを貼り付けます。コンピューターの最近のセッションがスマートフォンで開きます。",
      },
    },
    note: "--remote はOpenTunnelのアドレス経由で接続するので、どのネットワークからでも使えます。同じWi-Fiにいる場合は、opencode service set hostname 0.0.0.0 を1回実行してから、opencode pair を実行します。",
    facts: [
      "--remote はOpenTunnelのアドレス経由で接続するので、ペアリングはどのネットワークからでも使えます。",
      "リンクとコードは1回だけ使え、5分で期限が切れます。",
      "エージェントはスマートフォンではなくコンピューターで動くので、コンピューターの電源は入れたままにしてください。",
      "同じWi-Fiでは、opencode service set hostname 0.0.0.0 を1回実行してから、opencode pair を実行します。",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "デスクトッププラグインを作成、インストール、共有できます。",
      link: "2.2の新機能を見る",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Desktopのターミナルが再起動後も残るようになりました。",
      link: "v2.2.4を見る",
    },
    "agents-can-now-generate-images": {
      text: "エージェントが画像を生成できるようになりました。",
      link: "v2.2.1を見る",
    },
    "steer-your-sessions-from-your-phone": {
      text: "スマートフォンからセッションを操作できます。",
      link: "OpenCode Mobileを見る",
    },
    "a-refreshed-desktop-app": { text: "デスクトップアプリを刷新しました。", link: "2.2の新機能を見る" },
  },
} satisfies ContentOverlay
