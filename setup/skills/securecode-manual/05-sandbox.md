# 05. サンドボックスと権限

SecureCode は opencode に **2 層の防御** を足しています。これが SecureCode の核心です。

## 全体像

```
        ┌──────────── Layer 2: Sandbox (OS の檻) ────────────┐
        │   許可ドメイン以外への通信を遮断                   │
        │  ┌────────── Layer 1: Permission (アプリ内) ──────┐ │
        │  │   危険な tool 実行を確認 / 拒否                 │ │
        │  │        AI エージェント本体 (opencode)           │ │
        │  └────────────────────────────────────────────────┘ │
        └────────────────────────────────────────────────────┘
```

- **Layer 1** をすり抜けても **Layer 2** が止めるので、AI が暴走してもデータは外に出ない設計です。
- ユーザーが叩く `securecode` コマンドは **supervisor (門番)** で、本体 `securecode-bin` をサンドボックスに閉じ込めて起動します。

## Layer 1: Permission（アプリ内）

危険な tool（外部送信・ファイル削除・shell 実行など）の前にユーザー確認を挟みます。

- 既定では「破壊的操作 = 確認」「読み取り = 通す」
- AI が暗黙に「全許可」を要求しても、SecureCode は **明示許可がなければ「確認」に格下げ**します
- 確認ダイアログは TUI 上部に出る。`y` / `n` で応答

確認しすぎが煩わしい場合は、信頼できる範囲だけセッションごとに `allow always for <tool>` を指定できます（TUI 上のダイアログから）。

## Layer 2: Sandbox（OS レベル）

OS の機能でプロセスを隔離します。

| OS | 使う仕組み |
|---|---|
| macOS | Seatbelt (`sandbox-exec`) |
| Linux | bubblewrap |
| Windows | （現時点では未提供 / Linux on WSL 推奨） |

主な制約:

- **HTTPS / SOCKS5 outbound** は許可ドメイン (`conf-ai.acompany-az.com` 既定) 以外をすべて遮断
- **ファイルアクセス** はワーキングディレクトリ配下と最小限の OS パスのみ
- **`sandbox.json` 自体** は AI から読めない（設定改ざん防止）
- サンドボックスが起動できない環境では **fail-closed** = SecureCode は起動を拒否

## 許可ドメインを増やす

`~/.config/securecode/sandbox.json` を作成（または編集）して再起動。テンプレ:

```json
{
  "$schema": "https://acompany.ai/securecode/sandbox.json",
  "network": {
    "allow": [
      "your-internal-api.example.com",
      "registry.npmjs.org"
    ]
  }
}
```

> 追加するドメインは **必要最小限**。社内 proxy 経由でしか出られない環境では proxy のホスト名を追加。「全部許可」する書き方は意図的に提供していません。

## ありがちな引っかかり

| 症状 | 原因 | 対処 |
|---|---|---|
| `npm install` がタイムアウト | `registry.npmjs.org` がブロックされている | `sandbox.json` で許可 |
| `git push` が失敗（SSH） | SSH 接続が許可リストにない | `sandbox.json` に追加、または事前に `git push` を sandbox 外で実行 |
| `git fetch https://...` が失敗 | HTTPS ホストが許可外 | `sandbox.json` で許可 |
| プロキシ経由の社内 git が見えない | proxy ホスト名が許可されていない | `sandbox.json` に proxy を追加 |
| sandbox failed to start | bubblewrap (Linux) / Seatbelt (macOS) が無効化されている | `06-troubleshooting.md` 参照 |

## サンドボックス境界の確認

`securecode debug` 以下のサブコマンドで、現在のサンドボックス設定や許可ドメインを dump できます。「なぜブロックされた？」のときに有用。

## 関連

- 設定ファイルの場所 → `04-config.md`
- 起動できないとき → `06-troubleshooting.md`
- アーキテクチャ詳細 → `docs/02-architecture.md` の Layer 1 / Layer 2 解説
