use std::time::Duration;

/// Poll the athena CLI server health endpoint until it's ready.
pub async fn await_health_check(
    hostname: &str,
    port: u16,
    password: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let url = format!("http://{}:{}/global/health", hostname, port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(7))
        .no_proxy()
        .build()?;

    // Poll every 100ms for up to 30 seconds
    for _ in 0..300 {
        match client
            .get(&url)
            .basic_auth("athena", Some(password))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => return Ok(true),
            _ => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }

    Err("Server did not become ready within 30 seconds".into())
}
