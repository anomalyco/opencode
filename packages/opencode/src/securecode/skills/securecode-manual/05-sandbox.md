# 05. サンドボックスと権限

セキュアコードは **2 層の防御** で AI エージェントを包んでいます。これがセキュアコードの核心です。

## 全体像

外側から内側へ入れ子になっています: **Layer 2 (Sandbox: OS の檻) → Layer 1 (Permission: アプリ内) → AI エージェント本体**。

- **Layer 2: Sandbox**: OS 機能でプロセスを隔離し、許可ドメイン以外への通信を遮断 (macOS Seatbelt / Linux bubblewrap)
- **Layer 1: Permission**: アプリ内で危険な tool 実行を確認 / 拒否
- **AI エージェント本体**: 実際に LLM が動く中心。Layer 1 をすり抜けても Layer 2 が止めるので、AI が暴走してもデータは外に出ない設計

ユーザーが叩く `securecode` コマンドは **supervisor (門番)** で、本体 `securecode-bin` をサンドボックスに閉じ込めて起動します。

## Layer 1: Permission（アプリ内）

危険な tool（外部送信・ファイル削除・shell 実行など）の前にユーザー確認を挟みます。

- 既定では「破壊的操作 = 確認」「読み取り = 通す」
- AI が暗黙に「全許可」を要求しても、セキュアコード は **明示許可がなければ「確認」に格下げ**します
- 確認ダイアログは TUI 上部に出る。`y` / `n` で応答

確認しすぎが煩わしい場合は、信頼できる範囲だけセッションごとに `allow always for <tool>` を指定できます（TUI 上のダイアログから）。

## Layer 2: Sandbox（OS レベル）

OS の機能でプロセスを隔離します。

| OS | 使う仕組み |
|---|---|
| macOS | Seatbelt (`sandbox-exec`) |
| Linux | bubblewrap |

Windows ネイティブは配布対象外です。WSL2 上で Linux 版を使ってください。

主な制約:

- **HTTPS / SOCKS5 outbound** は許可ドメイン (`conf-ai.acompany-az.com` 既定) 以外をすべて遮断
- **書き込み可能なパス** は既定で **cwd + セキュアコード内部 (`~/.local/share/securecode` 等の XDG 配下) + per-session の一時ディレクトリ** のみ。それ以外はすべて拒否
- **一時ディレクトリは起動ごとに分離** — supervisor が `$TMPDIR/securecode-<timestamp>-<pid>/` を作成し、サンドボックス内の本体プロセスには `TMPDIR` 環境変数を上書きして渡す。終了時に同ディレクトリは `rm -rf` でクリーンアップされる。これにより**別セッションの残骸を AI が読み書きできない**設計 (timestamp が PID 再利用方向、PID が同時起動方向の衝突を構造的に防止)
- **`sandbox.json` 自体** は AI から **読みも書きも一切できない** (`denyRead` + `denyWrite` を global / project の sandbox.json 両方に常時固定。unlink + 再作成も Seatbelt / bubblewrap が阻止するので、AI が「自分の檻を広げるよう設定を書き換える」改ざんは構造上不可能)
- サンドボックスが起動できない環境では **fail-closed** = セキュアコード は起動を拒否

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

## 書き込みできる場所を増やす / 減らす

サンドボックスは既定で以下を **常に書き込み可** とします (この組み込みベースラインは config では削除できません):

- 起動時の **cwd** (= ユーザがその場で開発する作業ディレクトリ)
- セキュアコードが DB / cache / log / lock を置く XDG 配下 (`~/.local/share/securecode`, `~/.cache/securecode`, `~/.config/securecode`, `~/.local/state/securecode`。`XDG_*_HOME` 環境変数を設定していればそちらに追従)
- **起動ごとに作られる per-session 一時ディレクトリ** (`$TMPDIR/securecode-<timestamp>-<pid>/`)。supervisor が `TMPDIR` を上書きしてサンドボックス内のプロセスに渡すため、サンドボックス内の `os.tmpdir()` 呼び出し (Java LSP / TUI clipboard / TUI external editor 等) はすべてこの配下に閉じる。suffix は timestamp (ms) と PID の組で構成され、timestamp が PID 再利用方向の衝突を、PID が同時起動方向の衝突を構造的に防ぐため、クラッシュで残ったゴミディレクトリを後続セッションが引き継ぐことはなく、**別セッションの一時ファイルは読み書き不可**

「cwd の **外** にも書きたい」場合は `filesystem.allowWrite` に **追加で**書きます。**ベースラインは消えず、ユーザ指定分が後ろに足される加算式**なので、`allowWrite` を書いた瞬間に cwd が消える事故は起きません。

```json
{
  "filesystem": {
    "allowWrite": [
      "../shared-lib",
      "/tmp/build"
    ]
  }
}
```

逆に「cwd の中でも書かれたくないサブディレクトリがある」場合は `denyWrite` に書きます (deny が allow に優先):

```json
{
  "filesystem": {
    "denyWrite": [
      "./secrets"
    ]
  }
}
```

## per-directory 設定

プロジェクトごとに追加で許可したいドメイン / パスがある場合は、起動 cwd 直下に `./.securecode/sandbox.json` を置けます。global (`~/.config/securecode/sandbox.json`) と project の両方を読み、**allow / deny を union (重複除去) で合成** します。

```
<project root>/
  .securecode/
    sandbox.json   # ← このプロジェクトでだけ使う追加許可
```

合成ルール:

- `network.allow` / `network.deny` / `filesystem.allowRead` / `filesystem.allowWrite` / `filesystem.denyRead` / `filesystem.denyWrite` はすべて global ∪ project の union
- 同じドメインが global の deny にも project の allow にも入っている場合、sandbox-runtime 側で **deny が勝ち**ます (`deny` 優先)
- 親ディレクトリへの walk は **しません**。起動 cwd 直下の `./.securecode/sandbox.json` だけ見ます
- project の `sandbox.json` も AI からは読み書き不可 (sandbox 起動時に `denyRead` + `denyWrite` に追加される)

「このプロジェクトでだけ npm レジストリと社内 API を許可したい」のような用途に。global を汚さずに済みます。

## ありがちな引っかかり

| 症状 | 原因 | 対処 |
|---|---|---|
| `npm install` がタイムアウト | `registry.npmjs.org` がブロックされている | `sandbox.json` で許可 |
| `git push` が失敗（SSH） | SSH 接続が許可リストにない | `sandbox.json` に追加、または事前に `git push` を sandbox 外で実行 |
| `git fetch https://...` が失敗 | HTTPS ホストが許可外 | `sandbox.json` で許可 |
| プロキシ経由の社内 git が見えない | proxy ホスト名が許可されていない | `sandbox.json` に proxy を追加 |
| sandbox failed to start | bubblewrap (Linux) / Seatbelt (macOS) が無効化されている | `06-troubleshooting.md` 参照 |

## サンドボックス境界の確認

「なぜブロックされた？」のときは、`~/.config/securecode/sandbox.json` および `./.securecode/sandbox.json` の `allow` / `deny` ルールと、起動時に supervisor が stderr に出す `allowedDomains = ...` のログを直接確認してください。`--print-logs --log-level DEBUG` で詳しく見られます。

## 関連

- 設定ファイルの場所 → `04-config.md`
- 起動できないとき → `06-troubleshooting.md`
- アーキテクチャ詳細 → `docs/02-architecture.md` の Layer 1 / Layer 2 解説
