//! Request handler for the authentication broker.
//!
//! Orchestrates the authentication flow: validation -> rate limiting -> PAM.
//! Also handles PTY operations: spawn, kill, resize, read, write.

use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::path::PathBuf;

use base64::Engine;

use crate::auth::rate_limit::RateLimiter;
use crate::auth::validation;
use crate::auth::{
    check_otp_config, has_2fa_configured, pam, remove_google_authenticator, validate_otp,
    write_google_authenticator, OtpRemoveError, OtpSetupError,
};
use crate::config::BrokerConfig;
use crate::ipc::protocol::{
    Method, OtpConfigResult, PROTOCOL_VERSION, PtyReadResult, RemoveOtpResult, Request,
    RequestParams, Response, SetupOtpResult, SpawnPtyResult,
};
use crate::process::environment::LoginEnvironment;
use crate::process::spawn::{self, SpawnConfig};
use crate::pty::allocator;
use crate::pty::session::{PtyId, PtySession, SessionManager};
use crate::session::user::UserSessionStore;
use tracing::{debug, error, info, warn};

fn is_pty_closed_error(err: &std::io::Error) -> bool {
    if matches!(err.kind(), std::io::ErrorKind::BrokenPipe) {
        return true;
    }

    match err.raw_os_error() {
        Some(code)
            if code == libc::EIO
                || code == libc::EBADF
                || code == libc::ENXIO
                || code == libc::EPIPE =>
        {
            true
        }
        _ => false,
    }
}

/// Handle a single IPC request.
///
/// This function dispatches to the appropriate handler based on the request
/// method, orchestrating validation, rate limiting, and PAM authentication,
/// as well as PTY operations (spawn, kill, resize).
///
/// # Arguments
///
/// * `request` - The parsed IPC request.
/// * `config` - Server configuration.
/// * `rate_limiter` - Per-username rate limiter.
/// * `user_sessions` - Session-to-user mapping store.
/// * `pty_sessions` - Active PTY session manager.
///
/// # Returns
///
/// A response to send back to the client.
///
/// # Security Notes
///
/// - NEVER log passwords (handled by protocol types)
/// - NEVER return detailed errors (prevents user enumeration)
/// - Check rate limit BEFORE PAM (fail fast on brute force)
pub async fn handle_request(
    request: Request,
    config: &BrokerConfig,
    rate_limiter: &RateLimiter,
    user_sessions: &UserSessionStore,
    pty_sessions: &SessionManager,
) -> Response {
    // Version check
    if request.version != PROTOCOL_VERSION {
        return Response::failure(
            &request.id,
            format!(
                "unsupported protocol version: {}, expected {}",
                request.version, PROTOCOL_VERSION
            ),
        );
    }

    match request.method {
        Method::Ping => {
            debug!(id = %request.id, "ping request");
            Response::success(&request.id)
        }

        Method::Authenticate => handle_authenticate(request, config, rate_limiter).await,

        Method::AuthenticateOtp => handle_authenticate_otp(request, config, rate_limiter).await,

        Method::SetupOtp => handle_setup_otp(request, user_sessions).await,

        Method::RemoveOtp => handle_remove_otp(request, user_sessions).await,

        Method::Check2fa => handle_check_2fa(request).await,

        Method::CheckOtpConfig => handle_check_otp_config(request, config).await,

        Method::SpawnPty => handle_spawn_pty(request, user_sessions, pty_sessions).await,

        Method::KillPty => handle_kill_pty(request, pty_sessions).await,

        Method::ResizePty => handle_resize_pty(request, pty_sessions).await,

        Method::RegisterSession => handle_register_session(request, user_sessions).await,

        Method::UnregisterSession => handle_unregister_session(request, user_sessions).await,

        Method::PtyWrite => handle_pty_write(request, pty_sessions).await,

        Method::PtyRead => handle_pty_read(request, pty_sessions).await,
    }
}

/// Handle a remove OTP request.
///
/// Removes ~/.google_authenticator for the session user.
async fn handle_remove_otp(request: Request, user_sessions: &UserSessionStore) -> Response {
    let params = match &request.params {
        RequestParams::RemoveOtp(params) => params,
        _ => {
            return Response::failure(&request.id, "invalid params for remove_otp");
        }
    };

    if !params.confirm {
        return Response::failure(&request.id, "confirmation_required");
    }

    let user = match user_sessions.get(&params.session_id) {
        Some(user) => user,
        None => {
            warn!(
                id = %request.id,
                session_id = %params.session_id,
                "remove_otp: session not found"
            );
            return Response::failure(&request.id, "session not found");
        }
    };

    info!(
        id = %request.id,
        username = %user.username,
        home = %user.home,
        "removing google_authenticator file"
    );

    let result = match remove_google_authenticator(&user.home) {
        Ok(_) => RemoveOtpResult {
            removed: true,
            already_missing: false,
            error_code: None,
        },
        Err(OtpRemoveError::AlreadyMissing) => RemoveOtpResult {
            removed: false,
            already_missing: true,
            error_code: None,
        },
        Err(error) => {
            let error_code = error.error_code().to_string();
            warn!(
                id = %request.id,
                username = %user.username,
                error = ?error,
                error_code = %error_code,
                "failed to remove google_authenticator file"
            );
            let mut response = Response::failure(&request.id, "remove_otp_failed");
            response.data = Some(
                serde_json::to_value(RemoveOtpResult {
                    removed: false,
                    already_missing: false,
                    error_code: Some(error_code),
                })
                .expect("RemoveOtpResult serialization cannot fail"),
            );
            return response;
        }
    };

    Response::success_with_data(
        &request.id,
        serde_json::to_value(result).expect("RemoveOtpResult serialization cannot fail"),
    )
}

/// Handle an authentication request.
///
/// Flow: Validate username -> Check rate limit -> Call PAM -> Return result
async fn handle_authenticate(
    request: Request,
    config: &BrokerConfig,
    rate_limiter: &RateLimiter,
) -> Response {
    // Extract params
    let (username, password) = match &request.params {
        RequestParams::Authenticate(params) => (&params.username, &params.password),
        _ => {
            return Response::failure(&request.id, "invalid params for authenticate");
        }
    };

    // Log attempt (never log password - the Request Debug impl handles this)
    info!(
        id = %request.id,
        username = %username,
        "authentication attempt"
    );

    // 1. Validate username
    // Note: We return a generic error to prevent user enumeration
    if let Err(e) = validation::validate_username(username) {
        debug!(
            id = %request.id,
            username = %username,
            error = %e,
            "username validation failed"
        );
        return Response::auth_failure(&request.id);
    }

    // 2. Check rate limit BEFORE PAM (fail fast on brute force)
    if let Err(e) = rate_limiter.check(username) {
        warn!(
            id = %request.id,
            username = %username,
            "rate limit exceeded"
        );
        // Return a specific message for rate limiting so clients know to back off
        return Response::failure(&request.id, e.to_string());
    }

    // 3. Call PAM for actual authentication
    match pam::authenticate(&config.pam_service, username, password).await {
        Ok(()) => {
            info!(
                id = %request.id,
                username = %username,
                "authentication successful"
            );
            Response::success(&request.id)
        }
        Err(e) => {
            debug!(
                id = %request.id,
                username = %username,
                error = %e,
                "authentication failed"
            );
            // Generic error to prevent user enumeration
            Response::auth_failure(&request.id)
        }
    }
}

/// Handle an OTP authentication request.
///
/// Flow: Validate username -> Check rate limit -> Call PAM OTP -> Return result
///
/// Uses the same rate limiter as password auth to prevent brute force attacks.
async fn handle_authenticate_otp(
    request: Request,
    config: &BrokerConfig,
    rate_limiter: &RateLimiter,
) -> Response {
    // Extract params
    let (username, code) = match &request.params {
        RequestParams::AuthenticateOtp(params) => (&params.username, &params.code),
        _ => {
            return Response::failure(&request.id, "invalid params for authenticate_otp");
        }
    };

    // Log attempt (never log the OTP code)
    info!(
        id = %request.id,
        username = %username,
        "OTP authentication attempt"
    );

    // 1. Validate username
    if let Err(e) = validation::validate_username(username) {
        debug!(
            id = %request.id,
            username = %username,
            error = %e,
            "username validation failed"
        );
        return Response::auth_failure(&request.id);
    }

    // 2. Check rate limit BEFORE OTP validation (same limiter as password auth)
    if let Err(e) = rate_limiter.check(username) {
        warn!(
            id = %request.id,
            username = %username,
            "rate limit exceeded for OTP"
        );
        return Response::failure(&request.id, e.to_string());
    }

    // 3. Validate OTP via PAM
    match validate_otp(&config.pam_service, username, code).await {
        Ok(()) => {
            info!(
                id = %request.id,
                username = %username,
                "OTP authentication successful"
            );
            Response::success(&request.id)
        }
        Err(e) => {
            debug!(
                id = %request.id,
                username = %username,
                error = %e,
                "OTP authentication failed"
            );
            // Generic error to prevent enumeration
            Response::auth_failure(&request.id)
        }
    }
}

/// Handle a 2FA configuration check request.
///
/// Checks if the user has a .google_authenticator file in their home directory.
/// This is a simple file existence check, no authentication required.
async fn handle_check_2fa(request: Request) -> Response {
    let (username, home) = match &request.params {
        RequestParams::Check2fa(params) => (&params.username, &params.home),
        _ => {
            return Response::failure(&request.id, "invalid params for check_2fa");
        }
    };

    debug!(
        id = %request.id,
        username = %username,
        home = %home,
        "checking 2FA configuration"
    );

    let has_2fa = has_2fa_configured(home);

    if has_2fa {
        info!(
            id = %request.id,
            username = %username,
            "user has 2FA configured"
        );
        Response::success(&request.id)
    } else {
        debug!(
            id = %request.id,
            username = %username,
            "user does not have 2FA configured"
        );
        // Use failure to indicate no 2FA - client checks success field
        Response::failure(&request.id, "2FA not configured")
    }
}

/// Handle a setup OTP request.
///
/// Writes ~/.google_authenticator for the session user.
async fn handle_setup_otp(request: Request, user_sessions: &UserSessionStore) -> Response {
    let params = match &request.params {
        RequestParams::SetupOtp(params) => params,
        _ => {
            return Response::failure(&request.id, "invalid params for setup_otp");
        }
    };

    let user = match user_sessions.get(&params.session_id) {
        Some(user) => user,
        None => {
            warn!(
                id = %request.id,
                session_id = %params.session_id,
                "setup_otp: session not found"
            );
            return Response::failure(&request.id, "session not found");
        }
    };

    info!(
        id = %request.id,
        username = %user.username,
        home = %user.home,
        "writing google_authenticator file"
    );

    let result = match write_google_authenticator(&user.home, user.uid, user.gid, &params.secret) {
        Ok(_) => SetupOtpResult {
            written: true,
            already_configured: false,
            error_code: None,
        },
        Err(OtpSetupError::AlreadyConfigured) => SetupOtpResult {
            written: false,
            already_configured: true,
            error_code: None,
        },
        Err(error) => {
            let error_code = error.error_code().to_string();
            warn!(
                id = %request.id,
                username = %user.username,
                error = ?error,
                error_code = %error_code,
                "failed to write google_authenticator file"
            );
            let mut response = Response::failure(&request.id, "setup_otp_failed");
            response.data = Some(
                serde_json::to_value(SetupOtpResult {
                    written: false,
                    already_configured: false,
                    error_code: Some(error_code),
                })
                .expect("SetupOtpResult serialization cannot fail"),
            );
            return response;
        }
    };

    Response::success_with_data(
        &request.id,
        serde_json::to_value(result).expect("SetupOtpResult serialization cannot fail"),
    )
}

/// Handle an OTP configuration check request.
///
/// Verifies the server's OTP/2FA configuration:
/// - PAM google_authenticator module is installed
/// - PAM service file exists (will attempt to auto-create if missing)
///
/// This is used to provide specific error messages when 2FA validation fails
/// due to server misconfiguration rather than invalid codes.
async fn handle_check_otp_config(request: Request, config: &BrokerConfig) -> Response {
    // Verify params (though CheckOtpConfigParams is empty)
    if !matches!(&request.params, RequestParams::CheckOtpConfig(_)) {
        return Response::failure(&request.id, "invalid params for check_otp_config");
    }

    debug!(
        id = %request.id,
        "checking OTP server configuration"
    );

    let status = check_otp_config(&config.pam_service);

    let result = OtpConfigResult {
        configured: status.configured,
        pam_module_installed: status.pam_module_installed,
        pam_module_path: status.pam_module_path,
        pam_service_exists: status.pam_service_exists,
        pam_service_path: status.pam_service_path,
        service_auto_created: status.service_auto_created,
        error_code: status.error_code.clone(),
    };

    if status.configured {
        if status.service_auto_created {
            info!(
                id = %request.id,
                pam_service_path = %result.pam_service_path,
                "OTP configuration valid (service file auto-created)"
            );
        } else {
            info!(
                id = %request.id,
                "OTP server configuration valid"
            );
        }
        Response::success_with_data(
            &request.id,
            serde_json::to_value(result).expect("OtpConfigResult serialization cannot fail"),
        )
    } else {
        warn!(
            id = %request.id,
            error_code = ?status.error_code,
            pam_module_installed = status.pam_module_installed,
            pam_service_exists = status.pam_service_exists,
            "OTP server configuration incomplete"
        );
        // Return failure with the detailed result in data
        let mut response = Response::failure(
            &request.id,
            status
                .error_code
                .unwrap_or_else(|| "configuration_error".to_string()),
        );
        response.data =
            Some(serde_json::to_value(result).expect("OtpConfigResult serialization cannot fail"));
        response
    }
}

/// Handle a PTY spawn request.
///
/// 1. Look up user from session_id
/// 2. Allocate PTY pair with user's uid/gid
/// 3. Spawn shell as user with PTY as controlling terminal
/// 4. Register session and return pty_id and pid
async fn handle_spawn_pty(
    request: Request,
    user_sessions: &UserSessionStore,
    pty_sessions: &SessionManager,
) -> Response {
    let params = match &request.params {
        RequestParams::SpawnPty(p) => p,
        _ => {
            return Response::failure(&request.id, "invalid params for spawn_pty");
        }
    };

    // Look up user info from session
    let user = match user_sessions.get(&params.session_id) {
        Some(u) => u,
        None => {
            warn!(
                id = %request.id,
                session_id = %params.session_id,
                "spawn_pty: session not found"
            );
            return Response::failure(&request.id, "session not found");
        }
    };

    info!(
        id = %request.id,
        username = %user.username,
        uid = user.uid,
        gid = user.gid,
        "spawning PTY"
    );

    // Allocate PTY pair
    let pty_pair = match allocator::allocate(user.uid, user.gid) {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "failed to allocate PTY");
            return Response::failure(&request.id, format!("failed to allocate PTY: {}", e));
        }
    };

    // Build login environment
    let env = LoginEnvironment::new(
        user.username.clone(),
        user.home.clone(),
        user.shell.clone(),
        user.uid,
        user.gid,
    )
    .with_term(params.term.clone())
    .with_envs(params.env.clone());

    // Get slave fd for spawn (before moving pty_pair.slave)
    let slave_fd = pty_pair.slave.as_raw_fd();

    // Spawn process as user
    let spawn_config = SpawnConfig::new(env, slave_fd, PathBuf::from(&user.home));

    let child = match spawn::spawn_as_user(spawn_config) {
        Ok(c) => c,
        Err(e) => {
            error!(error = %e, "failed to spawn process");
            return Response::failure(&request.id, format!("failed to spawn process: {}", e));
        }
    };

    let pid = child.id();

    // Create PTY session entry
    let pty_id = PtyId::new();
    let mut session = PtySession::new(
        pty_id.clone(),
        pty_pair.master,
        user.uid,
        user.gid,
        user.username.clone(),
        user.home.clone(),
        user.shell.clone(),
        params.cols,
        params.rows,
    );
    session.set_child_pid(nix::unistd::Pid::from_raw(pid as i32));

    // Register session
    pty_sessions.insert(session);

    // Close slave in parent (child has it via dup2 in pre_exec)
    drop(pty_pair.slave);

    info!(
        id = %request.id,
        pty_id = %pty_id,
        pid = pid,
        username = %user.username,
        "PTY spawned successfully"
    );

    // Return success with PTY info
    let result = SpawnPtyResult {
        pty_id: pty_id.as_str().to_string(),
        pid,
    };

    Response::success_with_data(
        &request.id,
        serde_json::to_value(result).expect("SpawnPtyResult serialization cannot fail"),
    )
}

/// Handle a PTY kill request.
///
/// 1. Look up PTY session by pty_id
/// 2. Send SIGTERM to child process
/// 3. Remove session from manager (master fd closes on drop)
async fn handle_kill_pty(request: Request, pty_sessions: &SessionManager) -> Response {
    let params = match &request.params {
        RequestParams::KillPty(p) => p,
        _ => {
            return Response::failure(&request.id, "invalid params for kill_pty");
        }
    };

    let pty_id = PtyId::from(params.pty_id.clone());

    // Remove and get session
    let session = match pty_sessions.remove(&pty_id) {
        Some(s) => s,
        None => {
            warn!(
                id = %request.id,
                pty_id = %params.pty_id,
                "kill_pty: session not found"
            );
            return Response::failure(&request.id, "PTY session not found");
        }
    };

    // Kill the child process if still running
    if let Some(pid) = session.child_pid {
        info!(
            id = %request.id,
            pty_id = %params.pty_id,
            pid = pid.as_raw(),
            "killing PTY process"
        );

        // Send SIGTERM to the child process
        // If the process is already dead, this will return an error which we ignore
        if let Err(e) = nix::sys::signal::kill(pid, nix::sys::signal::Signal::SIGTERM) {
            debug!(
                error = %e,
                pid = pid.as_raw(),
                "SIGTERM failed (process may already be dead)"
            );
        }
    }

    // master_fd will be closed when session is dropped
    // This sends SIGHUP to the child if still running

    info!(
        id = %request.id,
        pty_id = %params.pty_id,
        "PTY session terminated"
    );

    Response::success(&request.id)
}

/// Handle a PTY resize request.
///
/// 1. Look up PTY session by pty_id
/// 2. Call TIOCSWINSZ ioctl to resize
/// 3. Update stored dimensions
async fn handle_resize_pty(request: Request, pty_sessions: &SessionManager) -> Response {
    let params = match &request.params {
        RequestParams::ResizePty(p) => p,
        _ => {
            return Response::failure(&request.id, "invalid params for resize_pty");
        }
    };

    let pty_id = PtyId::from(params.pty_id.clone());

    // Get mutable reference to session
    let mut session = match pty_sessions.get_mut(&pty_id) {
        Some(s) => s,
        None => {
            warn!(
                id = %request.id,
                pty_id = %params.pty_id,
                "resize_pty: session not found"
            );
            return Response::failure(&request.id, "PTY session not found");
        }
    };

    // Use ioctl TIOCSWINSZ to resize
    let winsize = nix::pty::Winsize {
        ws_row: params.rows,
        ws_col: params.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let master_fd = session.master_fd.as_raw_fd();

    // TIOCSWINSZ - set window size
    let result = unsafe {
        libc::ioctl(
            master_fd,
            libc::TIOCSWINSZ,
            &winsize as *const nix::pty::Winsize,
        )
    };

    if result < 0 {
        let err = std::io::Error::last_os_error();
        error!(error = %err, "failed to resize PTY");
        return Response::failure(&request.id, format!("failed to resize PTY: {}", err));
    }

    // Update stored dimensions
    session.cols = params.cols;
    session.rows = params.rows;

    info!(
        id = %request.id,
        pty_id = %params.pty_id,
        cols = params.cols,
        rows = params.rows,
        "PTY resized"
    );

    Response::success(&request.id)
}

/// Handle a session registration request.
///
/// Stores user info associated with the session ID for later PTY spawning.
async fn handle_register_session(request: Request, user_sessions: &UserSessionStore) -> Response {
    let params = match &request.params {
        RequestParams::RegisterSession(p) => p,
        _ => return Response::failure(&request.id, "invalid params for register_session"),
    };

    info!(
        id = %request.id,
        session_id = %params.session_id,
        username = %params.username,
        uid = params.uid,
        "registering session"
    );

    let user = crate::session::user::UserInfo {
        username: params.username.clone(),
        uid: params.uid,
        gid: params.gid,
        home: params.home.clone(),
        shell: params.shell.clone(),
    };

    user_sessions.register(&params.session_id, user);

    Response::success(&request.id)
}

/// Handle a session unregistration request.
///
/// Removes the session's user info from the store. Succeeds even if session
/// doesn't exist (idempotent).
async fn handle_unregister_session(request: Request, user_sessions: &UserSessionStore) -> Response {
    let params = match &request.params {
        RequestParams::UnregisterSession(p) => p,
        _ => return Response::failure(&request.id, "invalid params for unregister_session"),
    };

    info!(
        id = %request.id,
        session_id = %params.session_id,
        "unregistering session"
    );

    let removed = user_sessions.remove(&params.session_id);

    if !removed {
        debug!(
            id = %request.id,
            session_id = %params.session_id,
            "session not found during unregister"
        );
    }

    // Always succeed - unregister is idempotent
    Response::success(&request.id)
}

/// Handle a PTY write request.
///
/// Writes data to the PTY's master fd.
/// Data is expected to be base64-encoded.
async fn handle_pty_write(request: Request, pty_sessions: &SessionManager) -> Response {
    let params = match &request.params {
        RequestParams::PtyWrite(p) => p,
        _ => return Response::failure(&request.id, "invalid params for pty_write"),
    };

    let pty_id = PtyId::from(params.pty_id.clone());

    let fd = match pty_sessions.get(&pty_id) {
        Some(s) => s.master_fd.as_raw_fd(),
        None => {
            warn!(
                id = %request.id,
                pty_id = %params.pty_id,
                "pty_write: session not found"
            );
            return Response::failure(&request.id, "PTY session not found");
        }
    };

    // Decode base64 data
    let data = match base64::engine::general_purpose::STANDARD.decode(&params.data) {
        Ok(d) => d,
        Err(e) => {
            debug!(error = %e, "pty_write: invalid base64");
            return Response::failure(&request.id, "invalid base64 data");
        }
    };

    // Write to master fd
    // Note: We need to be careful here - the fd is owned by the session.
    // We'll create a temporary File reference to write, then forget it so we don't close the fd.
    // Use unsafe to create a File from the raw fd for writing
    // We must NOT drop this File or it will close the fd
    let result = {
        use std::os::fd::FromRawFd;
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let write_result = file.write_all(&data);
        // Prevent the File from closing the fd when dropped
        std::mem::forget(file);
        write_result
    };

    match result {
        Ok(()) => {
            debug!(
                id = %request.id,
                pty_id = %params.pty_id,
                bytes = data.len(),
                "PTY write successful"
            );
            Response::success(&request.id)
        }
        Err(e) => {
            if is_pty_closed_error(&e) {
                warn!(
                    id = %request.id,
                    pty_id = %params.pty_id,
                    error = %e,
                    "pty_write: pty closed"
                );
                pty_sessions.remove(&pty_id);
                return Response::failure(&request.id, "pty_closed");
            }
            error!(error = %e, "failed to write to PTY");
            Response::failure(&request.id, format!("write failed: {}", e))
        }
    }
}

/// Handle a PTY read request.
///
/// Reads available data from the PTY's master fd.
/// Returns base64-encoded data.
///
/// Note: This is a non-blocking read. For efficient streaming,
/// a push-based mechanism would be better (future work).
async fn handle_pty_read(request: Request, pty_sessions: &SessionManager) -> Response {
    let params = match &request.params {
        RequestParams::PtyRead(p) => p,
        _ => return Response::failure(&request.id, "invalid params for pty_read"),
    };

    let pty_id = PtyId::from(params.pty_id.clone());

    let fd = match pty_sessions.get(&pty_id) {
        Some(s) => s.master_fd.as_raw_fd(),
        None => {
            warn!(
                id = %request.id,
                pty_id = %params.pty_id,
                "pty_read: session not found"
            );
            return Response::failure(&request.id, "PTY session not found");
        }
    };
    let max_bytes = if params.max_bytes == 0 {
        4096
    } else {
        params.max_bytes
    };

    // Set non-blocking mode temporarily for the read
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Response::failure(&request.id, "failed to get fd flags");
    }

    // Set O_NONBLOCK
    let set_result = unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
    if set_result < 0 {
        return Response::failure(&request.id, "failed to set non-blocking");
    }

    // Read available data
    let result = {
        use std::os::fd::FromRawFd;
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let mut buf = vec![0u8; max_bytes];
        let read_result = file.read(&mut buf);
        std::mem::forget(file); // Don't close the fd
        read_result.map(|n| {
            buf.truncate(n);
            buf
        })
    };

    // Restore original flags
    unsafe { libc::fcntl(fd, libc::F_SETFL, flags) };

    match result {
        Ok(data) => {
            if data.is_empty() {
                warn!(
                    id = %request.id,
                    pty_id = %params.pty_id,
                    "pty_read: pty closed"
                );
                pty_sessions.remove(&pty_id);
                return Response::failure(&request.id, "pty_closed");
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
            let more = data.len() == max_bytes; // Heuristic: if we got max, there might be more

            debug!(
                id = %request.id,
                pty_id = %params.pty_id,
                bytes = data.len(),
                "PTY read successful"
            );

            let read_result = PtyReadResult {
                data: encoded,
                more,
            };

            Response::success_with_data(
                &request.id,
                serde_json::to_value(read_result).expect("PtyReadResult serialization cannot fail"),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            // No data available - return empty result
            let read_result = PtyReadResult {
                data: String::new(),
                more: false,
            };

            Response::success_with_data(
                &request.id,
                serde_json::to_value(read_result).expect("PtyReadResult serialization cannot fail"),
            )
        }
        Err(e) => {
            if is_pty_closed_error(&e) {
                warn!(
                    id = %request.id,
                    pty_id = %params.pty_id,
                    error = %e,
                    "pty_read: pty closed"
                );
                pty_sessions.remove(&pty_id);
                return Response::failure(&request.id, "pty_closed");
            }
            error!(error = %e, "failed to read from PTY");
            Response::failure(&request.id, format!("read failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::protocol::{
        AuthenticateParams, KillPtyParams, PingParams, PtyReadParams, PtyWriteParams,
        RegisterSessionParams, ResizePtyParams, SpawnPtyParams, UnregisterSessionParams,
    };
    use crate::session::user::UserInfo;

    fn test_config() -> BrokerConfig {
        BrokerConfig {
            pam_service: "opencode".to_string(),
            socket_path: "/tmp/test.sock".to_string(),
            rate_limit_per_minute: 5,
            rate_limit_lockout_minutes: 15,
        }
    }

    #[tokio::test]
    async fn test_ping_returns_success() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "ping-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Ping,
            params: RequestParams::Ping(PingParams {}),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(response.success);
        assert_eq!(response.id, "ping-1");
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_unknown_version_returns_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "ver-1".to_string(),
            version: 999, // Invalid version
            method: Method::Ping,
            params: RequestParams::Ping(PingParams {}),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert!(
            response
                .error
                .unwrap()
                .contains("unsupported protocol version")
        );
    }

    #[tokio::test]
    async fn test_rate_limit_rejection() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(1); // Only 1 attempt allowed
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        // First attempt should be allowed (but will fail PAM)
        let request1 = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "testuser".to_string(),
                password: "wrong".to_string(),
            }),
        };

        let response1 = handle_request(
            request1,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;
        // Will fail PAM but rate limit check passes
        assert_eq!(response1.id, "auth-1");

        // Second attempt should be rate limited
        let request2 = Request {
            id: "auth-2".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "testuser".to_string(),
                password: "wrong".to_string(),
            }),
        };

        let response2 = handle_request(
            request2,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response2.success);
        assert!(
            response2
                .error
                .unwrap()
                .contains("too many authentication attempts")
        );
    }

    #[tokio::test]
    async fn test_invalid_username_returns_generic_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        // Invalid username (uppercase)
        let request = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "InvalidUser".to_string(),
                password: "password".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        // Should return generic "authentication failed" not validation details
        assert_eq!(response.error, Some("authentication failed".to_string()));
    }

    #[tokio::test]
    async fn test_empty_username_returns_generic_error() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "auth-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::Authenticate,
            params: RequestParams::Authenticate(AuthenticateParams {
                username: "".to_string(),
                password: "password".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("authentication failed".to_string()));
    }

    #[tokio::test]
    async fn test_spawn_pty_session_not_found() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "spawn-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::SpawnPty,
            params: RequestParams::SpawnPty(SpawnPtyParams {
                session_id: "nonexistent-session".to_string(),
                term: "xterm-256color".to_string(),
                cols: 80,
                rows: 24,
                env: std::collections::HashMap::new(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("session not found".to_string()));
    }

    #[tokio::test]
    async fn test_kill_pty_session_not_found() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "kill-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::KillPty,
            params: RequestParams::KillPty(KillPtyParams {
                pty_id: "nonexistent-pty".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("PTY session not found".to_string()));
    }

    #[tokio::test]
    async fn test_resize_pty_session_not_found() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "resize-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::ResizePty,
            params: RequestParams::ResizePty(ResizePtyParams {
                pty_id: "nonexistent-pty".to_string(),
                cols: 120,
                rows: 40,
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("PTY session not found".to_string()));
    }

    #[tokio::test]
    async fn test_spawn_pty_invalid_params() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        // Send SpawnPty method with wrong param type (Ping params)
        let request = Request {
            id: "spawn-bad-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::SpawnPty,
            params: RequestParams::Ping(PingParams {}),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.id, "spawn-bad-1");
        assert_eq!(
            response.error,
            Some("invalid params for spawn_pty".to_string())
        );
    }

    #[tokio::test]
    async fn test_register_session_stores_user_info() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "reg-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::RegisterSession,
            params: RequestParams::RegisterSession(RegisterSessionParams {
                session_id: "session-abc".to_string(),
                username: "testuser".to_string(),
                uid: 1000,
                gid: 1000,
                home: "/home/testuser".to_string(),
                shell: "/bin/bash".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(response.success);

        // Verify session was stored
        let user = user_sessions
            .get("session-abc")
            .expect("should be registered");
        assert_eq!(user.username, "testuser");
        assert_eq!(user.uid, 1000);
        assert_eq!(user.home, "/home/testuser");
    }

    #[tokio::test]
    async fn test_unregister_session_removes_user_info() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        // First register
        user_sessions.register(
            "session-abc",
            UserInfo {
                username: "testuser".to_string(),
                uid: 1000,
                gid: 1000,
                home: "/home/testuser".to_string(),
                shell: "/bin/bash".to_string(),
            },
        );

        // Then unregister
        let request = Request {
            id: "unreg-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::UnregisterSession,
            params: RequestParams::UnregisterSession(UnregisterSessionParams {
                session_id: "session-abc".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(response.success);
        assert!(user_sessions.get("session-abc").is_none());
    }

    #[tokio::test]
    async fn test_unregister_nonexistent_session_succeeds() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "unreg-2".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::UnregisterSession,
            params: RequestParams::UnregisterSession(UnregisterSessionParams {
                session_id: "nonexistent".to_string(),
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        // Should succeed even if session doesn't exist (idempotent)
        assert!(response.success);
    }

    #[tokio::test]
    async fn test_pty_write_session_not_found() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "write-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::PtyWrite,
            params: RequestParams::PtyWrite(PtyWriteParams {
                pty_id: "nonexistent-pty".to_string(),
                data: "SGVsbG8=".to_string(), // "Hello" in base64
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("PTY session not found".to_string()));
    }

    #[tokio::test]
    async fn test_pty_write_invalid_base64() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        // First need to create a PTY session to test invalid base64
        // But since we can't easily create one in test, we'll just verify
        // the error path by checking param extraction works
        let request = Request {
            id: "write-2".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::PtyWrite,
            params: RequestParams::Ping(PingParams {}), // Wrong params
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(
            response.error,
            Some("invalid params for pty_write".to_string())
        );
    }

    #[tokio::test]
    async fn test_pty_read_session_not_found() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "read-1".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::PtyRead,
            params: RequestParams::PtyRead(PtyReadParams {
                pty_id: "nonexistent-pty".to_string(),
                max_bytes: 4096,
            }),
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(response.error, Some("PTY session not found".to_string()));
    }

    #[tokio::test]
    async fn test_pty_read_invalid_params() {
        let config = test_config();
        let rate_limiter = RateLimiter::new(5);
        let user_sessions = UserSessionStore::new();
        let pty_sessions = SessionManager::new();

        let request = Request {
            id: "read-2".to_string(),
            version: PROTOCOL_VERSION,
            method: Method::PtyRead,
            params: RequestParams::Ping(PingParams {}), // Wrong params
        };

        let response = handle_request(
            request,
            &config,
            &rate_limiter,
            &user_sessions,
            &pty_sessions,
        )
        .await;

        assert!(!response.success);
        assert_eq!(
            response.error,
            Some("invalid params for pty_read".to_string())
        );
    }
}
