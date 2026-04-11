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

fn parse_cli_args_from(args: &[String]) -> opencode_lib::CliOptions {
    let mut options = opencode_lib::CliOptions::default();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--port" {
            if let Some(v) = args.get(i + 1) {
                if let Ok(p) = v.parse::<u32>() {
                    if p > 0 && p <= 65535 {
                        options.port = Some(p);
                        i += 2;
                        continue;
                    }
                }
            }
            options
                .warnings
                .push("invalid --port value, using random port".to_string());
            i += 1;
        } else if let Some(v) = args[i].strip_prefix("--port=") {
            if let Ok(p) = v.parse::<u32>() {
                if p > 0 && p <= 65535 {
                    options.port = Some(p);
                } else {
                    options
                        .warnings
                        .push(format!("invalid --port value '{v}', using random port"));
                }
            } else {
                options
                    .warnings
                    .push(format!("invalid --port value '{v}', using random port"));
            }
            i += 1;
        } else if args[i] == "--hostname" {
            if let Some(v) = args.get(i + 1) {
                options.hostname = Some(v.clone());
                i += 2;
            } else {
                options
                    .warnings
                    .push("--hostname requires a value".to_string());
                i += 1;
            }
        } else if let Some(v) = args[i].strip_prefix("--hostname=") {
            options.hostname = Some(v.to_string());
            i += 1;
        } else {
            i += 1;
        }
    }
    options
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

    let options = parse_cli_args_from(&std::env::args().collect::<Vec<_>>());
    opencode_lib::run_with_options(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn port_flag_space_separated() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port", "4096"]));
        assert_eq!(opts.port, Some(4096));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn port_flag_equals_syntax() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port=8080"]));
        assert_eq!(opts.port, Some(8080));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn port_flag_not_specified() {
        let opts = parse_cli_args_from(&args(&["opencode"]));
        assert_eq!(opts.port, None);
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn port_flag_zero_rejected() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port", "0"]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.warnings.len(), 1);
        assert!(opts.warnings[0].contains("--port"));
    }

    #[test]
    fn port_flag_out_of_range() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port=70000"]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.warnings.len(), 1);
    }

    #[test]
    fn port_flag_non_numeric() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port", "abc"]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.warnings.len(), 1);
    }

    #[test]
    fn port_flag_missing_value() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port"]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.warnings.len(), 1);
    }

    #[test]
    fn port_flag_boundary_values() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port", "1"]));
        assert_eq!(opts.port, Some(1));
        let opts = parse_cli_args_from(&args(&["opencode", "--port=65535"]));
        assert_eq!(opts.port, Some(65535));
    }

    #[test]
    fn hostname_flag_space_separated() {
        let opts = parse_cli_args_from(&args(&["opencode", "--hostname", "0.0.0.0"]));
        assert_eq!(opts.hostname.as_deref(), Some("0.0.0.0"));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn hostname_flag_equals_syntax() {
        let opts = parse_cli_args_from(&args(&["opencode", "--hostname=192.168.1.1"]));
        assert_eq!(opts.hostname.as_deref(), Some("192.168.1.1"));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn hostname_flag_missing_value() {
        let opts = parse_cli_args_from(&args(&["opencode", "--hostname"]));
        assert_eq!(opts.hostname, None);
        assert_eq!(opts.warnings.len(), 1);
        assert!(opts.warnings[0].contains("--hostname"));
    }

    #[test]
    fn both_port_and_hostname() {
        let opts = parse_cli_args_from(&args(&[
            "opencode", "--port", "4096", "--hostname", "0.0.0.0",
        ]));
        assert_eq!(opts.port, Some(4096));
        assert_eq!(opts.hostname.as_deref(), Some("0.0.0.0"));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn unknown_flags_ignored() {
        let opts = parse_cli_args_from(&args(&[
            "opencode", "--unknown", "value", "--port", "3000",
        ]));
        assert_eq!(opts.port, Some(3000));
        assert!(opts.warnings.is_empty());
    }

    #[test]
    fn invalid_port_with_valid_hostname() {
        let opts = parse_cli_args_from(&args(&[
            "opencode", "--port", "abc", "--hostname", "0.0.0.0",
        ]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.hostname.as_deref(), Some("0.0.0.0"));
        assert_eq!(opts.warnings.len(), 1);
    }

    #[test]
    fn port_equals_invalid_numeric() {
        let opts = parse_cli_args_from(&args(&["opencode", "--port=99999"]));
        assert_eq!(opts.port, None);
        assert_eq!(opts.warnings.len(), 1);
        assert!(opts.warnings[0].contains("99999"));
    }
}
