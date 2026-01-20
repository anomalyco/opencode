//! Unix socket server for the authentication broker.
//!
//! Listens for connections on a Unix socket, handling each connection
//! in a separate task. Supports graceful shutdown via a watch channel.

use crate::auth::rate_limit::RateLimiter;
use crate::config::BrokerConfig;
use crate::ipc::handler;
use crate::ipc::protocol::{Request, Response};
use futures::{SinkExt, StreamExt};
use std::path::PathBuf;
use std::sync::Arc;
use std::{fs, io};
use thiserror::Error;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec, LinesCodecError};
use tracing::{debug, error, info, warn};

/// Maximum line length for the IPC protocol (64 KB).
const MAX_LINE_LENGTH: usize = 64 * 1024;

/// Errors that can occur in the server.
#[derive(Debug, Error)]
pub enum ServerError {
    /// Failed to bind the Unix socket.
    #[error("failed to bind Unix socket: {0}")]
    BindError(#[source] io::Error),

    /// Failed to accept a connection.
    #[error("failed to accept connection: {0}")]
    AcceptError(#[source] io::Error),

    /// Failed to create socket directory.
    #[error("failed to create socket directory: {0}")]
    DirectoryError(#[source] io::Error),

    /// Failed to set socket permissions.
    #[error("failed to set socket permissions: {0}")]
    PermissionError(#[source] io::Error),
}

/// Unix socket server for authentication requests.
pub struct Server {
    /// Path to the Unix socket.
    socket_path: PathBuf,
    /// Server configuration.
    config: Arc<BrokerConfig>,
    /// Rate limiter for authentication attempts.
    rate_limiter: Arc<RateLimiter>,
}

impl Server {
    /// Create a new server with the given configuration.
    pub fn new(config: BrokerConfig) -> Self {
        let rate_limiter = Arc::new(RateLimiter::new(config.rate_limit_per_minute));
        let socket_path = PathBuf::from(&config.socket_path);

        Self {
            socket_path,
            config: Arc::new(config),
            rate_limiter,
        }
    }

    /// Run the server until shutdown is signaled.
    ///
    /// # Arguments
    ///
    /// * `shutdown` - Watch channel that signals shutdown when set to true.
    ///
    /// # Returns
    ///
    /// Returns `Ok(())` on graceful shutdown, or an error if the server
    /// fails to start.
    pub async fn run(&self, mut shutdown: watch::Receiver<bool>) -> Result<(), ServerError> {
        // Remove stale socket file if it exists (from previous unclean shutdown)
        if self.socket_path.exists() {
            info!(path = %self.socket_path.display(), "removing stale socket file");
            let _ = fs::remove_file(&self.socket_path);
        }

        // Create parent directory if it doesn't exist
        if let Some(parent) = self.socket_path.parent() {
            if !parent.exists() {
                info!(path = %parent.display(), "creating socket directory");
                fs::create_dir_all(parent).map_err(ServerError::DirectoryError)?;
            }
        }

        // Bind the Unix socket
        let listener = UnixListener::bind(&self.socket_path).map_err(ServerError::BindError)?;

        // Set socket permissions to 0o666 (any local user can connect)
        // Authentication is handled by PAM, not socket permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.socket_path, fs::Permissions::from_mode(0o666))
                .map_err(ServerError::PermissionError)?;
        }

        info!(path = %self.socket_path.display(), "server listening");

        loop {
            tokio::select! {
                // Accept new connections
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _addr)) => {
                            debug!("accepted connection");
                            let config = Arc::clone(&self.config);
                            let rate_limiter = Arc::clone(&self.rate_limiter);
                            tokio::spawn(async move {
                                if let Err(e) = handle_connection(stream, config, rate_limiter).await {
                                    debug!(error = %e, "connection error");
                                }
                            });
                        }
                        Err(e) => {
                            error!(error = %e, "failed to accept connection");
                            // Continue accepting other connections
                        }
                    }
                }

                // Check for shutdown signal
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        info!("shutdown signal received");
                        break;
                    }
                }
            }
        }

        // Clean up socket file
        info!(path = %self.socket_path.display(), "removing socket file");
        let _ = fs::remove_file(&self.socket_path);

        Ok(())
    }
}

/// Handle a single client connection.
///
/// Reads newline-delimited JSON requests, processes them, and sends
/// responses back.
async fn handle_connection(
    stream: UnixStream,
    config: Arc<BrokerConfig>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<(), ConnectionError> {
    let (reader, writer) = stream.into_split();

    let mut lines_in = FramedRead::new(reader, LinesCodec::new_with_max_length(MAX_LINE_LENGTH));
    let mut lines_out = FramedWrite::new(writer, LinesCodec::new());

    while let Some(line_result) = lines_in.next().await {
        let line = match line_result {
            Ok(l) => l,
            Err(e) => {
                warn!(error = %e, "failed to read line");
                // For codec errors, try to send an error response if possible
                let error_response = Response::failure("unknown", "protocol error");
                let _ = lines_out
                    .send(serde_json::to_string(&error_response).unwrap_or_default())
                    .await;
                return Err(ConnectionError::Codec(e));
            }
        };

        // Parse the request
        let request: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                debug!(error = %e, "failed to parse request");
                let error_response = Response::failure("unknown", "invalid request");
                lines_out
                    .send(serde_json::to_string(&error_response).unwrap_or_default())
                    .await
                    .map_err(ConnectionError::Codec)?;
                continue; // Continue processing more requests
            }
        };

        // Handle the request
        let response = handler::handle_request(request, &config, &rate_limiter).await;

        // Send the response
        let response_json =
            serde_json::to_string(&response).map_err(ConnectionError::Serialization)?;
        lines_out
            .send(response_json)
            .await
            .map_err(ConnectionError::Codec)?;
    }

    debug!("connection closed");
    Ok(())
}

/// Errors that can occur while handling a connection.
#[derive(Debug, Error)]
enum ConnectionError {
    #[error("codec error: {0}")]
    Codec(#[source] LinesCodecError),

    #[error("serialization error: {0}")]
    Serialization(#[source] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BrokerConfig;
    use std::time::Duration;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_server_creates_socket() {
        let dir = tempdir().expect("create temp dir");
        let socket_path = dir.path().join("test.sock");

        let config = BrokerConfig {
            socket_path: socket_path.to_str().unwrap().to_string(),
            ..Default::default()
        };

        let server = Server::new(config);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // Start server in background
        let server_handle = tokio::spawn(async move { server.run(shutdown_rx).await });

        // Give server time to bind
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Verify socket was created
        assert!(socket_path.exists(), "socket file should exist");

        // Signal shutdown
        shutdown_tx.send(true).expect("send shutdown");

        // Wait for server to stop
        let result = tokio::time::timeout(Duration::from_secs(1), server_handle)
            .await
            .expect("server should stop within timeout");

        assert!(result.is_ok(), "server task should complete");
        assert!(result.unwrap().is_ok(), "server should shutdown cleanly");

        // Verify socket was cleaned up
        assert!(!socket_path.exists(), "socket file should be removed");
    }

    #[tokio::test]
    async fn test_server_removes_stale_socket() {
        let dir = tempdir().expect("create temp dir");
        let socket_path = dir.path().join("stale.sock");

        // Create a stale socket file
        fs::write(&socket_path, "").expect("create stale file");
        assert!(socket_path.exists());

        let config = BrokerConfig {
            socket_path: socket_path.to_str().unwrap().to_string(),
            ..Default::default()
        };

        let server = Server::new(config);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // Start and immediately shutdown
        let server_handle = tokio::spawn(async move { server.run(shutdown_rx).await });

        tokio::time::sleep(Duration::from_millis(50)).await;
        shutdown_tx.send(true).expect("send shutdown");

        let result = tokio::time::timeout(Duration::from_secs(1), server_handle)
            .await
            .expect("server should stop");

        assert!(result.is_ok() && result.unwrap().is_ok());
    }

    #[tokio::test]
    async fn test_server_creates_parent_directory() {
        let dir = tempdir().expect("create temp dir");
        let socket_path = dir.path().join("subdir").join("nested.sock");

        // Parent doesn't exist yet
        assert!(!socket_path.parent().unwrap().exists());

        let config = BrokerConfig {
            socket_path: socket_path.to_str().unwrap().to_string(),
            ..Default::default()
        };

        let server = Server::new(config);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let server_handle = tokio::spawn(async move { server.run(shutdown_rx).await });

        tokio::time::sleep(Duration::from_millis(50)).await;

        // Verify directory was created
        assert!(socket_path.parent().unwrap().exists());

        shutdown_tx.send(true).expect("send shutdown");
        let _ = tokio::time::timeout(Duration::from_secs(1), server_handle).await;
    }
}
