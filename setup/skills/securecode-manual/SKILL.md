---
name: securecode-manual
description: Use this skill when the user asks how to install, configure, run, or troubleshoot Acompany SecureCode itself (the CLI they are currently talking through). Covers installation, first-run setup, subcommands, configuration files, sandbox behavior, API key handling, and common errors. Pick the most relevant chapter(s) from the table of contents below and read them with the Read tool from `~/.config/securecode/skills/securecode-manual/`.
---

# SecureCode マニュアル — 目次

このスキルは Acompany SecureCode の **使い方マニュアル** です。ユーザーが SecureCode 本体の操作・設定・トラブル対応について質問したときに参照してください。アプリのコードを書く依頼や、コードベースに対するレビュー依頼などには使いません（その場合はこのスキルを呼ばないでください）。

## 各章

各章は `~/.config/securecode/skills/securecode-manual/` 配下に Markdown として置かれています。ユーザーの質問に近い章を 1〜2 個選び、`Read` ツールで本文を取り出してください。

| # | ファイル | 主な内容 | こんな質問のときに開く |
|---|---|---|---|
| 01 | `01-installation.md` | インストール方法、対応 OS、`install` スクリプトの挙動 | 「どうやって入れる？」「どの OS で動く？」 |
| 02 | `02-quickstart.md` | 初回起動、API キー設定、最初のプロンプトまで | 「最初に何すればいい？」「`Hello` が動かない」 |
| 03 | `03-commands.md` | `run` / `serve` / `attach` / `agent` / `models` / `session` / `mcp` / `upgrade` 等のサブコマンド一覧 | 「`securecode <何か>` ってどう使う？」「履歴を見たい」 |
| 04 | `04-config.md` | `securecode.json` / `tui.json` / `sandbox.json` の置き場所と書き方 | 「モデルを切り替えたい」「設定の場所はどこ？」 |
| 05 | `05-sandbox.md` | 2 層防御 (Permission + Sandbox) の挙動、許可ドメイン追加、AI から見えないファイル | 「外部通信できない」「`fetch` がブロックされる」 |
| 06 | `06-troubleshooting.md` | 起動失敗・401/502・通信ブロック・upgrade 失敗・権限ダイアログ | 「エラーが出る」「動かない」 |
| 07 | `07-faq.md` | よくある質問・既知の制約・問い合わせ先 | 「データはどこに行く？」「オフラインで使える？」 |

## 推奨される使い方

1. ユーザーの質問内容を読んで、上の表から該当する章を 1〜2 個選ぶ
2. `Read("~/.config/securecode/skills/securecode-manual/XX-yyy.md")` で本文を取得する（XDG_CONFIG_HOME が設定されている環境ではそちらの配下になる）
3. **マニュアル本文を根拠として回答する。** 推測で穴埋めをしない。マニュアルに書かれていない事項は「マニュアルには明示されていない」と素直に言う
4. 質問が複数章にまたがる場合は、必要な章を全部読んでから回答を統合する

## このスキルを使わない場合

- ユーザーの依頼が「SecureCode 自身」ではなく「ユーザーのアプリ・ライブラリ・コードベース」についてのコーディング依頼の場合
- `git` / `npm` / 他の CLI ツールの使い方を聞かれたとき
- 一般的なプログラミングの質問
