use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use pencode_core::App;
use tower::ServiceExt;

#[tokio::test]
async fn health_and_session_flow() {
    let tmp = std::env::temp_dir().join(format!("pencode-server-{}", std::process::id()));
    let app = App::load(&tmp).unwrap();
    let router = pencode_server::router(app);

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/session")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"directory": "/tmp"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    let response = router
        .oneshot(
            Request::builder()
                .uri(format!("/session/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    std::fs::remove_dir_all(tmp).ok();
}
