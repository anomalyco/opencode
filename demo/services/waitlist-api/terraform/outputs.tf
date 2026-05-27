output "service_url" {
  description = "Cloud Run サービスの URL。末尾に /waitlist を付けてフロントの NEXT_PUBLIC_WAITLIST_ENDPOINT に設定する"
  value       = google_cloud_run_v2_service.waitlist_api.uri
}

output "service_account_email" {
  description = "Cloud Run 実行用サービスアカウント（Firestore への書き込み権限を持つ）"
  value       = google_service_account.waitlist_api.email
}
