// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// borrowed from https://github.com/skyline69/balatro-mod-manager
#[cfg(target_os = "linux")]
fn configure_display_backend() -> Option<String> {
    use std::env;

    let set_env_if_absent = |key: &str, value: &str| {
        if env::var_os(key).is_none() {
            // Safety: called during startup before any threads are spawned, so mutating the
            // process environment is safe.
            unsafe { env::set_var(key, value) };
        }
    };

    let on_wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || matches!(
            env::var("XDG_SESSION_TYPE"),
            Ok(v) if v.eq_ignore_ascii_case("wayland")
        );
    if !on_wayland {
        return None;
    }

    // Allow users to explicitly keep Wayland if they know their setup is stable.
    let allow_wayland = matches!(
        env::var("OC_ALLOW_WAYLAND"),
        Ok(v) if matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
    );
    if allow_wayland {
        return Some("Wayland session detected; respecting OC_ALLOW_WAYLAND=1".into());
    }

    // Prefer XWayland when available to avoid Wayland protocol errors seen during startup.
    if env::var_os("DISPLAY").is_some() {
        set_env_if_absent("WINIT_UNIX_BACKEND", "x11");
        set_env_if_absent("GDK_BACKEND", "x11");
        set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        return Some(
            "Wayland session detected; forcing X11 backend to avoid compositor protocol errors. \
               Set OC_ALLOW_WAYLAND=1 to keep native Wayland."
                .into(),
        );
    }

    set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    Some(
        "Wayland session detected without X11; leaving Wayland enabled (set WINIT_UNIX_BACKEND/GDK_BACKEND manually if needed)."
            .into(),
    )
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        if let Some(backend_note) = configure_display_backend() {
            eprintln!("{backend_note:?}");
        }
    }

    opencode_lib::run()
}
