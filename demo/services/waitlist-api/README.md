# waitlist-api

LP のウェイティングリスト登録を受け取り、**Firestore**（GCP）に書き込む Cloud Run サービス。

```
LP（静的サイト）
   │  POST /waitlist  { email, website(honeypot), source }
   ▼
Cloud Run: waitlist-api （本サービス）
   │  email 検証 / honeypot 判定 / 重複排除
   ▼
Firestore（同一 GCP プロジェクト内 / 認証は Cloud Run の SA = IAM のみ）
```

静的書き出し（`next.config.ts` の `output: "export"`）の LP からはデータストアへ直接書けないため、この中継サービスを挟む。

**設計上のポイント**
- **トークン/シークレットを持たない。** Firestore へは Cloud Run のサービスアカウント権限（`roles/datastore.user`）で書く。Secret Manager 不要。
- Firestore は Google Drive ではないため、社内の「Google ドライブ外部共有ポリシー」の対象外（外部共有・リンク公開が発生しない）。
- gRPC SDK は使わず **Firestore REST API** を直接呼ぶ（Bun ネイティブ・依存最小）。Cloud Run 上ではメタデータサーバから SA トークンを取得する。

---

## 1. GCP 側の準備（一度だけ）

```bash
PROJECT=your-sandbox-project

# API 有効化
gcloud services enable run.googleapis.com firestore.googleapis.com --project "$PROJECT"

# Firestore データベース（Native モード）を作成。プロジェクトに 1 つ。
# 既に (default) DB がある場合はスキップ。
gcloud firestore databases create --location=asia-northeast1 --type=firestore-native --project "$PROJECT"
```

> コレクション（既定 `waitlist`）は最初の書き込み時に自動作成されるので事前作成は不要。

---

## 2. ローカル開発

```bash
cd demo/services/waitlist-api
cp .env.example .env   # GCP_PROJECT を実値に
bun install

# ローカルから Firestore を叩くためのトークン（会社アカウントでログイン後）
export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)

bun run dev            # http://localhost:8080

# 動作確認
curl -s -X POST http://localhost:8080/waitlist \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","source":"local-test"}'
# => {"ok":true,"duplicate":false}
```

`.env` はコミットしないこと（`.gitignore` / `.dockerignore` 対象）。

---

## 3. デプロイ（GCP Cloud Run）

### 方法 A: gcloud で手早く（ソースから直接ビルド）

```bash
PROJECT=your-sandbox-project
REGION=asia-northeast1

gcloud run deploy waitlist-api \
  --project "$PROJECT" --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT=$PROJECT,FIRESTORE_COLLECTION=waitlist,ALLOWED_ORIGINS=https://your-lp-domain"

# デプロイで作られた SA（または指定 SA）に Firestore 権限を付与
SA=$(gcloud run services describe waitlist-api --project "$PROJECT" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/datastore.user
```

> 既定では Compute Engine default SA が使われる。専用 SA を割り当てたい場合は `--service-account` を指定する（Terraform の方法 B は専用 SA を作成する）。

### 方法 B: Terraform（IaC・専用 SA 付き）

Terraform が行うこと: **API 有効化 / Native モードの named DB 作成 / 専用 SA 作成 + `roles/datastore.user` 付与 / Cloud Run サービス + 公開設定**。

Terraform が行えないこと（事前に1回ずつ必要）:

1. **DB 作成権限のブートストラップ**（実行者が `datastore.databases.create` を持たない場合）

   ```bash
   PROJ=noted-gizmo-337508
   gcloud projects add-iam-policy-binding $PROJ \
     --member="user:$(gcloud config get-value account)" --role=roles/datastore.owner
   ```

2. **コンテナイメージの build/push**（Terraform はイメージをビルドできない）

   ```bash
   PROJ=noted-gizmo-337508
   REGION=asia-northeast1
   gcloud artifacts repositories create waitlist-api \
     --repository-format=docker --location=$REGION --project=$PROJ 2>/dev/null || true
   gcloud builds submit --project=$PROJ \
     --tag "$REGION-docker.pkg.dev/$PROJ/waitlist-api/waitlist-api:latest" .
   ```

その後:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # 実値を編集（image は上で push した URL）
cp backend.hcl.example backend.hcl             # state 保存先の GCS バケット/prefix

# state バケットは事前に作成（versioning 推奨）。例:
#   gcloud storage buckets create gs://PROJECT-tfstate --location=asia-northeast1 --uniform-bucket-level-access
#   gcloud storage buckets update gs://PROJECT-tfstate --versioning

terraform init -backend-config=backend.hcl
terraform apply
terraform output service_url
```

> - state は GCS backend に保存（`backend.hcl` はプロジェクト固有のため gitignore）。stage-2 へ移す際は `backend.hcl` の bucket を差し替える。
> - 既に Firestore Native DB がある場合は `create_firestore_database = false`、API が有効なら `enable_apis = false` にできる。

---

## 4. フロント（LP）側の設定

LP のビルド時に、エンドポイント（**末尾に `/waitlist`**）を env で渡す。

```bash
NEXT_PUBLIC_WAITLIST_ENDPOINT="https://waitlist-api-xxxx.a.run.app/waitlist" bun run build
```

`ALLOWED_ORIGINS` には、この LP が配信されるオリジンを必ず含める。含めないと CORS でブロックされる。

---

## 5. 登録データのエクスポート（β 案内リストの取り出し）

公開エンドポイントには載せない（PII 漏洩防止）。**ローカルから認可済みアカウントで** `scripts/export-csv.ts` を実行する。

```bash
cd demo/services/waitlist-api

# 1) 会社アカウントでアクセストークンを取得
#    （gcloud の既定アカウントが個人 Gmail のことがあるので --account を明示）
export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token --account=you@acompany-ac.com)

# 2) エクスポート（FIRESTORE_DATABASE は named DB を必ず指定）
GCP_PROJECT=<プロジェクトID> \
FIRESTORE_DATABASE=waitlist \
FIRESTORE_COLLECTION=waitlist \
  bun run export > waitlist.csv
```

stage-1（sandbox）の具体値:

```bash
export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token --account=you@acompany-ac.com)
GCP_PROJECT=noted-gizmo-337508 FIRESTORE_DATABASE=waitlist bun run export > waitlist.csv
```

- 出力フォーマット: `email,registeredAt,status,source` の CSV（1 行目はヘッダ）。
- `FIRESTORE_DATABASE` を省略すると既定の `(default)` を見にいく。本サービスの保存先は **named DB `waitlist`** なので必ず指定すること（省略すると空になる）。
- 実行者には Firestore 読み取り権限（`roles/datastore.viewer` 以上、`roles/datastore.user`/`owner` でも可）が必要。
- 動作の仕組み: Firestore REST の `:runQuery`/ドキュメント一覧をページングで全件取得し CSV 化する。gRPC SDK 不要。

### GUI で見たい場合

GCP コンソール → Firestore → データベース **`waitlist`** → コレクション **`waitlist`**。各ドキュメント（ID は `sha256(email)`）に `email` / `registeredAt` / `status` / `source` が入っている。

> ⚠️ 出力 CSV は email（個人情報）を含む。**社内のみで扱い、外部共有しないこと**。外部に渡す場合は社内の Google ドライブ外部共有ポリシーに従う。

---

## 6. API 仕様

### `POST /waitlist`

リクエスト（JSON）:

| フィールド | 必須 | 説明 |
|---|---|---|
| `email` | ✓ | 登録メールアドレス |
| `website` | - | honeypot。値が入っていれば bot とみなし黙って成功扱い |
| `source` | - | 流入元（最大 200 文字） |

レスポンス:

| ステータス | ボディ | 意味 |
|---|---|---|
| 200 | `{"ok":true,"duplicate":false}` | 登録成功 |
| 200 | `{"ok":true,"duplicate":true}` | 既に登録済み（重複） |
| 400 | `{"ok":false,"error":"invalid_email"}` | メール形式不正 |
| 400 | `{"ok":false,"error":"invalid_json"}` | ボディが JSON でない |
| 500 | `{"ok":false,"error":"internal_error"}` | Firestore 書き込み失敗など |

### `GET /healthz`

`{"ok":true}` を返すヘルスチェック用。

### Firestore のドキュメント構造

- コレクション: `waitlist`（環境変数で変更可）
- ドキュメント ID: `sha256(email)`（重複排除＋簡易な擬似匿名化）
- フィールド: `email` / `registeredAt` / `status`（既定 `未案内`）/ `source`

---

## 7. 注意・既知の制約

- 重複排除は email（小文字化）の SHA-256 を doc ID にして `createDocument` の 409 で判定（原子的）。
- レートリミットは未実装。乱用が見られる場合は Cloud Armor 等を検討。
- ローカル実行時は `GOOGLE_ACCESS_TOKEN`（`gcloud auth print-access-token`）が必要。Cloud Run 上ではメタデータサーバから自動取得するため不要。

---

## 8. Slack 通知（任意）

環境変数 `SLACK_WEBHOOK_URL` を設定すると、Firestore 書き込み成功後に Slack の Incoming Webhook へ通知する（**新規・重複の両方**を通知。本文に email を含む）。未設定なら通知しない。通知の失敗は登録処理をブロックしない（ログのみ）。

通知例:

```
:tada: 新規 waitlist 登録: foo@example.com （source: lp-waitlist）
:recycle: 既登録の再送信: foo@example.com （source: lp-waitlist）
```

### Webhook の発行

Slack で [Incoming Webhooks](https://api.slack.com/messaging/webhooks) を有効化し、通知先チャンネル（**email を含むため社内クローズドなチャンネル推奨**）の Webhook URL を発行する。

### 設定方法

URL は秘匿情報なので **Secret Manager に格納**し、Cloud Run へは参照（`SLACK_WEBHOOK_URL`）で渡す。値が tfstate やコマンド履歴に平文で残らない。

**1) Secret Manager に URL を登録**（一度だけ。URL は stdin 経由で履歴に残さない）

```bash
PROJECT=<プロジェクトID>
printf '%s' "$WEBHOOK_URL" | gcloud secrets create waitlist-slack-webhook \
  --data-file=- --project "$PROJECT" --replication-policy=automatic
# 更新するときは create ではなく versions add:
#   printf '%s' "$WEBHOOK_URL" | gcloud secrets versions add waitlist-slack-webhook --data-file=- --project "$PROJECT"
```

**2) Cloud Run へ参照を紐づけ**

- **Terraform（推奨。このサービスは Terraform 管理）**: `slack_webhook_secret = "waitlist-slack-webhook"`（シークレット**名**）を指定して `terraform apply`。SA への `secretAccessor` 付与も Terraform が行う。空なら env を付与しない。
- **gcloud（Terraform を使わない場合のみ）**:

  ```bash
  SA=$(gcloud run services describe waitlist-api --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.serviceAccountName)')
  gcloud secrets add-iam-policy-binding waitlist-slack-webhook \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor --project "$PROJECT"
  gcloud run services update waitlist-api --project "$PROJECT" --region "$REGION" \
    --update-secrets "SLACK_WEBHOOK_URL=waitlist-slack-webhook:latest"
  ```

  > ⚠️ このサービスは Terraform 管理下にあるため、gcloud で手動注入すると **次回 `terraform apply` で巻き戻る**。Terraform を使う環境では上の Terraform 方式に揃えること。

- **ローカル**: `.env` に `SLACK_WEBHOOK_URL=...` を直接入れる（コミットしない）。
