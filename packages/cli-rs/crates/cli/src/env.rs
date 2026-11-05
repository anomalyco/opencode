//! Process environment: NO_PROXY and OPENCODE_CLIENT (`packages/cli/src/index.ts:22-33,148`).

/// The loopback hosts every client request to the local service must reach without a proxy.
const LOOPBACK: &str = "127.0.0.1,localhost,::1";

/// Sets `NO_PROXY` and `no_proxy` to the same merged list: both inherited lists plus the loopback
/// hosts. reqwest reads `NO_PROXY` and falls back to `no_proxy`; servers this client starts inherit
/// both. Call it before any thread starts.
#[allow(unsafe_code)]
pub fn apply_no_proxy() {
    let value = no_proxy(std::env::var("NO_PROXY").ok().as_deref(), std::env::var("no_proxy").ok().as_deref());
    // SAFETY: `main` calls this first, before any other thread exists.
    unsafe {
        std::env::set_var("NO_PROXY", &value);
        std::env::set_var("no_proxy", &value);
    }
}

/// The merged list: trimmed, non-empty entries in order, each once.
pub fn no_proxy(upper: Option<&str>, lower: Option<&str>) -> String {
    let mut entries: Vec<&str> = Vec::new();
    for entry in [upper, lower, Some(LOOPBACK)]
        .into_iter()
        .flatten()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    entries.join(",")
}

/// The client name in telemetry and logs: `OPENCODE_CLIENT`, else `opencode-rs` (plan 6.1). As with
/// TS's `??`, an empty value is kept.
pub fn client() -> String {
    std::env::var("OPENCODE_CLIENT").unwrap_or_else(|_| "opencode-rs".to_owned())
}

#[cfg(test)]
mod tests {
    use super::no_proxy;

    #[test]
    fn no_proxy_merges_both_spellings_with_the_loopback_hosts() {
        let cases: [(Option<&str>, Option<&str>, &str); 6] = [
            (None, None, "127.0.0.1,localhost,::1"),
            (Some(""), Some(" , "), "127.0.0.1,localhost,::1"),
            (Some("corp.example, .internal"), None, "corp.example,.internal,127.0.0.1,localhost,::1"),
            (None, Some("lower.example"), "lower.example,127.0.0.1,localhost,::1"),
            (Some("a,localhost"), Some("b, a"), "a,localhost,b,127.0.0.1,::1"),
            (Some("*"), Some("*"), "*,127.0.0.1,localhost,::1"),
        ];
        for (upper, lower, expected) in cases {
            assert_eq!(no_proxy(upper, lower), expected, "{upper:?} {lower:?}");
        }
    }
}
