variable "project_id" {
  type        = string
  description = "デプロイ先の GCP プロジェクト ID（Firestore もこのプロジェクトを使う）"
}

variable "region" {
  type        = string
  description = "Cloud Run と Firestore のリージョン"
  default     = "asia-northeast1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run サービス名（SA 名の接頭辞にも使う）"
  default     = "waitlist-api"
}

variable "image" {
  type        = string
  description = "コンテナイメージ URL（事前に build/push が必要。例: asia-northeast1-docker.pkg.dev/PROJECT/REPO/waitlist-api:latest）"
}

variable "firestore_database" {
  type        = string
  description = "書き込み先 Firestore データベース ID（Native モード）"
  default     = "waitlist"
}

variable "firestore_collection" {
  type        = string
  description = "書き込み先 Firestore コレクション名"
  default     = "waitlist"
}

variable "allowed_origins" {
  type        = string
  description = "CORS で許可するオリジン（カンマ区切り。例: https://lp.example.com）。空なら * にフォールバック"
  default     = ""
}

variable "slack_webhook_secret" {
  type        = string
  description = "Slack Incoming Webhook URL を格納した Secret Manager のシークレット名（任意。例: waitlist-slack-webhook）。URL そのものではなくシークレット名を指定する。空なら通知しない。シークレットは事前に gcloud で作成しておくこと（Terraform 管理外）。指定すると SA への secretAccessor 付与も行う。"
  default     = ""
}

variable "enable_apis" {
  type        = bool
  description = "必要 API（run/firestore/cloudbuild/artifactregistry）を Terraform で有効化するか"
  default     = true
}

variable "create_firestore_database" {
  type        = bool
  description = "Native モードの named DB を作成するか。既存 DB を使う場合は false"
  default     = true
}
