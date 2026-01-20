//! OpenCode Authentication Broker daemon.
//!
//! This binary provides PAM authentication services via Unix socket IPC.
//! It is designed to run as a long-running daemon under systemd (Linux)
//! or launchd (macOS).
//!
//! # Usage
//!
//! ```sh
//! opencode-broker
//! ```
//!
//! # Configuration
//!
//! Configuration is loaded from `opencode.json` found by walking up from
//! the current directory. If not found, defaults are used.
//!
//! # Signals
//!
//! - `SIGTERM`: Graceful shutdown
//! - `SIGINT`: Graceful shutdown (Ctrl+C)

use tokio::sync::watch;
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing with env filter
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("opencode_broker=info".parse()?),
        )
        .init();

    info!("opencode-broker starting");

    // Load configuration
    let config = match opencode_broker::config::load_config() {
        Ok(c) => c,
        Err(e) => {
            error!(error = %e, "failed to load config");
            return Err(e.into());
        }
    };

    info!(
        socket_path = %config.socket_path,
        pam_service = %config.pam_service,
        rate_limit = config.rate_limit_per_minute,
        "configuration loaded"
    );

    // Create shutdown signal channel
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Handle SIGTERM and SIGINT for graceful shutdown
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to register SIGTERM handler");

        let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
            .expect("failed to register SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => {
                info!("received SIGTERM, initiating shutdown");
            }
            _ = sigint.recv() => {
                info!("received SIGINT, initiating shutdown");
            }
        }

        // Signal shutdown to the server
        let _ = shutdown_tx_clone.send(true);
    });

    // Create and run server
    let server = opencode_broker::ipc::server::Server::new(config);

    // Notify systemd we're ready (Linux only)
    #[cfg(target_os = "linux")]
    {
        use sd_notify::NotifyState;
        if let Err(e) = sd_notify::notify(true, &[NotifyState::Ready]) {
            // Not an error if not running under systemd
            tracing::debug!(error = %e, "sd_notify failed (not running under systemd?)");
        }
    }

    // Run the server
    if let Err(e) = server.run(shutdown_rx).await {
        error!(error = %e, "server error");
        return Err(e.into());
    }

    info!("opencode-broker shutdown complete");
    Ok(())
}
