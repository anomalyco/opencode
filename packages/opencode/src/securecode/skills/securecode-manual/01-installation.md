# 01. インストール

セキュアコード のバイナリと初期設定を端末に展開する手順をまとめます。配布は Acompany 社内向け private リポジトリ経由で、`gh` CLI が必要です。

## 対応プラットフォーム

| OS | アーキ | 備考 |
|---|---|---|
| macOS | Apple Silicon (arm64), Intel (x64) | x64 は AVX2 対応 CPU 向け / `x64-baseline` 版もあり |
| Linux | x64, arm64 | glibc / musl (Alpine 等) / baseline (古い CPU) 別ビルドあり |
| Windows | x64, arm64 | x64-baseline あり |

`install` スクリプトが自動で OS / CPU / Rosetta / AVX2 / libc を判定して、適切なアーカイブを選びます。

## 事前準備

- `gh` CLI を入れて `gh auth login` 済みであること（private repo へのアクセスに必要）
- Acompany から発行された **Qwen3.6 API キー** を受け取っていること（ない場合は担当者へ依頼）
- ネットワークから `github.com` と `conf-ai.acompany-az.com` が見えること

## インストール手順

社内配布用の bootstrap スクリプトを 1 行で実行します。

```bash
gh release download -R acompany-develop/securecode --pattern install -O - | bash
```

このスクリプトは以下を行います。

1. OS と CPU を判定（Rosetta / AVX2 / musl も考慮）
2. 該当アーカイブを `gh` 経由で取得（手元キャッシュがあればそれを使う）
3. 展開して `~/.local/bin/` に `securecode`（門番）と `securecode-bin`（本体）を配置
4. シェル設定（`~/.zshrc` / `~/.bashrc` 等）に `~/.local/bin` を PATH 追加
5. 同梱の `setup/install.sh` を実行して `~/.config/securecode/` 配下に初期設定を配置

> macOS では未署名バイナリの警告を避けるため、自動で `xattr -cr` を実行して隔離属性を外します。

## インストール後の配置

```
~/.local/bin/
  securecode        # 門番 (supervisor)。ユーザーが叩く入口
  securecode-bin    # 本体 (opencode)。サンドボックス内で起動される

~/.config/securecode/
  securecode.json   # Acompany Qwen エンドポイント・モデル設定
  tui.json          # TUI 表示設定 (テーマ等)
  themes/           # 同梱テーマ
  skills/           # スキル (このマニュアルもここに入る)

~/.local/state/securecode/
  kv.json           # 起動時に読まれるユーザー状態（初期テーマ等）
```

`~/.config/securecode/` 直下の設定は **再 install しても上書きされません**（既存ファイル保持）。マニュアルなどの skill ファイルを最新版に差し替えたい場合は、該当ディレクトリを `trash` で消してから再 install してください。

## アンインストール

`securecode uninstall` サブコマンドが用意されています。配置されたバイナリと `~/.config/securecode/` を確認しながら削除します。

## 関連

- 詳しい配布パイプライン（バイナリ生成・dual publish）→ `docs/04-binary-build.md`
- 初回起動時にやること → `02-quickstart.md`
- 認証エラーが出るとき → `06-troubleshooting.md`
