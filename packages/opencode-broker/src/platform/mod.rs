#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "macos")]
pub mod macos;

/// Returns platform-specific default socket path
pub fn default_socket_path() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "/run/opencode/auth.sock"
    }

    #[cfg(target_os = "macos")]
    {
        "/var/run/opencode/auth.sock"
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        "/tmp/opencode/auth.sock"
    }
}

/// Returns platform-specific PAM service file source path
pub fn pam_service_source() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "service/opencode.pam.macos"
    }

    #[cfg(not(target_os = "macos"))]
    {
        "service/opencode.pam"
    }
}
