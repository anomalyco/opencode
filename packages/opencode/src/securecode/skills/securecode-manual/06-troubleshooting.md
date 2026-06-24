# 06. トラブルシュート

エラー別の切り分け表です。まず症状を探して、当てはまる節を読んでください。

## 起動できない

### `sandbox failed to start` / `failed to enter sandbox`

OS のサンドボックス機構が動かせない状態。

- macOS: `sandbox-exec` を SIP が無効化しているか、企業 MDM で制限されている可能性。`csrutil status` で確認
- Linux: bubblewrap (`bwrap`) がインストールされていない / setuid されていない。`which bwrap` を確認
- コンテナ内 (Docker): 多重サンドボックスは原則非対応。ホスト側で起動するか、特権コンテナで起動

> セキュリティ設計上、サンドボックスを準備できない環境では **起動を拒否（fail-closed）** します。「サンドボックスを切って動かす」というオプションは意図的に提供していません。

### `SECURECODE_QWEN3_API_KEY` is not set

環境変数未設定。

```bash
export SECURECODE_QWEN3_API_KEY="<your-key>"
```

シェル設定（`~/.zshrc` 等）に書いた場合は新しい端末を開き直すか `source` する。

### `command not found: securecode`

PATH が通っていない。`install` スクリプトが `~/.local/bin` を追記しているはず。

```bash
echo $PATH | tr ':' '\n' | grep '.local/bin'
# 出てこなければ:
export PATH="$HOME/.local/bin:$PATH"
```

## 認証エラー

### 401 / Unauthorized

API キーが無効 or 期限切れ。

- typo がないか確認（前後の空白・改行・引用符）
- Acompany 担当者にキー再発行を依頼

### 502 / Bad Gateway

Acompany endpoint 側の一時的な不調か、ネットワーク経路の問題。

- 数分待って再試行
- 解消しなければ Acompany 担当者へ
- 同時に `~/.config/securecode/sandbox.json` で `conf-ai.acompany-az.com` がブロックされていないかも確認

## 通信が遮断される

### `npm install` / `git fetch` / `curl` が失敗

サンドボックスが許可ドメイン外を遮断しているのが原因。global (`~/.config/securecode/sandbox.json`) か project (`./.securecode/sandbox.json`) のどちらかで許可ドメインを追加（`05-sandbox.md` 参照）。プロジェクト固有のホストなら project 側に書くのがおすすめ。

### 社内 proxy 経由でしか出られない

`HTTPS_PROXY` / `HTTP_PROXY` を環境変数で渡しつつ、`sandbox.json` に proxy ホスト名を追加してください。

### `sandbox.json` を編集したのに反映されない

セッション起動中に `sandbox.json` を編集したら、TUI 内で `/reload_sandbox` を実行してください。会話履歴を保ったまま新しい設定で再起動します。詳細は `05-sandbox.md`。

`/reload_sandbox` の実行後にエラートーストで「sandbox.json の parse に失敗しました」と出る場合、書いた JSON が壊れています。旧設定がそのまま維持されているので、JSON を直してもう一度 `/reload_sandbox` を叩いてください。

## 権限ダイアログが多すぎる

破壊的操作の頻度が高いタスクでは確認が連続します。

- そのセッション中だけ許可: ダイアログ内の `allow always for this session`
- 永続許可（強く非推奨）: `securecode.json` の permission セクションで上書き

確認頻度を減らすために **Layer 1 を緩めると Layer 2 だけが頼り** になります。バランスを見て選んでください。

## 最新版に更新したい

SecureCode は専用の upgrade サブコマンドを持ちません。初回インストールと同じ手順で再 install してください。

```bash
gh release download -R acompany-develop/securecode --pattern install -O - | bash
```

このとき以下を確認:

```bash
gh auth status
```

で認証が生きていること。失効していたら `gh auth login` し直し。`gh release list -R acompany-develop/securecode` で配布が見えるかも確認。

## ログを取りたい

`--print-logs --log-level DEBUG` を付けて TUI を起動するとログが stderr に流れます。

```bash
securecode --print-logs --log-level DEBUG
```

問題切り分け時はログを Acompany 担当者へ添付してください。**ログ内に API キーや機密ファイル内容が含まれていないか必ず確認**してから共有を。

## それでも解決しないとき

- 同梱 `docs/` の対応章を読む（`docs/02-architecture.md` で全体像、`docs/03-hooks.md` で内部挙動）
- Acompany 担当者へ症状・コマンド・ログを添えて連絡

## 関連

- インストール手順 → `01-installation.md`
- サンドボックス挙動 → `05-sandbox.md`
- FAQ → `07-faq.md`
