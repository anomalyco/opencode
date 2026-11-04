//! Channel and storage channel (F.4).
//!
//! The TypeScript build embeds its channel (`packages/cli/src/version.ts`); the Rust client reads it
//! at run time (plan 6.6). The channel picks the service registration file, the service config file,
//! and the default port (`packages/cli/src/services/service-config.ts:41-77`).

use std::ffi::OsString;

use crate::lock;

/// The channel when `OPENCODE_CHANNEL` is not set. It shares `service.json` and port `0xC0DE` with
/// `dev`, `beta`, and `next`, so it finds a released client's service.
pub const DEFAULT: &str = "latest";

/// The channel and the TUI storage channel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Channels {
    /// Picks the service registration, service config, and default port.
    pub channel: String,
    /// Names the TUI storage directory, `<state>/<storage>/tui`.
    pub storage: String,
}

impl Channels {
    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var_os(name))
    }

    /// `OPENCODE_CHANNEL`, else `latest`. The storage channel is `OPENCODE_TUI_CHANNEL`, else the
    /// channel (`packages/cli/src/commands/handlers/default.ts:100`).
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>) -> Self {
        let set = |name: &str| {
            var(name)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string_lossy().into_owned())
        };
        let channel = set("OPENCODE_CHANNEL").unwrap_or_else(|| DEFAULT.to_string());
        Self {
            storage: set("OPENCODE_TUI_CHANNEL").unwrap_or_else(|| channel.clone()),
            channel,
        }
    }
}

fn shared(channel: &str) -> bool {
    matches!(channel, "latest" | "dev" | "beta" | "next")
}

/// The registration and service config file name: `service.json` for the shared channels, else
/// `service-<channel>.json` with characters outside `[a-zA-Z0-9._-]` replaced by `-`.
pub fn filename(channel: &str) -> String {
    if shared(channel) {
        return "service.json".to_string();
    }
    let safe: String = channel
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("service-{safe}.json")
}

/// The file name earlier builds used for the channel, `service-<sha1(channel)>.json`; none for
/// `latest` and `local`.
pub fn legacy_filename(channel: &str) -> Option<String> {
    if matches!(channel, "latest" | "local") {
        return None;
    }
    Some(format!("service-{}.json", lock::hash(channel)))
}

/// The service's default port. Windows moves ports at or above `0x8000` into the `0x7000` block,
/// keeping the low 12 bits, because it reserves parts of the upper range.
pub fn default_port(channel: &str, windows: bool) -> u16 {
    let port = channel_port(channel);
    if windows && port >= 0x8000 {
        return 0x7000 | (port & 0xfff);
    }
    port
}

fn channel_port(channel: &str) -> u16 {
    if shared(channel) {
        return 0xc0de;
    }
    if channel == "local" {
        return 0xc0df;
    }
    let prefix = u32::from_str_radix(&lock::hash(channel)[..8], 16).expect("sha1 hex");
    (10_000 + prefix % 50_000) as u16
}

/// Whether a registered service version belongs to the channel: the installed version, or a preview
/// version `0.0.0-<channel>-<n>` or `0.0.0-<channel>-<n>.<m>`.
pub fn version_belongs_to_channel(version: Option<&str>, channel: &str, installed: &str) -> bool {
    let Some(version) = version else { return false };
    if version == installed {
        return true;
    }
    let Some(rest) = version.strip_prefix(&format!("0.0.0-{channel}-")) else {
        return false;
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    match rest.split_once('.') {
        Some((major, minor)) => digits(major) && digits(minor),
        None => digits(rest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn channels(vars: &[(&str, &str)]) -> Channels {
        let vars: HashMap<String, OsString> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        Channels::from_vars(|name| vars.get(name).cloned())
    }

    #[test]
    fn channel_from_env() {
        assert_eq!(
            channels(&[]),
            Channels {
                channel: "latest".into(),
                storage: "latest".into()
            }
        );
        assert_eq!(
            channels(&[
                ("OPENCODE_CHANNEL", "oc-x"),
                ("OPENCODE_TUI_CHANNEL", "dev")
            ]),
            Channels {
                channel: "oc-x".into(),
                storage: "dev".into()
            }
        );
        assert_eq!(channels(&[("OPENCODE_CHANNEL", "beta")]).storage, "beta");
        assert_eq!(channels(&[("OPENCODE_CHANNEL", "")]).channel, "latest");
    }

    // The P-ORACLE fixture in tests/interop.rs compares these with the TypeScript functions; these
    // cases pin the obvious ones.
    #[test]
    fn names_and_ports() {
        assert_eq!(filename("latest"), "service.json");
        assert_eq!(filename("next"), "service.json");
        assert_eq!(filename("local"), "service-local.json");
        assert_eq!(filename("feat/a b"), "service-feat-a-b.json");
        assert_eq!(legacy_filename("latest"), None);
        assert_eq!(legacy_filename("local"), None);
        assert_eq!(default_port("latest", false), 0xc0de);
        assert_eq!(default_port("latest", true), 0x70de);
        assert_eq!(default_port("local", false), 0xc0df);
        assert!((10_000..60_000).contains(&default_port("oc-x", false)));
    }

    #[test]
    fn versions() {
        assert!(version_belongs_to_channel(Some("1.2.3"), "latest", "1.2.3"));
        assert!(version_belongs_to_channel(
            Some("0.0.0-oc-x-202601"),
            "oc-x",
            "1.2.3"
        ));
        assert!(version_belongs_to_channel(
            Some("0.0.0-oc-x-2026.1"),
            "oc-x",
            "1.2.3"
        ));
        assert!(!version_belongs_to_channel(
            Some("0.0.0-oc-x-2026."),
            "oc-x",
            "1.2.3"
        ));
        assert!(!version_belongs_to_channel(
            Some("0.0.0-oc-y-1"),
            "oc-x",
            "1.2.3"
        ));
        assert!(!version_belongs_to_channel(None, "oc-x", "1.2.3"));
    }
}
