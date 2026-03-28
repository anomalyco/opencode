---
title: トラブルシューティング
description: よくある問題とその解決方法。
---

OpenCode の問題をデバッグするには、まず、ディスク上に保存されているログとローカルデータを確認します。

---

## ログ

ログファイルは次の場所に書き込まれます。

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: `WIN+R` を押して `%USERPROFILE%\.local\share\opencode\log` を貼り付けます

ログファイルにはタイムスタンプ付きの名前が付けられ (例: `2025-01-09T123456.log`)、最新の 10 個のログファイルが保存されます。

`--log-level` コマンドラインオプションを使用してログレベルを設定すると、より詳細なデバッグ情報を取得できます。たとえば、`opencode --log-level DEBUG`。

---

## ストレージ

OpenCode は、セッションデータとその他のアプリケーションデータをディスク上の次の場所に保存します。

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: `WIN+R` を押して `%USERPROFILE%\.local\share\opencode` を貼り付けます

このディレクトリには次のものが含まれます。

- `auth.json` - API キー、OAuth トークンなどの認証データ
- `log/` - アプリケーションログ
- `project/` - セッションデータやメッセージデータなどのプロジェクト固有のデータ
  - プロジェクトが Git リポジトリ内にある場合は、`./<project-slug>/storage/` に保存されます
  - Git リポジトリではない場合は、`./global/storage/` に保存されます

---

## デスクトップアプリ

OpenCode Desktop は、ローカル OpenCode サーバー (`opencode-cli` サイドカー) をバックグラウンドで実行します。ほとんどの問題は、誤動作しているプラグイン、破損したキャッシュ、または不正なサーバー設定によって発生します。

### クイックチェック

- アプリを完全に終了して再起動します。
- アプリにエラー画面が表示された場合は、**再起動** をクリックしてエラーの詳細をコピーします。
- macOS のみ: `OpenCode` メニュー -> **Webview をリロード** (UI が空白またはフリーズしている場合に役立ちます)。

---

### プラグインを無効にする

デスクトップアプリが起動時にクラッシュしたり、ハングしたり、異常な動作をしたりする場合は、まずプラグインを無効にしてください。

#### グローバル設定の確認

グローバル設定ファイルを開き、`plugin` キーを探します。

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (または `~/.config/opencode/opencode.json`)
- **macOS/Linux** (古いインストール): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: `WIN+R` を押して `%USERPROFILE%\.config\opencode\opencode.jsonc` を貼り付けます

プラグインを構成している場合は、キーを削除するか空の配列に設定して、プラグインを一時的に無効にします。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### プラグインディレクトリの確認

OpenCode はディスクからローカルプラグインをロードすることもできます。これらを一時的に邪魔にならない場所に移動し (またはフォルダーの名前を変更し)、デスクトップアプリを再起動します。

- **グローバルプラグイン**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: `WIN+R` を押して `%USERPROFILE%\.config\opencode\plugins` を貼り付けます
- **プロジェクトプラグイン** (プロジェクトごとの構成を使用する場合のみ)
  - `<your-project>/.opencode/plugins/`

アプリが再び動作し始めた場合は、プラグインを 1 つずつ再度有効にして、問題の原因となっているプラ​​グインを特定します。

---

### キャッシュをクリアする

プラグインを無効にしても解決しない場合 (またはプラグインのインストールが停止した場合)、OpenCode がキャッシュを再構築できるようにキャッシュをクリアします。

1. OpenCode Desktop を完全に終了します。
2. キャッシュディレクトリを削除します。

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/.cache/opencode` を貼り付け
- **Linux**: `~/.cache/opencode` を削除します (または `rm -rf ~/.cache/opencode` を実行します)。
- **Windows**: `WIN+R` を押して `%USERPROFILE%\.cache\opencode` を貼り付けます

3. OpenCode デスクトップを再起動します。

---

### サーバー接続の問題の修正

OpenCode Desktop は、独自のローカルサーバー (デフォルト) を起動することも、構成したサーバー URL に接続することもできます。

**「接続に失敗しました」** ダイアログが表示された場合 (またはアプリがスプラッシュ画面を通過できない場合)、カスタムサーバー URL を確認してください。

#### デスクトップのデフォルトのサーバー URL をクリアします

ホーム画面でサーバー名 (ステータスドット付き) をクリックしてサーバーピッカーを開きます。 [**デフォルトサーバー**] セクションで、[**クリア**] をクリックします。

#### 設定から `server.port` / `server.hostname` を削除します

`opencode.json(c)` に `server` セクションが含まれている場合は、それを一時的に削除し、デスクトップアプリを再起動します。

#### 環境変数を確認する

環境に `OPENCODE_PORT` が設定されている場合、デスクトップアプリはローカルサーバーにそのポートを使用しようとします。

- `OPENCODE_PORT` の設定を解除して (または空きポートを選択して)、再起動します。

---

### Linux: Wayland / X11 の問題

Linux では、一部の Wayland セットアップにより、空白のウィンドウやコンポジターエラーが発生する可能性があります。

- Wayland を使用していて、アプリが空白またはクラッシュしている場合は、`OC_ALLOW_WAYLAND=1` で起動してみてください。
- これにより状況が悪化する場合は、それを削除し、代わりに X11 セッションで起動してみてください。

---

### Windows: WebView2 ランタイム

Windows では、OpenCode Desktop には Microsoft Edge **WebView2 ランタイム**が必要です。アプリが空白のウィンドウで開くか、起動しない場合は、WebView2 をインストールまたは更新して、もう一度試してください。

---

### Windows: 一般的なパフォーマンスの問題

Windows でパフォーマンスの低下、ファイルアクセスの問題、またはターミナルの問題が発生している場合は、[WSL (Windows Subsystem for Linux)](/docs/windows-wsl) を使用してみてください。 WSL は、OpenCode の機能とよりシームレスに連携する Linux 環境を提供します。

---

### 通知が表示されない

OpenCode Desktop では、次の場合にのみシステム通知が表示されます。

- OS 設定で OpenCode の通知が有効になっており、
- アプリウィンドウにフォーカスがありません。

---

### デスクトップアプリのストレージのリセット (最後の手段)

アプリが起動せず、UI 内から設定をクリアできない場合は、デスクトップアプリの保存された状態をリセットします。

1. OpenCode デスクトップを終了します。
2. これらのファイルを見つけて削除します (これらのファイルは OpenCode デスクトップアプリのデータディレクトリにあります)。

- `opencode.settings.dat` (デスクトップのデフォルトサーバー URL)
- `opencode.global.dat` および `opencode.workspace.*.dat` (最近のサーバー/プロジェクトなどの UI 状態)

ディレクトリをすばやく見つけるには:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (その後、上記のファイル名を検索します)
- **Linux**: 上記のファイル名を `~/.local/share` で検索します。
- **Windows**: `WIN+R` -> `%APPDATA%` を押します (その後、上記のファイル名を検索します)。

---

## ヘルプを求める

OpenCode で問題が発生している場合:

1. **GitHub で問題を報告してください**

バグを報告したり、機能をリクエストしたりする最良の方法は、GitHub リポジトリを使用することです。

[**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

新しい問題を作成する前に、既存の問題を検索して、問題がすでに報告されているかどうかを確認してください。

2. **Discord への参加**

リアルタイムのヘルプやコミュニティのディスカッションについては、Discord サーバーに参加してください。

[**opencode.ai/discord**](https://opencode.ai/discord)

---

## よくある問題

ここでは、いくつかの一般的な問題とその解決方法を示します。

---

### OpenCode が起動しない

1. ログでエラーメッセージを確認する
2. `--print-logs` で実行して、ターミナルに出力を確認してください。
3. `opencode upgrade` を含む最新バージョンを使用していることを確認してください

---

### 認証の問題

1. TUI で `/connect` コマンドを使用して再認証を試みます
2. API キーが有効であることを確認してください
3. ネットワークでプロバイダーの API への接続が許可されていることを確認してください

---

### モデルが見つからない

1. プロバイダーで認証されていることを確認してください
2. 構成内のモデル名が正しいことを確認してください
3. 一部のモデルでは、特定のアクセスまたはサブスクリプションが必要な場合があります

`ProviderModelNotFoundError` が表示された場合は、間違いがある可能性が高くなります。
どこかのモデルを参照しています。
モデルは次のように参照する必要があります: `<providerId>/<modelId>`

例:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

どのモデルにアクセスできるかを確認するには、`opencode models` を実行します。

---

### ProviderInitError

ProviderInitError が発生した場合は、構成が無効または破損している可能性があります。

これを解決するには:

1. まず、[プロバイダーガイド](/docs/providers) に従って、プロバイダーが正しく設定されていることを確認します。
2. 問題が解決しない場合は、保存されている構成をクリアしてみてください。

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   Windows では、`WIN+R` を押して、`%USERPROFILE%\.local\share\opencode` を削除します。

3. TUI の `/connect` コマンドを使用して、プロバイダーで再認証します。

---

### AI_APICallError とプロバイダーパッケージの問題

API 呼び出しエラーが発生した場合は、プロバイダーパッケージが古いことが原因である可能性があります。 OpenCode は、必要に応じてプロバイダーパッケージ (OpenAI、Anthropic、Google など) を動的にインストールし、ローカルにキャッシュします。

プロバイダーパッケージの問題を解決するには:

1. プロバイダーパッケージのキャッシュをクリアします。

   ```bash
   rm -rf ~/.cache/opencode
   ```

   Windows では、`WIN+R` を押して、`%USERPROFILE%\.cache\opencode` を削除します。

2. OpenCode を再起動して最新のプロバイダーパッケージを再インストールします

これにより、OpenCode はプロバイダーパッケージの最新バージョンを強制的にダウンロードすることになり、多くの場合、モデルパラメーターや API の変更に関する互換性の問題が解決されます。

---

### Linux ではコピー/ペーストが機能しない

Linux ユーザーがコピー/ペースト機能を動作させるには、次のクリップボードユーティリティのいずれかがインストールされている必要があります。

**X11 システムの場合:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Wayland システムの場合:**

```bash
apt install -y wl-clipboard
```

**ヘッドレス環境の場合:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

OpenCode は、Wayland を使用していて `wl-clipboard` を優先しているかどうかを検出します。そうでない場合は、`xclip` および `xsel` の順序でクリップボードツールを検索しようとします。
