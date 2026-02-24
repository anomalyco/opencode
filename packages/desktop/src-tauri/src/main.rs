// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// borrowed from https://github.com/skyline69/balatro-mod-manager
#[cfg(target_os = "linux")]
fn configure_display_backend() -> Option<String> {
    use opencode_lib::linux_windowing::{Backend, SessionEnv, select_backend};
    use std::env;

    let set_env_if_absent = |key: &str, value: &str| {
        if env::var_os(key).is_none() {
            // Safety: called during startup before any threads are spawned, so mutating the
            // process environment is safe.
            unsafe { env::set_var(key, value) };
        }
    };

    let session = SessionEnv::capture();
    let prefer_wayland = opencode_lib::linux_display::read_wayland().unwrap_or(false);
    let decision = select_backend(&session, prefer_wayland)?;

    match decision.backend {
        Backend::X11 => {
            set_env_if_absent("WINIT_UNIX_BACKEND", "x11");
            set_env_if_absent("GDK_BACKEND", "x11");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        Backend::Wayland => {
            set_env_if_absent("WINIT_UNIX_BACKEND", "wayland");
            set_env_if_absent("GDK_BACKEND", "wayland");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        Backend::Auto => {
            set_env_if_absent("GDK_BACKEND", "wayland,x11");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    Some(decision.note)
}

fn main() {
    // Ensure loopback connections are never sent through proxy settings.
    // Some VPNs/proxies set HTTP_PROXY/HTTPS_PROXY/ALL_PROXY without excluding localhost.
    const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

    let upsert = |key: &str| {
        let mut items = std::env::var(key)
            .unwrap_or_default()
            .split(',')
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .collect::<Vec<_>>();

        for host in LOOPBACK {
            if items.iter().any(|v| v.eq_ignore_ascii_case(host)) {
                continue;
            }
            items.push(host.to_string());
        }

        // Safety: called during startup before any threads are spawned.
        unsafe { std::env::set_var(key, items.join(",")) };
    };

    upsert("NO_PROXY");
    upsert("no_proxy");

    #[cfg(target_os = "linux")]
    {
        if let Some(backend_note) = configure_display_backend() {
            eprintln!("{backend_note}");
        }
    }

    opencode_lib::run()
}
