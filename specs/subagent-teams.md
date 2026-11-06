# サブエージェントチーム & メッセージング仕様

- ステータス: 確定(実装前最終版)
- ブランチ: `v2-custom`(spellsa/opencode)
- 関連: v1フォーク(`v1-custom`ブランチ)の`message_to_parent`実装の後継

## 1. 目的

- v2のサブエージェント周りをv1フォークの使い勝手に戻す(ユーザー→サブエージェントへの直接メッセージ等)
- サブエージェント同士の直接通信(親を経由しない)を実現する
- チーム単位の自律的な協調作業を可能にする(親は指示を1回投げて待つ形)

## 2. スコープ

### やること

1. taskツール(subagentツール)の変更
   - `team`パラメータの追加
   - 再アタッチ(sessionID継続)パラメータの削除
   - 完全background化(`background`パラメータ自体を削除)
2. `message_to_peer`ツールの新設(唯一の通信ツール)
3. `team_roster`ツールの新設(動的名簿取得)
4. チーム名簿(roster)管理とシステムプロンプトへのルール注入

### やらないこと(明示的に外す)

- 黒板(共有メモ/共有スクラッチパッド)— 後日
- チーム停止(stall)の検知 — 後日。既存のsteer(親からの進捗確認)で代替可能
- foreground実行 — スキーマから削除。内部コードは上流マージ容易性のため残置
- 名前のリネーム — 非対応
- メンバーによる子のspawn — 非対応(spawnはBossのみ)
- メッセージ洪水への構造的制御 — プロンプト誘導のみ

## 3. 基本モデル

### 3.1 セッションとチーム

- メインセッション = **Boss**
- taskツールでspawnされた子 = サブエージェント
- **チームなしspawn**(パラメータ指定なし)= 従来型サブエージェント
  - v2の既存動作を**一切変更しない**(完了時の結果通知・既存の出力文面も現状のまま)
- **チームspawn**(`team`パラメータ指定)= チーム参加
  - チームは`(親セッション, teamID)`で識別
  - **同じ`(親, teamID)`で最初にspawnされた子がleader、以降がmember**(自動割り当て。指定不可)

### 3.2 役割と可視性(名簿)

| 立場 | 名簿に見える相手 | Bossへの送信 |
|---|---|---|
| Boss(親) | 自分のチームの全メンバー(全チーム) | —(返信はpeerツールで可能) |
| leader | チーム全員 **+ Boss** | 可(唯一) |
| member | チーム全員(leader含む) | 不可(名簿に載っていないため) |

- 可視性は**ツールの制限ではなく名簿の内容**で制御する

### 3.3 名前

- 名前は **`<teamID>-<採番>`**。チームごとのspawn順で採番する(例: チーム`survey`の1体目→`survey-1`)
- **teamIDはkebab-case**(小文字英数字とハイフン)。spawn時にバリデーションし、不正はエラーで拒否する(§5.3.2)
- teamIDが一意なので、チーム内採番のままでBoss配下全体の名前が一意になる(宛先の曖昧さが構造的に発生しない)
- 名前はラベルであり、タスク領域の意味は持たせない
- チーム内でユニーク。宛先の名前解決はランタイムが名簿で行う(ツールパラメータはセッションIDを受け付けない)

### 3.4 完了概念

- **チーム子セッションには親向けの完了通知を発行しない**
- 通信はメッセージ一本。報告メッセージそのものが親への信号
- セッションのrunning/idle状態は残る(TUI表示・wake判定用)
- チームspawnは**常にbackground**(即座にtask_idを返す)
- 単発spawn(チームなし)は既存どおり:完了時に結果が親へ通知される

### 3.5 チームフロー(3段階)

1. **作成**: Bossがtaskツールでdormantメンバーを作成(セッション作成+名簿登録のみ。誰も実行しない)
2. **起こし**: Bossが`message_to_peer(to: "<leader名>")`でミッションを送る → leaderが目覚める
3. **分担**: leaderが`message_to_peer`でメンバーに指示を配る → 各memberはそのメッセージで目覚めて作業開始。結果はleaderへ集約 → leaderがBossへ報告

- 名簿が完全に確定してから誰も動き出さないため、レースが構造的に発生しない
- leader指定の作成順ズレは実害なし(Bossはspawn戻り値の名簿を見て実際のleaderに起こしかけするだけ)
- memberの「初期指示」はleaderからのメッセージそのもの(保存promptの配信機構は不要)

## 4. ツール仕様

### 4.1 taskツール(v2のsubagentツール)

```
パラメータ:
  agent: string       (既存・変更なし)
  description: string (既存・変更なし)
  prompt: string      (optional化。組み合わせで必須/禁止を切替)
  team?: string       ← 新設。チームID
  (sessionID継続 → 削除)
  (background → 削除。常にbackground)
```

| `team` | `prompt` | 動作 |
|---|---|---|
| なし | 必須 | 従来型:即実行、完了時に親へ結果通知 |
| あり | なし | **dormant作成**:セッション作成+名簿登録のみ。誰も実行しない |
| あり | あり | エラー(§5.5の文面) |

- 動作: 新規spawn専用。既存セッションへの再アタッチは不可(フォローアップはすべて`message_to_peer`)
- チームフローは3段階(§3.5): Bossがdormantメンバーを作成 → Bossが`message_to_peer`でleaderを起こす → leaderがメンバーに指示を配る(メンバーはそのメッセージで目覚める)
- チームspawn時の完了待ちは不可能(常にbackgroundのため構造的に発生しない)

### 4.2 message_to_peerツール(新設・唯一の通信ツール)

- 所持者:
  - Boss: 自分のチームのメンバー宛(全チーム)
  - leader: Boss + チームメンバー宛
  - member: チームメンバー(leader含む)宛
- 送信先が名簿にない場合 → エラー + 現行の名簿を返す
- 動作: **ノンブロッキング**。受信側のinboxに合成メッセージを投入
  - 受信側が実行中 → steer(ステップ境界で割り込み)
  - 受信側が待機中 → wakeで自動的に起こされる

### 4.3 team_rosterツール(新設)

- 所持者: チーム参加者全員(Boss含む)
- 戻り値: **現在の**チーム名簿(名前・role、leaderにはBossを含む)
- 名簿は時間とともに育つため、システムプロンプトに名簿を固定注入せず、常にこのツールで取得させる

## 5. 全文字列一覧(★LLM/ユーザーに見えるすべて★)

> 備考: 「既存流用」とあるものはv2の現行文字列をそのまま使う。それ以外は新規ドラフト。
> 日本語訳は参考表示(実装は英語のまま)。

### 5.1 taskツールの説明文(ツールリストに表示される)

**原文(ドラフト・要確認):**

```
Spawns an agent in a child session to work on the specified task. Runs in
the background and returns immediately.
Plain spawns notify you automatically when the subagent finishes.
Team spawns (team=...) do not notify on completion: teammates communicate
by message instead (see message_to_peer).
Do not sleep, poll for progress, or duplicate its work. If you need a
status update from a team, message it with message_to_peer instead of
waiting. Work on non-overlapping tasks, or briefly tell the user what you
launched and end your response.
```

**日本語訳:**

```
指定タスクをこなすために子セッションにエージェントをspawnします。バックグラウンドで
実行され、即座に戻ります。
チーム指定なしのspawnは、サブエージェントの完了時に自動で通知されます。
チームspawn(team=...)は完了時の通知を行いません:メンバー同士はメッセージで通信します
(message_to_peerを参照)。
スリープ、進捗のポーリング、作業の重複実行はしないでください。チームの状況を知りたい
場合は待たずにmessage_to_peerでメッセージを送ってください。重複しないタスクを進める
か、何を起動したかをユーザーに簡単に伝えて応答を終えてください。
```

### 5.2 taskツールのパラメータ説明

| パラメータ | 原文 | 日本語訳 |
|---|---|---|
| `agent` | 既存流用: `The type of specialized agent to use for this task` | このタスクに使う専門エージェントの種類 |
| `description` | 既存流用: `A short 3-5 word label for the task, displayed to the user` | タスクの短いラベル(3〜5語)。ユーザーに表示される |
| `prompt` | 変更: `The task for the subagent to perform. Required for plain spawns; must be omitted for team spawns (the leader assigns work via message_to_peer).` | サブエージェントに実行させるタスク。単発spawnでは必須。チームspawnでは指定しない(仕事はleaderがmessage_to_peerで割り当てる) |
| `team`(新設) | 確定(案C): `Spawn this subagent into a team identified by this id. Team members share a roster and can message each other with message_to_peer; the first spawn becomes the team's leader and the only member that can message you. Use this when several subagents need to coordinate instead of reporting back independently. Team ids must be kebab-case.` | このIDで識別されるチームにサブエージェントをspawnします。チームメンバーは名簿を共有し、message_to_peerで相互通信できます。最初のspawnがleaderとなり、あなた(Boss)にメッセージを送れる唯一のメンバーになります。複数のサブエージェントに個別報告ではなく協調させたいときに使ってください。チームIDはkebab-caseで指定してください |
### 5.3.1 team+prompt誤用のエラー文面

```
Team spawns start dormant: the prompt is not executed at spawn time.
The leader assigns work to members via message_to_peer. Omit "prompt"
for team spawns.
```

**日本語訳(参考):**

```
チームspawnは待機状態で作成されます:promptはspawn時には実行されません。
leaderがmessage_to_peerでメンバーに仕事を割り当てます。チームspawnでは
"prompt"を省略してください。
```

### 5.3.2 チームID不正のエラー文面

**原文(確定):**

```
Invalid team id "<teamID>": team ids must be kebab-case
(lowercase letters, digits, and hyphens).
```

**日本語訳(参考):**

```
無効なチームID "<teamID>":チームIDはkebab-case(小文字英数字とハイフン)で
指定してください。
```

- kebab-caseの説明は通常のパラメータ説明文には含めず、エラー時にのみ展開する(kebab-case自体はLLMにとって確実な定番語であり、解釈の揺れはエラー+リトライで自己修正される)

### 5.3 taskツールの戻り値

leaderのとき:

```
Spawned <name> (leader) in team <teamID> (sessionID: <id>).
Dormant: no work has started yet. Wake the leader with message_to_peer to
begin.
The leader is the only team member that can message you (as "Boss").
Members communicate with each other via message_to_peer.
```

memberのとき:

```
Spawned <name> (member) in team <teamID> (sessionID: <id>).
Dormant: no work has started yet.
```

**日本語訳(参考):**

```
<name>(leader)をチーム<teamID>にspawnしました(sessionID: <id>)。
待機状態です:まだ何も開始していません。message_to_peerでleaderを起こして開始
してください。
leaderはあなた(名前は"Boss")にメッセージを送れる唯一のチームメンバーです。
メンバー同士はmessage_to_peerで通信します。
```

```
<name>(member)をチーム<teamID>にspawnしました(sessionID: <id>)。
待機状態です:まだ何も開始していません。
```

- 単発spawn(チームなし)の戻り値は**既存流用**(変更なし)

### 5.4 message_to_peerツールの説明文

**原文(ドラフト・要確認):**

```
Sends a message to an entry of your current team roster. The message is
delivered while the recipient is running (at its next step boundary) or
wakes it up if it is idle.
You can only message entries in your roster. Call team_roster to see who
is available.
```

**日本語訳:**

```
現行のチーム名簿に載っている相手にメッセージを送ります。受信側が実行中なら次の
ステップ境界で届き、待機中なら自動的に起こされます。
名簿に載っている相手にのみ送信できます。利用可能な相手はteam_rosterで確認して
ください。
```

パラメータ説明:

| パラメータ | 原文(ドラフト) | 日本語訳 |
|---|---|---|
| `to` | `Recipient name from your current team roster (for example "test-1" or "Boss").` | 現行のチーム名簿に載っている受信者名(例: "test-1" または "Boss") |
| `text` | `The message to send.` | 送信するメッセージ本文 |

### 5.5 message_to_peerの出力・エラー文

成功時(新規ドラフト):

```
Message sent to <name>.
```

宛先不明エラー(新規ドラフト):

```
No roster entry named "<to>". Current roster:
- test-1 (leader) — the only member who can message Boss
- test-2 (member)
...
```

**日本語訳(参考):**

```
"<to>"という名前の名簿エントリはありません。現行の名簿:
- test-1 (leader) — Bossにメッセージを送れる唯一のメンバー
- test-2 (member)
...
```

### 5.6 team_rosterツールの説明文

**原文(ドラフト・要確認):**

```
Shows your current team roster: member names and roles. The leader is the
only member that can message Boss; the leader's roster also includes Boss.
```

**日本語訳:**

```
現行のチーム名簿を表示します:メンバーの名前と役割。leaderはBossにメッセージを
送れる唯一のメンバーで、leaderの名簿にはBossも含まれます。
```

出力形式(新規ドラフト):

member/leaderが呼んだ場合(自分のチーム1件)。呼び出し者自身のエントリには`— you`を付ける:

```
Team <teamID>:
- test-1 (leader) — the only member who can message Boss — you
- test-2 (member)
- test-3 (member)
```

leaderが呼んだ場合(上記に追加):

```
- Boss — your manager; only you (the leader) can message it
```

Bossが呼んだ場合(**全チームをグループ化して返す**。§5.6複数チーム対応=(a)案)。名簿にBoss自身は含まれないため`— you`は付かない:

```
Team <teamID-1>:
- test-1 (leader)
- test-2 (member)
Team <teamID-2>:
- survey-1 (leader)
- survey-2 (member)
```

**日本語訳(参考):**

```
チーム<teamID>:
- test-1 (leader) — Bossにメッセージを送れる唯一のメンバー — あなた
- test-2 (member)
- test-3 (member)
```

```
- Boss — あなたの上司。メッセージを送れるのはleaderであるあなただけです
```

### 5.7 受信メッセージの形式(inboxに投入される合成メッセージ)

```
From test-2 (member):
<本文>
```

```
From Boss:
<本文>
```

- roleは必ず付与(member/leader)。Bossからのメッセージは`From Boss:`のみ
- **返信方法の指示はメッセージに含めない**(返信バイアス防止)。返信方法は§5.8のルール側にのみ記載

### 5.8 システムプロンプト(チームメンバーに注入するルール)

**原文(ドラフト・要確認):**

```
You are <name> (<role>) in team <teamID>.

Rules:
- Communicate with teammates using message_to_peer. You can only message
  entries in the current team roster; other sessions do not exist for you.
- The roster can grow as members join. Call team_roster to see current members.
- Idle is a normal state. Incoming messages wake you automatically; do not
  poll or wait in a loop.
- When your part is done, send your result to the relevant teammate
  (or Boss if you are the leader).
```

**日本語訳:**

```
あなたはチーム <teamID> の <name>(<role>) です。

ルール:
- チームメイトとは message_to_peer で通信してください。現行の名簿に載っている
  相手にのみ送信できます。名簿にないセッションはあなたにとって存在しません。
- 名簿はメンバーの参加に伴って増えることがあります。現行メンバーは
  team_roster で確認してください。
- 待機(idle)は正常な状態です。メッセージが届けば自動的に起こされるので、
  ポーリングや待ちループはしないでください。
- 自分の担当が完了したら、結果を該当するチームメイトに送信してください
  (leaderの場合はBossに)。
```

### 5.9 Boss側への追記

**廃止。**「leaderのメッセージ=チームの状況」という文言は実態(何でも届く)と合わないため削除。メッセージ自体が`From <名前> (role):`で自己記述的なため、追加の説明は不要と判断。

## 6. TUIへの影響(最小限)

- `/subagents`ダイアログ: 名前・roleの表示を追加
- メッセージ本文に`From ...`がそのまま表示される(追加実装なしで可読)
- その他のUI変更なし(ピッカーの自動表示廃止・入力欄常時表示はv2-customステップ1で実装済み)

## 7. 実装影響範囲(想定)

| パッケージ | 内容 |
|---|---|
| `packages/core` | subagentツール改造(team・再アタッチ削除・background化)、roster管理(小さなテーブル/サービス)、message_to_peer/team_rosterツール、チームspawnの完了通知抑制、プロンプト注入 |
| `packages/protocol` / `schema` | ツールパラメータ変更、rosterのスキーマ |
| `packages/client` / `sdk` | 生成物の再生成(`bun run generate`をpackages/clientから実行) |
| `packages/tui` | `/subagents`ダイアログの表示追加 |

- 実装順序の目安: ①roster管理 → ②taskツール改造 → ③message_to_peer/team_roster → ④プロンプト注入 → ⑤TUI → ⑥テスト(ヘッドレスfixtureでE2E)

## 8. エッジケースと既知の制限

- Bossがleaderを起こし忘れた場合: チームはdormantのまま動かない(stall問題と同根。後日課題)
- leaderがエラー/中断で停止した場合: memberからleader宛の送信はエラーになる。stall検知は後日課題
- Bossが長時間自作業中の場合: leaderからのメッセージはsteerとして待機し、ステップ境界で処理される(既存機構)
- leaderが報告送信後に再開される可能性がある(完了概念がないため)。親が再度メッセージを送れば動く
- Boss宛メッセージの洪水: プロンプト誘導のみで対処(構造的制御なし)。問題になったら後日

## 9. 互換性とマージ方針

- チームなしspawnの動作は変更しない(完了通知・既存フロー・既存文面をそのまま維持)
- sessionID継続の削除は破壊的変更(フォーク内の話。上流に機構は残るので復活も可能)
- 上流マージ時のコンフリクト候補:
  - `packages/core/src/tool/plugin/subagent.ts`(ツールスキーマ)
  - システムプロンプト注入箇所(session/prompt周辺)
  - 上記2箇所以外は新規ファイル中心にし、侵入面積を最小化する

## 10. 用語集

| 用語 | 意味 |
|---|---|
| Boss | メインセッション(親)。チームをspawnする側 |
| leader | チーム内でBossへの送信権を持つ唯一のメンバー。最初にspawnされた子が自動的になる |
| member | Bossへの送信権を持たないチームメンバー |
| 名簿(roster) | チームの現在のメンバー一覧。可視性の制御にも使う |
| steer | 実行中のセッションの次のステップ境界で入力を差し込む既存の配送方式 |
| wake | 待機中のセッションを起こして処理を再開させる既存の機構 |
