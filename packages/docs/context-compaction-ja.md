# コンテキスト Compaction 処理

## 概要

Compaction処理は、LLMのコンテキストウィンドウが一杯になった際に、会話履歴を要約・圧縮することで、長時間のセッションを継続可能にする機能です。

この機能は主に2つのフェーズで構成されています：

1. **Prune（刈り込み）**: 古いツール出力を削除してトークン数を削減
2. **Compact（圧縮）**: 会話全体をAIモデルで要約

## アーキテクチャ

### 関連ファイル

| ファイル | 役割 |
|---------|------|
| `session/compaction.ts` | コアのcompactionロジック |
| `session/prompt.ts` | オーバーフロー検知とcompaction呼び出し |
| `session/message-v2.ts` | メッセージフィルタリングとモデル変換 |
| `session/summary.ts` | セッション・メッセージ要約 |
| `session/prompt/compaction.txt` | 要約用システムプロンプト |

### 処理フロー図

```
┌─────────────────────────────────────────────────────────────────┐
│                     プロンプト実行ループ                         │
│                      (prompt.ts)                                │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. オーバーフロー検知                                           │
│     SessionCompaction.isOverflow()                              │
│     条件: tokens > context_window - reserved_output             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ オーバーフロー検知時
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Compactionタスク作成                                         │
│     SessionCompaction.create()                                  │
│     → CompactionPartをユーザーメッセージに追加                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Compaction実行                                               │
│     SessionCompaction.process()                                 │
│     → AIモデルで会話を要約                                       │
│     → summary: true フラグ付きアシスタントメッセージを作成        │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Prune実行（ステップ完了後）                                   │
│     SessionCompaction.prune()                                   │
│     → 古いツール出力を削除                                       │
└─────────────────────────────────────────────────────────────────┘
```

## アルゴリズム詳細

### 1. オーバーフロー検知 (`isOverflow`)

コンテキストウィンドウの使用量がモデルの制限を超えているかを判定します。

```typescript
function isOverflow(input: {
  tokens: { input, cache: { read }, output },
  model: Provider.Model
}) {
  // 自動compaction無効化フラグ
  if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) return false

  const context = input.model.limit.context  // モデルのコンテキストウィンドウサイズ
  if (context === 0) return false

  // 現在使用中のトークン数
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output

  // 出力用に確保するトークン数（最大32,000）
  const output = Math.min(input.model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX

  // 使用可能なトークン数
  const usable = context - output

  return count > usable
}
```

**判定式**:
```
tokens.input + tokens.cache.read + tokens.output > context_window - reserved_output
```

### 2. Prune（刈り込み）処理

古いツール呼び出しの出力を削除し、トークン数を削減します。

#### 定数

```typescript
const PRUNE_MINIMUM = 20_000  // 最小削除トークン数（これ以上削除できる場合のみ実行）
const PRUNE_PROTECT = 40_000  // 保護トークン数（この量を蓄積するまで削除しない）
```

#### アルゴリズム

```
1. メッセージを新しい順に逆走査
2. ユーザーメッセージをカウント（ターン数）
3. 2ターン以上経過したメッセージのみ対象
4. 完了済みツール呼び出しのトークン数を累計
5. 累計が PRUNE_PROTECT（40K）を超えたら、それより古いツール出力を削除対象に
6. 削除対象のトークン数が PRUNE_MINIMUM（20K）を超えた場合のみ実行
7. 対象ツールパートに compacted タイムスタンプを設定
```

```typescript
async function prune(input: { sessionID: string }) {
  let total = 0     // ツール出力の累計トークン数
  let pruned = 0    // 削除予定のトークン数
  let turns = 0     // ターン数

  // 逆順にメッセージを走査
  for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = msgs[msgIndex]

    // ユーザーメッセージでターン数をカウント
    if (msg.info.role === "user") turns++

    // 最初の2ターンは保護
    if (turns < 2) continue

    // サマリーメッセージで停止
    if (msg.info.role === "assistant" && msg.info.summary) break

    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = msg.parts[partIndex]

      if (part.type === "tool" && part.state.status === "completed") {
        // 既にcompacted済みなら停止
        if (part.state.time.compacted) break

        const estimate = Token.estimate(part.state.output)
        total += estimate

        // PRUNE_PROTECTを超えたら、それより古いものを削除対象に
        if (total > PRUNE_PROTECT) {
          pruned += estimate
          toPrune.push(part)
        }
      }
    }
  }

  // PRUNE_MINIMUM以上削除できる場合のみ実行
  if (pruned > PRUNE_MINIMUM) {
    for (const part of toPrune) {
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)
    }
  }
}
```

#### Compacted ツール出力の処理

`toModelMessage`でモデルに送信する際、compactedされたツール出力は置換されます：

```typescript
// message-v2.ts:646
output: part.state.time.compacted
  ? "[Old tool result content cleared]"
  : part.state.output
```

### 3. Compact（圧縮）処理

AIモデルを使用して会話全体を要約します。

#### Compactionタスク作成 (`create`)

```typescript
async function create(input) {
  // ユーザーメッセージを作成
  const msg = await Session.updateMessage({
    role: "user",
    model: input.model,
    sessionID: input.sessionID,
    agent: input.agent,
    time: { created: Date.now() },
  })

  // CompactionPartを追加
  await Session.updatePart({
    messageID: msg.id,
    sessionID: msg.sessionID,
    type: "compaction",
    auto: input.auto,  // 自動/手動の区別
  })
}
```

#### Compaction実行 (`process`)

```typescript
async function process(input) {
  // 1. サマリー用アシスタントメッセージを作成（summary: true）
  const msg = await Session.updateMessage({
    role: "assistant",
    summary: true,  // サマリーフラグ
    // ...
  })

  // 2. プロセッサを作成してAIモデルを呼び出し
  const processor = SessionProcessor.create({ ... })

  // 3. システムプロンプト + 過去メッセージ + 要約リクエストを送信
  const result = await processor.process({
    messages: [
      ...SystemPrompt.compaction(model.providerID),  // 要約用システムプロンプト
      ...MessageV2.toModelMessage(input.messages),   // 過去の会話履歴
      {
        role: "user",
        content: "Summarize our conversation above..."  // 要約リクエスト
      },
    ],
    // ...
  })

  // 4. 完了イベントを発行
  Bus.publish(Event.Compacted, { sessionID: input.sessionID })
}
```

#### 要約用システムプロンプト (compaction.txt)

```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context
but concise enough to be quickly understood.
```

### 4. メッセージフィルタリング (`filterCompacted`)

Compaction後、古いメッセージは除外され、サマリー以降のみが使用されます。

```typescript
async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
  const result = [] as MessageV2.WithParts[]
  const completed = new Set<string>()

  // 最新から逆順に走査
  for await (const msg of stream) {
    result.push(msg)

    // ユーザーメッセージにCompactionPartがあり、
    // 対応するアシスタントメッセージが完了済みなら停止
    if (
      msg.info.role === "user" &&
      completed.has(msg.info.id) &&
      msg.parts.some((part) => part.type === "compaction")
    ) break

    // サマリーメッセージをマーク
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish)
      completed.add(msg.info.parentID)
  }

  result.reverse()  // 時系列順に戻す
  return result
}
```

## データ構造

### CompactionPart

```typescript
const CompactionPart = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  type: z.literal("compaction"),
  auto: z.boolean(),  // true: 自動トリガー, false: 手動
})
```

### ToolStateCompleted (compacted timestamp)

```typescript
const ToolStateCompleted = z.object({
  status: z.literal("completed"),
  input: z.record(z.string(), z.any()),
  output: z.string(),
  title: z.string(),
  metadata: z.record(z.string(), z.any()),
  time: z.object({
    start: z.number(),
    end: z.number(),
    compacted: z.number().optional(),  // Prune時に設定
  }),
  attachments: FilePart.array().optional(),
})
```

### Assistant Message (summary flag)

```typescript
const Assistant = Base.extend({
  role: z.literal("assistant"),
  // ...
  summary: z.boolean().optional(),  // Compaction要約の場合true
  finish: z.string().optional(),     // 完了理由
  // ...
})
```

## 設定フラグ

| 環境変数 | 説明 |
|---------|------|
| `OPENCODE_DISABLE_AUTOCOMPACT` | 自動compactionを無効化 |
| `OPENCODE_DISABLE_PRUNE` | Prune処理を無効化 |

## トークン推定

```typescript
// util/token.ts
const CHARS_PER_TOKEN = 4

function estimate(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
```

## 処理のタイミング

1. **isOverflow**: 各ステップ完了後、次のステップを開始する前にチェック
2. **create**: オーバーフロー検知時に即座にCompactionタスクを作成
3. **process**: プロンプトループ内でCompactionタスクを検出して実行
4. **prune**: プロンプトループ終了後（セッション完了時）に実行

## まとめ

Compaction処理は以下の目的で設計されています：

1. **長時間セッションの継続**: コンテキストウィンドウの制限を超えても会話を継続
2. **重要情報の保持**: AIによる要約で、タスク継続に必要な情報を保持
3. **効率的なトークン管理**: 古いツール出力を選択的に削除してスペースを確保
4. **透過的な動作**: ユーザーは意識せずに自然な会話を継続可能
