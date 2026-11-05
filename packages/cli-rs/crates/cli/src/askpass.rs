//! SSH askpass helper mode (`packages/cli/src/ssh-askpass.ts`).
//!
//! The desktop SSH plugin points `SSH_ASKPASS` at this binary and sets `OPENCODE_SSH_ASKPASS_PORT`.
//! OpenSSH runs it with the prompt as its arguments. The helper sends the prompt to the desktop over
//! a loopback socket and prints the answer for OpenSSH. It runs before the logger is installed, so
//! neither the prompt nor the answer reaches a log, and it writes nothing else to stdout or stderr.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The port when the process runs as the askpass helper.
pub fn port() -> Option<String> {
    std::env::var("OPENCODE_SSH_ASKPASS_PORT").ok().filter(|port| !port.is_empty())
}

/// Runs the helper from the process environment and returns its exit code.
pub fn run(port: &str) -> u8 {
    let request = Request {
        token: std::env::var("OPENCODE_SSH_ASKPASS_TOKEN").ok(),
        text: std::env::args_os().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" "),
        confirm: std::env::var("SSH_ASKPASS_PROMPT").as_deref() == Ok("confirm"),
    };
    ask(port, &request, TIMEOUT, &mut std::io::stdout().lock())
}

pub struct Request {
    pub token: Option<String>,
    pub text: String,
    pub confirm: bool,
}

/// Sends `request` to the desktop on `port`, writes the answer and a newline to `out`, and returns 0.
/// A `null` answer, a bad port, a socket or decode error, or `timeout` returns 1.
pub fn ask(port: &str, request: &Request, timeout: Duration, out: &mut impl Write) -> u8 {
    let answer = parse_port(port).and_then(|port| exchange(port, request, timeout));
    let Some(value) = answer else { return 1 };
    let written = out.write_all(value.as_bytes()).and_then(|()| out.write_all(b"\n")).and_then(|()| out.flush());
    u8::from(written.is_err())
}

fn exchange(port: u16, request: &Request, timeout: Duration) -> Option<String> {
    let deadline = Instant::now() + timeout;
    let mut socket = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), timeout).ok()?;
    // Keys in TS's order; `JSON.stringify` drops an undefined token.
    let mut body = serde_json::Map::new();
    if let Some(token) = &request.token {
        body.insert("token".into(), token.as_str().into());
    }
    body.insert("text".into(), request.text.as_str().into());
    body.insert("confirm".into(), request.confirm.into());
    let mut line = serde_json::Value::Object(body).to_string();
    line.push('\n');
    socket.set_write_timeout(Some(remaining(deadline)?)).ok()?;
    socket.write_all(line.as_bytes()).ok()?;
    // Read to the end; a socket error ends the read as the peer closing would.
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        socket.set_read_timeout(Some(remaining(deadline)?)).ok()?;
        match socket.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&chunk[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                return None;
            }
            Err(_) => break,
        }
    }
    // The response is decoded as a whole, so a character split across reads stays intact.
    let value: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(&response)).ok()?;
    match value.as_object()?.get("value")? {
        serde_json::Value::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero())
}

/// `Schema.NumberFromString` with an integer in 1..=65535: JavaScript's `Number(text)`, which trims
/// whitespace and accepts `0x`, `0o`, `0b`, exponents, and fractions that are whole.
fn parse_port(text: &str) -> Option<u16> {
    let text = text.trim();
    let radix = [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)]
        .into_iter()
        .find_map(|(prefix, radix)| text.strip_prefix(prefix).map(|digits| (digits, radix)));
    let number = match radix {
        Some((digits, radix)) => u32::from_str_radix(digits, radix).ok().map(f64::from)?,
        // Rust also reads "inf" and "nan", which fail the integer check below like JS's Infinity.
        None => text.parse::<f64>().ok()?,
    };
    (number.fract() == 0.0 && number > 0.0 && number <= 65535.0).then_some(number as u16)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    use super::{Request, ask, parse_port};

    /// A one-shot desktop: reads the request line, sends `chunks` with a pause between them, closes.
    fn desktop(chunks: Vec<Vec<u8>>) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_nodelay(true).unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8];
            while socket.read(&mut byte).unwrap() == 1 && byte[0] != b'\n' {
                request.push(byte[0]);
            }
            for (index, chunk) in chunks.iter().enumerate() {
                if index > 0 {
                    std::thread::sleep(Duration::from_millis(50));
                }
                socket.write_all(chunk).unwrap();
                socket.flush().unwrap();
            }
            String::from_utf8(request).unwrap()
        });
        (port, handle)
    }

    fn request(token: Option<&str>, confirm: bool) -> Request {
        Request { token: token.map(str::to_owned), text: "Enter passphrase:".into(), confirm }
    }

    #[test]
    fn returns_only_the_response_and_sends_the_prompt() {
        let (port, desktop) = desktop(vec![br#"{"value":"passphrase\"with spaces"}"#.to_vec()]);
        let mut out = Vec::new();
        let code = ask(&port, &request(Some("fixture"), true), Duration::from_secs(10), &mut out);
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8(out).unwrap(), "passphrase\"with spaces\n");
        assert_eq!(desktop.join().unwrap(), r#"{"token":"fixture","text":"Enter passphrase:","confirm":true}"#);
    }

    #[test]
    fn a_response_split_inside_a_multi_byte_character_is_written_intact() {
        let response = r#"{"value":"pässwörd"}"#.as_bytes().to_vec();
        let split = response.iter().position(|byte| *byte == 0xc3).unwrap() + 1;
        let (port, desktop) = desktop(vec![response[..split].to_vec(), response[split..].to_vec()]);
        let mut out = Vec::new();
        let code = ask(&port, &request(Some("fixture"), false), Duration::from_secs(10), &mut out);
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8(out).unwrap(), "pässwörd\n");
        assert_eq!(desktop.join().unwrap(), r#"{"token":"fixture","text":"Enter passphrase:","confirm":false}"#);
    }

    #[test]
    fn a_missing_token_is_left_out_of_the_request() {
        let (port, desktop) = desktop(vec![br#"{"value":"x","extra":1}"#.to_vec()]);
        let mut out = Vec::new();
        assert_eq!(ask(&port, &request(None, false), Duration::from_secs(10), &mut out), 0);
        assert_eq!(desktop.join().unwrap(), r#"{"text":"Enter passphrase:","confirm":false}"#);
    }

    #[test]
    fn a_refusal_or_a_bad_answer_exits_1_without_output() {
        for response in [&br#"{"value":null}"#[..], br#"{"value":3}"#, br#"{}"#, br#"not json"#, b""] {
            let (port, desktop) = desktop(vec![response.to_vec()]);
            let mut out = Vec::new();
            let code = ask(&port, &request(None, false), Duration::from_secs(10), &mut out);
            assert_eq!((code, out.len()), (1, 0), "{}", String::from_utf8_lossy(response));
            desktop.join().unwrap();
        }
    }

    #[test]
    fn a_silent_desktop_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let mut out = Vec::new();
        let code = ask(&port, &request(None, false), Duration::from_millis(200), &mut out);
        assert_eq!(code, 1);
        drop(listener);
    }

    #[test]
    fn ports_parse_like_javascript_number() {
        let cases = [
            ("8080", Some(8080)),
            (" 8080\n", Some(8080)),
            ("0x1F90", Some(8080)),
            ("8.08e3", Some(8080)),
            ("8080.0", Some(8080)),
            ("+22", Some(22)),
            ("65535", Some(65535)),
            ("65536", None),
            ("0", None),
            ("-1", None),
            ("80.5", None),
            ("", None),
            ("abc", None),
            ("inf", None),
        ];
        for (text, expected) in cases {
            assert_eq!(parse_port(text), expected, "{text:?}");
        }
    }
}
