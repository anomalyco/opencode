# Acompany SecreCode

機密ソースコードを漏洩させずに AI コーディング支援を実現する、Acompany のセキュアなコーディングエージェントです。
2026年3月13日に、Confidential AI Suite の第二弾製品としてベータ版の提供を開始しました。

[![Acompany SecreCode top screen](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

[リリース文](https://prtimes.jp/main/html/rd/p/000000128.000046917.html) | [お問い合わせ](https://www.acompany.tech/contact) | [English README](./README.en.md)

## 概要

Acompany SecreCode は、機密ソースコードを Confidential Computing 環境に送信し、秘匿化された実行領域で LLM 推論を行うことで、インフラ事業者やモデル提供者を含む第三者から処理中データを見えなくしたまま AI コーディング支援を提供します。

企業の機密コードを扱う開発組織でも、既存のターミナル中心のワークフローを崩さずに、コード生成、レビュー、リファクタリング、バグ修正、テスト生成を進められることを狙っています。

## 主な特長

- 機密コードの保護: Trusted Execution Environment 上で推論を実行し、ソースコードの入出力と LLM 処理を保護します。
- 開発フローとの親和性: ターミナル中心の操作性を維持しながら、日常的な実装作業にそのまま組み込めます。
- 監査対応: AI 利用ログを記録、可視化し、誰がいつどのコードベースで AI を使ったかを追跡できます。
- 利用モデル: GPT-OSS、Qwen3.5、Qwen3-Coder-Next などのオープンウェイト LLM を利用できます。

## 画面イメージ

### トップ画面

![Acompany SecreCode home screen](github/assets/top-secure-code.png)

### モデル選択

![Acompany SecreCode model picker](github/assets/models-secure-code.png)

## デモ動画

[![Acompany SecreCode demo video](https://img.youtube.com/vi/QCwp4IbuP2I/maxresdefault.jpg)](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)

- [YouTube で見る](https://youtu.be/QCwp4IbuP2I?si=Qx4Za7sfdluWB0Ca)
- クリックで、トップ画面から実際のコーディング支援フローまで確認できます。

## インストール

最新版の CLI バイナリは [GitHub Releases](https://github.com/acompany-develop/securecode/releases) から取得できます。

- macOS Apple Silicon: `SecreCode-darwin-arm64.zip`
- macOS Intel: `SecreCode-darwin-x64.zip`
- Linux x86_64: `SecreCode-linux-x64.tar.gz`
- Linux ARM64: `SecreCode-linux-arm64.tar.gz`
- Windows x86_64: `SecreCode-windows-x64.zip`
- Windows ARM64: `SecreCode-windows-arm64.zip`

補足:

- `*-baseline` は AVX2 非対応 CPU 向けです。
- `*-musl` は Alpine Linux 向けです。

macOS / Linux:

```bash
# 例: Linux x86_64
tar -xzf SecreCode-linux-x64.tar.gz
chmod +x SecreCode
mkdir -p ~/.local/bin
mv SecreCode ~/.local/bin/SecreCode
export PATH="$HOME/.local/bin:$PATH"
```

```bash
# 例: macOS Apple Silicon
unzip SecreCode-darwin-arm64.zip
chmod +x SecreCode
mkdir -p ~/.local/bin
mv SecreCode ~/.local/bin/SecreCode
export PATH="$HOME/.local/bin:$PATH"
```

Windows:

```powershell
Expand-Archive .\SecreCode-windows-x64.zip -DestinationPath .
$env:Path += ";$PWD"
.\SecreCode.exe run "hello"
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
SecreCode models openai --refresh
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
SecreCode run "Summarize the current repository structure"
```

model を都度切り替える:

```bash
SecreCode run -m openai/gpt-5.2 "Review auth.ts for security issues"
```

ファイルを添付する:

```bash
SecreCode run -f README.md -f src/auth.ts "Explain the auth flow and list risks"
```

認証状態を確認する:

```bash
SecreCode providers list
```

## ローカル開発

このリポジトリは upstream の release tag を取り込みながら Acompany SecreCode 向けの変更を重ねる fork です。内部 package 名や一部互換用設定名には旧名が残っていますが、公開面のブランドは SecreCode に揃えています。

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
