use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Child;

/// State for tracking the sidecar (athena CLI) process.
#[derive(Default)]
pub struct SidecarState {
    pub process: Arc<Mutex<Option<Child>>>,
}

/// Spawn the athena CLI as a sidecar process.
pub async fn spawn_sidecar(
    state: &SidecarState,
    binary: &str,
    args: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut process = state.process.lock().await;

    if process.is_some() {
        return Ok(()); // Already running
    }

    let child = tokio::process::Command::new(binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    *process = Some(child);
    Ok(())
}

/// Kill the sidecar process.
pub async fn kill_sidecar(state: &SidecarState) -> Result<(), Box<dyn std::error::Error>> {
    let mut process = state.process.lock().await;

    if let Some(mut child) = process.take() {
        child.kill().await?;
    }

    Ok(())
}
