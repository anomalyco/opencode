# Acompany Secure Code

機密ソースコードを漏洩させずに AI コーディング支援を実現する、Acompany のセキュアなコーディングエージェントです。
2026年3月13日に、Confidential AI Suite の第二弾製品としてベータ版の提供を開始しました。

[![Acompany Secure Code top screen](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

[リリース文](https://prtimes.jp/main/html/rd/p/000000128.000046917.html) | [お問い合わせ](https://www.acompany.tech/contact) | [English README](./README.en.md)

## 概要

Acompany Secure Code は、機密ソースコードを Confidential Computing 環境に送信し、秘匿化された実行領域で LLM 推論を行うことで、インフラ事業者やモデル提供者を含む第三者から処理中データを見えなくしたまま AI コーディング支援を提供します。

企業の機密コードを扱う開発組織でも、既存のターミナル中心のワークフローを崩さずに、コード生成、レビュー、リファクタリング、バグ修正、テスト生成を進められることを狙っています。

## 主な特長

- 機密コードの保護: Trusted Execution Environment 上で推論を実行し、ソースコードの入出力と LLM 処理を保護します。
- 開発フローとの親和性: ターミナル中心の操作性を維持しながら、日常的な実装作業にそのまま組み込めます。
- 監査対応: AI 利用ログを記録、可視化し、誰がいつどのコードベースで AI を使ったかを追跡できます。
- 利用モデル: GPT-OSS、Qwen3.5、Qwen3-Coder-Next などのオープンウェイト LLM を利用できます。

## 画面イメージ

### トップ画面

![Acompany Secure Code home screen](github/assets/top-secure-code.png)

### モデル選択

![Acompany Secure Code model picker](github/assets/models-secure-code.png)

## デモ動画

[![Acompany Secure Code demo video](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

- [YouTube で見る](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)
- クリックで、トップ画面から実際のコーディング支援フローまで確認できます。

## インストール

最新版の CLI バイナリは [GitHub Releases](https://github.com/acompany-develop/securecode/releases) から取得できます。

- macOS Apple Silicon: `securecode-darwin-arm64.zip`
- macOS Intel: `securecode-darwin-x64.zip`
- Linux x86_64: `securecode-linux-x64.tar.gz`
- Linux ARM64: `securecode-linux-arm64.tar.gz`
- Windows x86_64: `securecode-windows-x64.zip`
- Windows ARM64: `securecode-windows-arm64.zip`

補足:

- `*-baseline` は AVX2 非対応 CPU 向けです。
- `*-musl` は Alpine Linux 向けです。

macOS / Linux:

```bash
# 例: Linux x86_64
tar -xzf securecode-linux-x64.tar.gz
chmod +x securecode
mkdir -p ~/.local/bin
mv securecode ~/.local/bin/securecode
export PATH="$HOME/.local/bin:$PATH"
```

```bash
# 例: macOS Apple Silicon
unzip securecode-darwin-arm64.zip
chmod +x securecode
mkdir -p ~/.local/bin
mv securecode ~/.local/bin/securecode
export PATH="$HOME/.local/bin:$PATH"
```

Windows:

```powershell
Expand-Archive .\securecode-windows-x64.zip -DestinationPath .
$env:Path += ";$PWD"
.\securecode.exe run "hello"
```

前提:

- `git` を PATH に入れてください。
- `ripgrep` が入っていると検索系の体験が安定します。

## 接続先モデルの設定

設定ファイル名は upstream 互換性のため `opencode.json` のままです。プロジェクト直下か `~/.config/opencode/opencode.json` に置けます。

1. 接続先 provider の API キーを環境変数に設定します。

```bash
export OPENAI_API_KEY="your-api-key"
```

2. 利用可能な model ID を確認します。

```bash
securecode models openai --refresh
```

3. `opencode.json` を作成して既定 model を固定します。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}"
      }
    }
  },
  "model": "openai/gpt-5.2",
  "small_model": "openai/gpt-5.2-mini"
}
```

OpenAI 互換 endpoint を使う場合は `baseURL` を追加してください。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://your-gateway.example.com/v1"
      }
    }
  },
  "model": "openai/gpt-5.2"
}
```

## 利用方法

単発で使う:

```bash
securecode run "Summarize the current repository structure"
```

model を都度切り替える:

```bash
securecode run -m openai/gpt-5.2 "Review auth.ts for security issues"
```

ファイルを添付する:

```bash
securecode run -f README.md -f src/auth.ts "Explain the auth flow and list risks"
```

認証状態を確認する:

```bash
securecode providers list
```

## ローカル開発

このリポジトリは upstream の release tag を取り込みながら Acompany Secure Code 向けの変更を重ねる fork です。内部 package 名や一部コマンド名には upstream 互換性のため旧名が残っていますが、公開面のブランドは Secure Code に揃えています。

```bash
bun install
bun run guard:upstream
./run-securecode.sh /path/to/your/repository
```

UI を個別に確認する場合:

```bash
bun run dev:web
bun run dev:desktop
```

upstream 追従方針は [specs/upstream-sync.md](./specs/upstream-sync.md) を参照してください。

## コントリビュート

開発フローやレビュー前提は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 関連リンク

- 製品サイト: https://www.acompany.tech/
- お問い合わせ: https://www.acompany.tech/contact
- プレスリリース: https://prtimes.jp/main/html/rd/p/000000128.000046917.html
