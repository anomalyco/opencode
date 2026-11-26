//! `__host.fetch(request)`'s rules, enforced here; the browser's `fetch` carries the request (the web package calls it
//! with `credentials: "omit"`, no referrer, no cache).
//!
//! `https:` only; the host on the run's allow-list (exact names, `*.` suffix wildcards, `*` for any; an entry may name a
//! port); no URL credentials; no localhost or `.local` names, no private, loopback or link-local literal addresses,
//! unless the host turned on dev mode (`Policy::local_network`): then those destinations, over `http:` too, when an
//! entry other than `*` declares them (widgets-live.md, "Local network in dev mode"); methods GET,
//! POST, PUT, PATCH, DELETE, HEAD; no cookie headers either way; request body <= 256 KB, response body <= 2 MB; 15 s
//! per request; at most 4 in flight and 10 a second per run. Rejections are errors with `kind` (`CapabilityDenied`,
//! `Network`, `Timeout`, `TooLarge`, `RateLimited`) and `message`.
//!
//! What a browser can't do: resolve names (a public name that resolves to a private address isn't caught here, though
//! Chromium's Private Network Access blocks most such requests), or show redirect hops: the browser follows them
//! (at most 20), and the final URL is checked against the same rules before the program sees anything.

use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use psychoscript::{HostError, HostString, HostValue};
use url::Url;

use crate::time::Instant;

pub const MAX_REQUEST_BYTES: usize = 256 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
pub const TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_IN_FLIGHT: usize = 4;
pub const MAX_PER_SECOND: usize = 10;
const METHODS: [&str; 6] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
/// Request headers the program can't set: cookies and credentials, and what the browser owns.
const DROPPED_HEADERS: [&str; 13] = [
    "cookie",
    "cookie2",
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-connection",
    "origin",
];

/// Whether `ip` is a public unicast address a widget may reach.
pub fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => public_v4(v4),
            None => public_v6(v6),
        },
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..128).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || a >= 240)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (first & 0xffc0) == 0xfec0
        || (first == 0x2001 && ip.segments()[1] == 0x0db8)
        || ip.to_ipv4().is_some_and(|v4| !public_v4(v4)))
}

/// A rejection the program sees: an error with `kind` and `message`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rejection {
    pub kind: &'static str,
    pub message: String,
}

impl Rejection {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Rejection {
        Rejection {
            kind,
            message: message.into(),
        }
    }

    pub fn denied(message: impl Into<String>) -> Rejection {
        Rejection::new("CapabilityDenied", message)
    }

    pub fn rate_limited(message: impl Into<String>) -> Rejection {
        Rejection::new("RateLimited", message)
    }

    /// The kind a transport failure names (`Network`, `Timeout`, `TooLarge`), `Network` for any other.
    pub fn transport(kind: &str, message: impl Into<String>) -> Rejection {
        let kind = match kind {
            "Timeout" => "Timeout",
            "TooLarge" => "TooLarge",
            _ => "Network",
        };
        Rejection::new(kind, message)
    }

    pub fn value(self) -> HostValue {
        HostValue::Error(Box::new(
            HostError::named(self.kind, self.message.as_str())
                .with_field("kind", HostValue::String(self.kind.into())),
        ))
    }
}

/// A request body: text as the program gave it, or bytes from `body64`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Body {
    Text(String),
    Bytes(Vec<u8>),
}

impl Body {
    fn len(&self) -> usize {
        match self {
            Body::Text(t) => t.len(),
            Body::Bytes(b) => b.len(),
        }
    }
}

/// A request as the program gave it, checked for shape and against the rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub url: Url,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Body>,
}

impl Request {
    pub fn parse(value: Option<&HostValue>, policy: &Policy) -> Result<Request, Rejection> {
        let bad = |m: &str| Rejection::new("Network", format!("invalid request: {m}"));
        let Some(value) = value else {
            return Err(bad("expected { url, method?, headers?, body? }"));
        };
        let url = match value {
            HostValue::String(s) => s.to_string_lossy().into_owned(),
            _ => value
                .get("url")
                .and_then(HostValue::as_str)
                .ok_or_else(|| bad("no url"))?
                .to_owned(),
        };
        let url = Url::parse(&url).map_err(|e| bad(&format!("{url}: {e}")))?;
        check_url(&url, policy)?;
        let method = match value.get("method") {
            None | Some(HostValue::Undefined | HostValue::Null) => "GET".to_owned(),
            Some(m) => m
                .as_str()
                .ok_or_else(|| bad("method isn't a string"))?
                .to_ascii_uppercase(),
        };
        if !METHODS.contains(&method.as_str()) {
            return Err(Rejection::denied(format!(
                "method {method} isn't allowed (GET, POST, PUT, PATCH, DELETE, HEAD)"
            )));
        }
        let mut headers = Vec::new();
        if let Some(HostValue::Object(fields)) = value.get("headers") {
            for (name, v) in fields {
                let name = name.to_string_lossy().to_ascii_lowercase();
                let value = match v {
                    HostValue::String(s) => s.to_string_lossy().into_owned(),
                    HostValue::Number(n) => n.to_string(),
                    HostValue::Bool(b) => b.to_string(),
                    _ => continue,
                };
                if !DROPPED_HEADERS.contains(&name.as_str()) && !name.starts_with("sec-") {
                    headers.push((name, value));
                }
            }
        }
        let body = match (value.get("body"), value.get("body64")) {
            (Some(HostValue::String(s)), _) => Some(Body::Text(s.to_string_lossy().into_owned())),
            (_, Some(HostValue::String(s))) => Some(Body::Bytes(
                base64_decode(&s.to_string_lossy()).ok_or_else(|| bad("body64 isn't base64"))?,
            )),
            _ => None,
        };
        if body.as_ref().is_some_and(|b| b.len() > MAX_REQUEST_BYTES) {
            return Err(Rejection::new(
                "TooLarge",
                format!("the request body is over {} KB", MAX_REQUEST_BYTES / 1024),
            ));
        }
        if body.is_some() && matches!(method.as_str(), "GET" | "HEAD") {
            return Err(bad(&format!("a {method} request can't have a body")));
        }
        Ok(Request {
            url,
            method,
            headers,
            body,
        })
    }

    /// `{ id, url, method, headers: [[name, value]], body? | body64?, timeoutMs, maxResponseBytes }` for the
    /// browser side.
    pub fn to_json(&self, id: u64) -> String {
        let mut out = serde_json::Map::new();
        out.insert("type".into(), "fetch".into());
        out.insert("id".into(), id.into());
        out.insert("url".into(), self.url.as_str().into());
        out.insert("method".into(), self.method.as_str().into());
        out.insert(
            "headers".into(),
            serde_json::Value::Array(
                self.headers
                    .iter()
                    .map(|(n, v)| serde_json::json!([n, v]))
                    .collect(),
            ),
        );
        match &self.body {
            Some(Body::Text(t)) => {
                out.insert("body".into(), t.as_str().into());
            }
            Some(Body::Bytes(b)) => {
                out.insert("body64".into(), base64_encode(b).into());
            }
            None => {}
        }
        out.insert("timeoutMs".into(), (TIMEOUT.as_millis() as u64).into());
        out.insert("maxResponseBytes".into(), MAX_RESPONSE_BYTES.into());
        serde_json::Value::Object(out).to_string()
    }
}

/// What a run's `fetch` may reach: the widget template's declared hosts and, in dev mode (`local_network`), the local
/// network among them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Policy {
    /// Exact names or addresses, `*.` suffixes, `*` for any; an entry may name a port (`localhost:4097`,
    /// `[::1]:8080`), and then matches only that port.
    pub hosts: Vec<String>,
    /// Dev mode: also loopback, private and link-local destinations and local names (`localhost`, `*.local`), over
    /// `http:` too, when an entry other than `*` declares them.
    pub local_network: bool,
}

/// An allow-list entry: its host pattern (lowercase, no brackets or trailing dot) and port, if it names one.
fn entry(raw: &str) -> (String, Option<u16>) {
    let e = raw.trim().to_ascii_lowercase();
    let (host, port) = if let Some(rest) = e.strip_prefix('[') {
        match rest.split_once(']') {
            Some((h, tail)) => (
                h.to_owned(),
                tail.strip_prefix(':').and_then(|p| p.parse().ok()),
            ),
            None => (rest.to_owned(), None),
        }
    } else {
        match e.rsplit_once(':') {
            // One colon and digits after it: a port. More colons: a bare IPv6 address.
            Some((h, p))
                if !h.contains(':') && !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) =>
            {
                (h.to_owned(), p.parse().ok())
            }
            _ => (e.clone(), None),
        }
    };
    (host.trim_end_matches('.').to_owned(), port)
}

/// Whether `host` (at `port`) is on `allowed`: exact names, `*.` suffixes (not the bare domain), `*` unless
/// `explicit`; an entry with a port matches only that port.
pub fn host_allowed(host: &str, port: Option<u16>, allowed: &[String], explicit: bool) -> bool {
    let host = host
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    allowed.iter().any(|raw| {
        let (pattern, want) = entry(raw);
        if want.is_some() && want != port {
            return false;
        }
        match pattern.strip_prefix("*.") {
            _ if pattern == "*" => !explicit,
            Some(suffix) => {
                host.len() > suffix.len() + 1
                    && host.ends_with(suffix)
                    && host[..host.len() - suffix.len()].ends_with('.')
            }
            None => host == pattern,
        }
    })
}

/// Whether a URL's host is on the local network: a loopback, private, link-local or other non-public address, or a
/// local name.
fn local(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Ipv4(ip) => !public_v4(*ip),
        url::Host::Ipv6(ip) => !public(IpAddr::V6(*ip)),
        url::Host::Domain(d) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost"
                || d.ends_with(".localhost")
                || d.ends_with(".local")
                || d.ends_with(".internal")
                || !d.contains('.')
        }
    }
}

/// A URL the run may reach: no credentials and a declared host; `https:` to a public destination, or in dev mode a
/// declared local one over `https:` or `http:`.
pub fn check_url(url: &Url, policy: &Policy) -> Result<(), Rejection> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Rejection::denied("URLs with credentials aren't allowed"));
    }
    let Some(host) = url.host() else {
        return Err(Rejection::denied("the URL has no host"));
    };
    let is_local = local(&host);
    let dev = policy.local_network && is_local;
    if url.scheme() != "https" && !(dev && url.scheme() == "http") {
        return Err(Rejection::denied(format!(
            "only https: URLs, not {}:",
            url.scheme()
        )));
    }
    let name = match &host {
        url::Host::Domain(d) => (*d).to_owned(),
        url::Host::Ipv4(ip) => ip.to_string(),
        url::Host::Ipv6(ip) => ip.to_string(),
    };
    if !host_allowed(&name, url.port_or_known_default(), &policy.hosts, is_local) {
        return Err(Rejection::denied(format!(
            "{name}{} isn't among the hosts this widget may reach",
            url.port().map(|p| format!(":{p}")).unwrap_or_default()
        )));
    }
    if is_local && !dev {
        return Err(Rejection::denied(match host {
            url::Host::Domain(_) => format!("{name} is a local name (the local network is off)"),
            _ => format!("{name} isn't a public address (the local network is off)"),
        }));
    }
    Ok(())
}

/// A run's fetch budget: in flight, and started in the last second.
#[derive(Default)]
pub struct Budget {
    pub in_flight: usize,
    recent: VecDeque<Instant>,
}

impl Budget {
    pub fn admit(&mut self) -> Result<(), Rejection> {
        let now = Instant::now();
        while self
            .recent
            .front()
            .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(1))
        {
            self.recent.pop_front();
        }
        if self.in_flight >= MAX_IN_FLIGHT {
            return Err(Rejection::rate_limited(format!(
                "at most {MAX_IN_FLIGHT} requests in flight"
            )));
        }
        if self.recent.len() >= MAX_PER_SECOND {
            return Err(Rejection::rate_limited(format!(
                "at most {MAX_PER_SECOND} requests a second"
            )));
        }
        self.in_flight += 1;
        self.recent.push_back(now);
        Ok(())
    }
}

/// What the browser got: `{ status, url, headers }` (the final URL after redirects; headers as `[[name, value]]` or
/// an object) as JSON, and the body bytes. Checked, then made `{ status, url, headers, body | body64 }`: the body as
/// text when it's UTF-8, else base64.
pub fn response(meta_json: &str, body: Vec<u8>, policy: &Policy) -> Result<HostValue, Rejection> {
    let meta: serde_json::Value = serde_json::from_str(meta_json)
        .map_err(|e| Rejection::new("Network", format!("bad response from the host: {e}")))?;
    let status = meta
        .get("status")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    let url = meta
        .get("url")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let url = Url::parse(url)
        .map_err(|e| Rejection::new("Network", format!("bad final URL {url}: {e}")))?;
    check_url(&url, policy).map_err(|r| Rejection::denied(format!("redirected: {}", r.message)))?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(Rejection::new(
            "TooLarge",
            format!("the response body is over {} MB", MAX_RESPONSE_BYTES >> 20),
        ));
    }
    let mut headers: Vec<(HostString, HostValue)> = Vec::new();
    let pairs: Vec<(String, String)> = match meta.get("headers") {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|p| {
                Some((
                    p.get(0)?.as_str()?.to_owned(),
                    p.get(1)?.as_str()?.to_owned(),
                ))
            })
            .collect(),
        Some(serde_json::Value::Object(map)) => map
            .iter()
            .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned())))
            .collect(),
        _ => Vec::new(),
    };
    for (name, value) in pairs {
        let name = name.to_ascii_lowercase();
        if name == "set-cookie" || name == "set-cookie2" {
            continue;
        }
        match headers
            .iter_mut()
            .find(|(k, _)| k.as_str() == Some(name.as_str()))
        {
            Some((_, HostValue::String(v))) => {
                *v = format!("{}, {}", v.to_string_lossy(), value).into()
            }
            _ => headers.push((name.into(), HostValue::String(value.into()))),
        }
    }
    let body = match String::from_utf8(body) {
        Ok(text) => ("body", HostValue::String(text.into())),
        Err(e) => (
            "body64",
            HostValue::String(base64_encode(e.as_bytes()).into()),
        ),
    };
    Ok(HostValue::object([
        ("status", HostValue::Number(status)),
        ("url", HostValue::String(url.as_str().into())),
        ("headers", HostValue::Object(headers)),
        body,
    ]))
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut n, mut bits) = (0u32, 0);
    for c in text
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
    {
        let v = ALPHABET.iter().position(|a| *a == c)? as u32;
        n = (n << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((n >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    fn policy(list: &[&str], local_network: bool) -> Policy {
        Policy {
            hosts: hosts(list),
            local_network,
        }
    }

    #[test]
    fn hosts_match_exactly_or_by_suffix() {
        let allowed = hosts(&["api.github.com", "*.coingecko.com"]);
        let ok = |h: &str| host_allowed(h, Some(443), &allowed, false);
        assert!(ok("api.github.com"));
        assert!(ok("API.GitHub.com."));
        assert!(!ok("github.com"));
        assert!(ok("pro.api.coingecko.com"));
        assert!(!ok("coingecko.com"));
        assert!(!ok("evilcoingecko.com"));
        assert!(host_allowed(
            "anything.example",
            Some(443),
            &hosts(&["*"]),
            false
        ));
        assert!(!host_allowed("localhost", Some(80), &hosts(&["*"]), true));
    }

    #[test]
    fn entries_may_name_a_port() {
        let allowed = hosts(&[
            "localhost:4097",
            "[::1]:8080",
            "127.0.0.1",
            "api.example.com:8443",
        ]);
        assert!(host_allowed("localhost", Some(4097), &allowed, true));
        assert!(!host_allowed("localhost", Some(4098), &allowed, true));
        assert!(host_allowed("::1", Some(8080), &allowed, true));
        assert!(!host_allowed("::1", Some(80), &allowed, true));
        assert!(host_allowed("127.0.0.1", Some(3000), &allowed, true));
        assert!(host_allowed("api.example.com", Some(8443), &allowed, false));
        assert!(!host_allowed("api.example.com", Some(443), &allowed, false));
        assert!(host_allowed(
            "fe80::1",
            Some(80),
            &hosts(&["fe80::1"]),
            true
        ));
    }

    #[test]
    fn urls_follow_the_rules() {
        let any = policy(&["*"], false);
        let check = |u: &str| check_url(&Url::parse(u).unwrap(), &any).map_err(|r| r.kind);
        assert_eq!(check("https://example.com/x"), Ok(()));
        assert_eq!(check("http://example.com/x"), Err("CapabilityDenied"));
        assert_eq!(
            check("https://user:pw@example.com/"),
            Err("CapabilityDenied")
        );
        assert_eq!(check("https://localhost/"), Err("CapabilityDenied"));
        assert_eq!(check("https://printer.local/"), Err("CapabilityDenied"));
        assert_eq!(check("https://10.0.0.1/"), Err("CapabilityDenied"));
        assert_eq!(check("https://[::1]/"), Err("CapabilityDenied"));
        assert_eq!(check("https://169.254.169.254/"), Err("CapabilityDenied"));
        assert_eq!(check("https://1.1.1.1/"), Ok(()));
        // A declared local host is still refused while the local network is off.
        let declared = policy(&["localhost:4097", "10.0.0.5"], false);
        let off = |u: &str| check_url(&Url::parse(u).unwrap(), &declared).map_err(|r| r.message);
        assert!(
            off("http://localhost:4097/")
                .unwrap_err()
                .contains("only https")
        );
        assert!(
            off("https://localhost:4097/")
                .unwrap_err()
                .contains("local network is off")
        );
        assert!(
            off("https://10.0.0.5/")
                .unwrap_err()
                .contains("local network is off")
        );
    }

    #[test]
    fn dev_mode_lets_declared_local_hosts_through() {
        let dev = policy(
            &[
                "localhost:4097",
                "127.0.0.1",
                "*.local",
                "192.168.1.20:8000",
                "*",
            ],
            true,
        );
        let check = |u: &str| check_url(&Url::parse(u).unwrap(), &dev).map_err(|r| r.message);
        assert_eq!(check("http://localhost:4097/api"), Ok(()));
        assert_eq!(check("https://localhost:4097/api"), Ok(()));
        assert!(
            check("http://localhost:4098/")
                .unwrap_err()
                .contains("isn't among the hosts")
        );
        assert_eq!(check("http://127.0.0.1:5173/"), Ok(()));
        assert_eq!(check("http://printer.local/status"), Ok(()));
        assert_eq!(check("http://192.168.1.20:8000/"), Ok(()));
        // `*` doesn't declare the local network, and plain http stays local-only.
        assert!(
            check("http://10.0.0.1/")
                .unwrap_err()
                .contains("isn't among the hosts")
        );
        assert!(
            check("http://example.com/")
                .unwrap_err()
                .contains("only https")
        );
        assert_eq!(check("https://example.com/"), Ok(()));
        // Redirects end where the same rules allow.
        let to_local = response(
            r#"{"status":200,"url":"http://localhost:4097/x"}"#,
            Vec::new(),
            &policy(&["api.example.com"], true),
        );
        assert_eq!(to_local.unwrap_err().kind, "CapabilityDenied");
    }

    #[test]
    fn responses_are_checked_and_shaped() {
        let allowed = policy(&["api.example.com"], false);
        let ok = response(
            r#"{"status":200,"url":"https://api.example.com/a","headers":[["Content-Type","text/plain"],["Set-Cookie","a=b"]]}"#,
            b"hi".to_vec(),
            &allowed,
        )
        .unwrap();
        assert_eq!(ok.get("body").and_then(HostValue::as_str), Some("hi"));
        let headers = ok.get("headers").unwrap();
        assert!(headers.get("set-cookie").is_none());
        assert_eq!(
            headers.get("content-type").and_then(HostValue::as_str),
            Some("text/plain")
        );
        let binary = response(
            r#"{"status":200,"url":"https://api.example.com/a"}"#,
            vec![0xff, 0x00],
            &allowed,
        )
        .unwrap();
        assert_eq!(
            binary.get("body64").and_then(HostValue::as_str),
            Some("/wA=")
        );
        let redirected = response(
            r#"{"status":200,"url":"https://elsewhere.com/"}"#,
            Vec::new(),
            &allowed,
        );
        assert_eq!(redirected.unwrap_err().kind, "CapabilityDenied");
        let big = response(
            r#"{"status":200,"url":"https://api.example.com/"}"#,
            vec![b'a'; MAX_RESPONSE_BYTES + 1],
            &allowed,
        );
        assert_eq!(big.unwrap_err().kind, "TooLarge");
    }

    #[test]
    fn budget_limits_in_flight_and_rate() {
        let mut b = Budget::default();
        for _ in 0..MAX_IN_FLIGHT {
            b.admit().unwrap();
        }
        assert_eq!(b.admit().unwrap_err().kind, "RateLimited");
        b.in_flight = 0;
        for _ in MAX_IN_FLIGHT..MAX_PER_SECOND {
            b.admit().unwrap();
            b.in_flight = 0;
        }
        assert_eq!(b.admit().unwrap_err().kind, "RateLimited");
    }
}
