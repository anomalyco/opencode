//! The WebSocket reader against a server that writes frames cut at random points. Messages come whole and in order
//! whatever the cuts, fragments and control frames between them; then a close frame or the end of the stream closes
//! the socket, and a frame the protocol forbids fails it, as Bun's `WebSocket` fires `close` alone or `error` first.
//! Random bytes after the handshake end the socket either way. `MODEL_SEED` and `MODEL_CASES` set the search.

use std::time::Duration;

use opencode_api::ws::{self, Incoming};
use opencode_util::rng::SplitMix64;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    Close,
    Eof,
    EofInFrame,
    Forbidden(&'static str),
    Garbage,
}

fn header(fin: bool, opcode: u8, length: usize) -> Vec<u8> {
    let mut out = vec![u8::from(fin) << 7 | opcode];
    match length {
        0..126 => out.push(length as u8),
        126..65_536 => {
            out.push(126);
            out.extend((length as u16).to_be_bytes());
        }
        _ => {
            out.push(127);
            out.extend((length as u64).to_be_bytes());
        }
    }
    out
}

fn frame(fin: bool, opcode: u8, payload: &[u8]) -> Vec<u8> {
    [header(fin, opcode, payload.len()), payload.to_vec()].concat()
}

fn pick<T: Copy>(rng: &mut SplitMix64, items: &[T]) -> T {
    items[rng.below(items.len() as u64) as usize]
}

/// The bytes a server writes, and what the client must deliver.
fn generate(rng: &mut SplitMix64) -> (Vec<u8>, Vec<Incoming>, Ending) {
    let (mut bytes, mut expected) = (Vec::new(), Vec::new());
    let control = |rng: &mut SplitMix64, bytes: &mut Vec<u8>| {
        if rng.below(3) == 0 {
            let payload = vec![b'p'; rng.below(126) as usize];
            bytes.extend(frame(true, pick(rng, &[0x9, 0xa]), &payload));
        }
    };
    for _ in 0..rng.below(6) {
        let length = pick(rng, &[0, 1, 5, 125, 126, 300, 65_535, 70_000]);
        let text = rng.below(2) == 0;
        let payload: Vec<u8> = match text {
            true => (0..length).map(|i| ["a", "é", "€", "😀"][(i + length) % 4]).collect::<String>().into_bytes(),
            false => (0..length).map(|_| rng.below(256) as u8).collect(),
        };
        let mut cuts: Vec<usize> = (0..rng.below(4)).map(|_| rng.below(payload.len() as u64 + 1) as usize).collect();
        cuts.extend([0, payload.len()]);
        cuts.sort();
        cuts.dedup();
        let pieces: Vec<&[u8]> = match cuts.len() {
            1 => vec![&payload[..]],
            _ => cuts.windows(2).map(|pair| &payload[pair[0]..pair[1]]).collect(),
        };
        for (index, piece) in pieces.iter().enumerate() {
            let opcode = if index > 0 {
                0x0
            } else if text {
                0x1
            } else {
                0x2
            };
            bytes.extend(frame(index + 1 == pieces.len(), opcode, piece));
            control(rng, &mut bytes);
        }
        expected.push(match text {
            true => Incoming::Text(String::from_utf8(payload).unwrap()),
            false => Incoming::Binary(payload),
        });
    }
    let ending = pick(
        rng,
        &[
            Ending::Close,
            Ending::Eof,
            Ending::EofInFrame,
            Ending::Forbidden("reserved opcode"),
            Ending::Forbidden("reserved bit"),
            Ending::Forbidden("masked"),
            Ending::Forbidden("invalid UTF-8"),
            Ending::Forbidden("long control"),
            Ending::Forbidden("fragmented control"),
            Ending::Forbidden("lone continuation"),
            Ending::Forbidden("interrupted message"),
            Ending::Forbidden("oversized"),
            Ending::Garbage,
        ],
    );
    match ending {
        Ending::Close => bytes.extend(frame(true, 0x8, &[&1000_u16.to_be_bytes()[..], b"bye"].concat())),
        Ending::Eof => {}
        Ending::EofInFrame => {
            let whole = frame(true, 0x2, &[7; 300]);
            bytes.extend(&whole[..1 + rng.below(whole.len() as u64 - 1) as usize]);
        }
        Ending::Forbidden(kind) => bytes.extend(match kind {
            "reserved opcode" => frame(true, 0x3, b"x"),
            "reserved bit" => [vec![0xc2, 1], b"x".to_vec()].concat(),
            "masked" => vec![0x82, 0x81, 1, 2, 3, 4, 9],
            "invalid UTF-8" => frame(true, 0x1, &[0xc3, 0x28]),
            "long control" => frame(true, 0x9, &[0; 126]),
            "fragmented control" => frame(false, 0x9, b""),
            "lone continuation" => frame(true, 0x0, b"x"),
            "interrupted message" => [frame(false, 0x1, b"a"), frame(true, 0x2, b"b")].concat(),
            _ => header(true, 0x2, 1 << 40),
        }),
        Ending::Garbage => bytes.extend((0..1 + rng.below(64)).map(|_| rng.below(256) as u8)),
    }
    (bytes, expected, ending)
}

/// Accepts one socket, answers the handshake, writes `bytes` in random cuts, then closes the stream once the client
/// has had time to read.
async fn serve(bytes: Vec<u8>, cuts: u64) -> url::Url {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        stream.set_nodelay(true).unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                return;
            }
            request.push(byte[0]);
        }
        let request = String::from_utf8(request).unwrap();
        let key = request
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase().starts_with("sec-websocket-key:").then(|| line[18..].trim().to_owned())
            })
            .unwrap();
        let accept = derive_accept_key(key.as_bytes());
        let head = format!(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
        );
        let _ = stream.write_all(head.as_bytes()).await;
        let mut rng = SplitMix64(cuts);
        let mut rest = &bytes[..];
        while !rest.is_empty() {
            let length = 1 + rng.below(rest.len().min(4_096) as u64) as usize;
            if stream.write_all(&rest[..length]).await.is_err() {
                return;
            }
            rest = &rest[length..];
            if rng.below(4) == 0 {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        }
        // Reads until the client closes, for at most a moment, then ends the stream.
        let mut sink = [0; 1024];
        let _ = tokio::time::timeout(Duration::from_millis(300), async {
            while stream.read(&mut sink).await.unwrap_or(0) > 0 {}
        })
        .await;
    });
    opencode_api::js::parse_url(&format!("ws://{address}/socket")).unwrap()
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

#[tokio::test]
async fn frames_cut_anywhere_give_the_same_messages_and_end() {
    let seed = env("MODEL_SEED", 1);
    let mut rng = SplitMix64(seed);
    for case in 0..env("MODEL_CASES", 10) {
        let (bytes, expected, ending) = generate(&mut rng);
        let cuts = rng.below(u64::MAX);
        let url = serve(bytes, cuts).await;
        let mut socket = ws::open::<Vec<u8>>(url, Vec::new()).await.unwrap();
        let mut got = Vec::new();
        let last = loop {
            let item = tokio::time::timeout(Duration::from_secs(10), socket.incoming.recv()).await;
            match item.unwrap_or_else(|_| panic!("case {case}: the socket did not end")) {
                Some(Incoming::Closed) => break Incoming::Closed,
                Some(Incoming::Failed(error)) => break Incoming::Failed(error),
                Some(message) => got.push(message),
                None => break Incoming::Failed("queue closed".into()),
            }
        };
        let context = || format!("MODEL_SEED={seed} case {case} cuts {cuts} {ending:?}: {last:?}");
        if ending == Ending::Garbage {
            assert!(got.len() >= expected.len() && got[..expected.len()] == expected[..], "{}", context());
            continue;
        }
        assert_eq!(got.len(), expected.len(), "{}", context());
        assert!(got == expected, "{}", context());
        match ending {
            Ending::Forbidden(_) => assert!(matches!(last, Incoming::Failed(_)), "{}", context()),
            _ => assert_eq!(last, Incoming::Closed, "{}", context()),
        }
    }
}
