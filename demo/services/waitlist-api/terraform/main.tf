terraform {
  required_version = ">= 1.5"

  # state は GCS に保存（partial config）。バケット/prefix は backend.hcl で渡す:
  #   terraform init -backend-config=backend.hcl
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  apis = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

# 必要 API の有効化
resource "google_project_service" "apis" {
  for_each           = var.enable_apis ? toset(local.apis) : []
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# 書き込み先の Native モード DB。named DB なので、既定 (default) が
# Datastore モードでも衝突せず別建てで作れる。
# 既存 DB を使う場合は create_firestore_database = false にする。
resource "google_firestore_database" "waitlist" {
  count       = var.create_firestore_database ? 1 : 0
  project     = var.project_id
  name        = var.firestore_database
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "waitlist_api" {
  account_id   = "${var.service_name}-sa"
  display_name = "Waitlist API (${var.service_name}) runtime SA"
}

# Firestore への読み書き権限（トークン不要。SA の IAM だけで完結）
resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.waitlist_api.email}"
}

# Slack webhook シークレットの読み取り権限（slack_webhook_secret 指定時のみ）。
# シークレット自体は Terraform 管理外（gcloud で事前作成）のため、名前参照で付与する。
resource "google_secret_manager_secret_iam_member" "slack_webhook_accessor" {
  count     = var.slack_webhook_secret != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.slack_webhook_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.waitlist_api.email}"
}

resource "google_cloud_run_v2_service" "waitlist_api" {
  name                = var.service_name
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.waitlist_api.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }

      env {
        name  = "FIRESTORE_DATABASE"
        value = var.firestore_database
      }

      env {
        name  = "FIRESTORE_COLLECTION"
        value = var.firestore_collection
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }

      # Slack Incoming Webhook（任意）。Secret Manager 参照で注入する。
      # URL の実体は tfstate に残らない。slack_webhook_secret が空なら付与しない。
      dynamic "env" {
        for_each = var.slack_webhook_secret != "" ? [1] : []
        content {
          name = "SLACK_WEBHOOK_URL"
          value_source {
            secret_key_ref {
              secret  = var.slack_webhook_secret
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        # リクエスト時のみ CPU を割り当てる（ゼロスケール・低コスト）。
        # これにより 256Mi でも許可される。
        cpu_idle = true
      }
    }
  }

  lifecycle {
    # Cloud Run v2 のサービスレベル scaling は API が既定値を埋めるため、
    # 設定しないと毎回 perpetual diff になる。無視する。
    ignore_changes = [scaling]
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.firestore_user,
    google_secret_manager_secret_iam_member.slack_webhook_accessor,
  ]
}

# ブラウザから直接叩く公開エンドポイントのため allUsers に invoker を付与。
# （不正利用対策は honeypot + email バリデーションで担保）
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.waitlist_api.name
  location = google_cloud_run_v2_service.waitlist_api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
