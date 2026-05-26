# SecureCode Sandbox (Phase 0) 仕様書

## 概要

- **目的**: SecureCode (opencode fork) のプロセス本体を OS sandbox の中で動かし、ユーザが明示許可したドメイン以外への外部通信をカーネル層で物理的に遮断する。Layer 1 (opencode 既存の permission) が LLM の誤用・インジェクション・バグで破られた場合でも、CIA 以外への egress が起きない構造を作る。SecureCode を「使っている限り、うっかり機密が CIA 以外に流せない」状態を成立させる Layer 2 防御の最初の一歩。
- **対象ユーザー**: SecureCode を機密コードに対して使うエンドユーザ。
- **脅威モデル**: 非敵対(ユーザは sandbox を能動的に破壊しようとしない前提)。攻撃者対応・TEE 強度の検証は対象外。

## 要件

### 必須要件 (Must)

- SecureCode 起動時に opencode プロセス本体を `@anthropic-ai/sandbox-runtime` で**全体包み**する。
- **macOS (Seatbelt) と Linux (bubblewrap) 両対応**。両 OS でスモーク検証を必須とする。
- sandbox-runtime が利用不可な環境では**起動拒否 (fail-closed)**。
- **デフォルト allowlist は CIA endpoint (`conf-ai.acompany-az.com`) のみ**。GitHub / npm 等は含めない。
- ユーザが許可ドメインを追加するための設定ファイルを `~/.config/securecode/sandbox.json` (JSON) として提供する。手編集 → SecureCode 再起動で反映。
- 設定ファイルのスキーマは `network.allowedDomains` / `network.deniedDomains` / `filesystem.denyRead` / `filesystem.allowRead` / `filesystem.allowWrite` / `filesystem.denyWrite` を受け付ける。
- **SecureCode (sandbox 内プロセス) が設定ファイルに一切触れないことを保証**する。`filesystem.denyRead` + `denyWrite` の両方で設定ファイルパスをファイル単位で deny。
- 未許可ドメインへアクセスしようとした tool 呼び出しは**失敗として返す**(sandbox-runtime デフォルトの遮断挙動に委ねる)。許可を増やすにはユーザが手動で設定ファイルを編集して再起動する。

### 任意要件 (Nice to have)

- **Windows サポートは WSL2 経由で Linux パスを使う**。Linux 対応の副産物として動く想定だが、Phase 0 で明示的な検証はしない。
- Phase 1 で動的承認フロー(新規ドメイン要求 UX)と hot-reload 対応 SNI proxy に移行できる境界設計。

### スコープ外 (Phase 0 では非対象)

- **動的ドメイン承認 UX**(「このドメイン許可していい?」prompt) → Phase 1
- **hot-reload**(設定変更の即時反映) → Phase 1
- **プロジェクトローカル設定** (`.securecode/`) → Phase 1
- **未許可ドメイン遮断時の専用エラー文面** → Phase 1(動的承認 UX とセット)
- **配布バイナリ化**(CIA endpoint 同梱の単独バイナリ) → Phase 1+(`release-securecode.ts` / `install-securecode` の改修を伴う)
- **escape hatch** (`bash:unsandboxed` 同等の送り口) → Phase 1+(配布バイナリでの「本番除去」とセットの概念)
- **設定ファイルの専用ディレクトリ隔離**(ディレクトリごと deny) → Phase 1+
- **credential brokering proxy**(CIA token を sandbox 外でヘッダ注入) → Phase 2
- **managed config**(MDM / `/etc/securecode/` での組織強制ロック) → Phase 2
- **TEE attestation 連携** → Phase 4
- **Windows native**(sandbox-runtime が未対応のため Phase 0 では不可)
- `benchmarks/securecode/` 関連(開発者向けベンチマークで本仕様の対象外)

## 振る舞い

### 正常系

- **起動**: supervisor が設定ファイルを読み込み → sandbox 初期化成功 → opencode 子プロセスを sandbox 内で spawn → 通常通り TUI 表示。
- **CIA 通信**: デフォルト allowlist で通過 → 成功。
- **許可済みドメイン通信**: ユーザが事前に設定ファイルへ追加したドメインのみ成功。
- **許可ドメインの追加**: SecureCode を終了 → 設定ファイルを手編集 → SecureCode を再起動 → 反映。

### 異常系・エッジケース

- **sandbox-runtime 未インストール / 未対応プラットフォーム**: 起動拒否、依存案内付きエラー。
- **sandbox 初期化失敗**: 起動拒否、エラーメッセージ表示。
- **設定ファイルの parse 失敗(不正な JSON)**: 起動拒否、エラーメッセージ表示。
- **未許可ドメインへのアクセス**: sandbox-runtime の proxy が遮断 → tool 呼び出しは接続失敗として返る。Phase 0 では専用案内文面は出さず、ランタイムの素のエラーを通す。
- **LLM が sandbox 設定ファイルを read しようとする**: `filesystem.denyRead` で物理的に失敗。設定内容(ユーザ固有の allowlist) が LLM に渡らない。
- **LLM が sandbox 設定ファイルを write しようとする**: `filesystem.denyWrite` で物理的に失敗。

## 方針

- 基盤: `@anthropic-ai/sandbox-runtime` の Node SDK (`SandboxManager.initialize` / `wrapWithSandbox`) を採用。
- 構成: **supervisor (sandbox 外) + opencode (sandbox 内) の 2 プロセス構成**。supervisor は起動時に設定ファイルを読み、sandbox を初期化し、opencode を子プロセスとして spawn する。Phase 0 では supervisor の役割は「起動時の launcher」のみで、実行中の config 更新・IPC 受信・reset は行わない。
- 起動経路: 開発ツリーから `run-securecode.sh` → supervisor → opencode を直接呼ぶ。配布バイナリ化は Phase 1+ で扱う。
- 設定ファイルの隔離: 設定ファイルは opencode 本体の `~/.config/securecode/config.json` と同居する。ディレクトリごとの deny は opencode 起動を壊すため避け、`sandbox.json` をファイル単位で `denyRead` + `denyWrite` する。攻撃面の小さい専用ディレクトリ方式は Phase 1+ で再検討。
- Layer 関係: 既存 opencode の Layer 1 permission (allow/ask/deny) はそのまま流用し、本仕様は Layer 2 (OS sandbox + egress allowlist) を追加する。Phase 0 では opencode 本体 (`packages/opencode/**`) のコードは触らない。
- 拡張余地: Phase 0 では実装を最小に保ち、Phase 1 で supervisor に IPC 受信と hot-reload を足して動的承認 UX を実現する余地を残す。

## 未決事項

- 設定ファイル parse エラー時のユーザ向けエラー文面。
- sandbox 初期化失敗時のユーザ向け案内文面。
- supervisor 停止時の opencode 子プロセスのクリーンアップ手順 (SIGTERM → SIGKILL のタイムアウト等)。

## 関連仕様

- Notion: [SecureCode Sandbox 設計方針 (要点版)](https://www.notion.so/acompany-ac/SecureCode-Sandbox-34a269d8558681819ef1ecc234d1ea14)
- 上流参考: opencode PR #21538, Claude Code sandboxing docs
- 試行実装: PR #103 (`feat/securecode-sandbox-phase0`) — 本 spec の実装例として参考。本 spec 確定後に再実装/refactor して別 PR で再提出予定。
