export default {
  label: "SSH",
  placeholder: "ssh user@example.com",
  add: "SSHサーバーを追加",
  "server.menu.label": "SSHサーバー",
  target: "ホストまたはSSHコマンド",
  connect: "接続",
  connectTo: "{{host}} に接続",
  authenticate: "SSH認証",
  "session.disconnected": "SSH接続が非アクティブです",
  "session.connecting": "SSHサーバーに接続中",
  "session.reconnectDescription":
    "このセッションを表示して作業を続行するには再接続してください。リモートセッションは保存されています。",
  "session.reconnect": "再接続",
  trust: "信頼して接続",
  continue: "続行",
  update: "更新して再接続",
  project: "{{host}}でプロジェクトを開く",
  "stage.incompatible": "サーバーの更新が必要です",
  "error.input":
    "ホストまたはSSH接続コマンドを入力してください。リモートコマンドおよびサポートされていないSSHオプションは許可されていません。",
  "error.connection": "SSH接続を確立できませんでした。ネットワークとSSHの設定を確認してください。",
  "error.platform":
    "このリモートプラットフォームはサポートされていません。自動セットアップには現在、x64 または arm64 の Linux か macOS が必要です。",
  "error.version": "接続する前に、リモートサービスがこのデスクトップバージョンと一致している必要があります。",
  "error.install":
    "リモートサーバーをインストールできませんでした。接続状況、ディスク容量、tar がインストールされているかを確認してください。",
  "error.unpublished":
    "このデスクトップバージョンには公開されたリモートサーバーがありません。開発ビルドの場合、ホストに V2 をインストールして起動してから再試行してください。",
  "error.service": "SSH は接続されましたが、OpenCode サーバーが準備できませんでした。",
  "error.host-key":
    "ホストの識別情報を確認できませんでした。SSH の既知ホストを更新する前に、フィンガープリントを確認してください。",
  "error.ssh-missing":
    "OpenSSH が見つかりません。OpenSSH クライアントをインストールし、ssh が PATH 上で利用できることを確認してください。",
  "action.authenticate": "認証",
  "stage.connecting": "SSHで接続中…",
  "stage.authentication": "認証が必要です",
  "form.name": "サーバー名 (オプション)",
  "form.namePlaceholder": "Localhost",
  "form.add": "サーバーを追加",
  "menu.delete": "削除",
}
