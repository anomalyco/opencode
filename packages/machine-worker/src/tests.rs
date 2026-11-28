use std::fs;
use std::path::Path;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer as _, SigningKey};
use serde::Deserialize;
use snow::params::{CipherChoice, DHChoice, HashChoice};
use snow::resolvers::{CryptoResolver, DefaultResolver};

use crate::Secret;
use crate::frames::{
    FrameError, MAX_MESSAGE, MAX_NOISE_MESSAGE, MAX_PIECE, REKEY_INTERVAL, Session, TAG_LEN,
    fits_within_cap,
};
use crate::join::{self, JoinError, Reach};
use crate::link::{
    Dial, DialOptions, HandshakeCause, Identity, MESSAGE_1_LEN, MESSAGE_2_LEN, MESSAGE_3_LEN,
    NOISE_PARAMS,
};

fn fixture_path(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../core/test/fixture")
        .join(name)
}

fn from_hex(hex: &str) -> Vec<u8> {
    assert_eq!(hex.len() % 2, 0, "odd hex length");
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn from_hex_32(hex: &str) -> [u8; 32] {
    from_hex(hex).try_into().expect("32-byte hex")
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn flip_bit(bytes: &[u8], bit: usize) -> Vec<u8> {
    let mut copy = bytes.to_vec();
    copy[bit >> 3] ^= 1 << (bit & 7);
    copy
}

/// Minimal test responder implementing the home side of `opencode-link-v1` so refusal,
/// framing, and rekey tests can drive `Dial` and `Session` without duplicating TS infra.
struct FakeHome {
    identity: SigningKey,
    static_private: [u8; 32],
    static_public: [u8; 32],
    ephemeral_private: Option<[u8; 32]>,
    rekey_interval: u64,
}

type SignFn<'a> = &'a dyn Fn(&[u8]) -> [u8; 64];

impl FakeHome {
    fn new(seed: [u8; 32], static_private: [u8; 32]) -> Self {
        let mut dh = DefaultResolver
            .resolve_dh(&DHChoice::Curve25519)
            .expect("25519 dh");
        dh.set(&static_private);
        let static_public: [u8; 32] = dh.pubkey().try_into().expect("32-byte pubkey");
        Self {
            identity: SigningKey::from_bytes(&seed),
            static_private,
            static_public,
            ephemeral_private: None,
            rekey_interval: REKEY_INTERVAL,
        }
    }

    fn public_key(&self) -> [u8; 32] {
        self.identity.verifying_key().to_bytes()
    }

    fn with_rekey_interval(mut self, interval: u64) -> Self {
        self.rekey_interval = interval;
        self
    }

    fn start_handshake(&self) -> snow::HandshakeState {
        let mut builder = snow::Builder::new(NOISE_PARAMS.parse().expect("params"))
            .prologue(b"opencode-link-v1")
            .expect("prologue")
            .local_private_key(&self.static_private)
            .expect("local key");
        if let Some(ephemeral) = &self.ephemeral_private {
            builder = builder.fixed_ephemeral_key_for_testing_only(ephemeral);
        }
        builder.build_responder().expect("responder")
    }

    fn accept_msg1_and_write_msg2(
        &self,
        msg1: &[u8],
        claimed_key: Option<[u8; 32]>,
        sign_override: Option<SignFn<'_>>,
    ) -> (snow::HandshakeState, Vec<u8>) {
        let mut hs = self.start_handshake();
        let mut buf = [0u8; 64];
        let n = hs.read_message(msg1, &mut buf).expect("read msg1");
        assert_eq!(n, 0);

        let h1 = hs.get_handshake_hash();
        let mut to_sign = Vec::with_capacity(22 + 32 + 32);
        to_sign.extend_from_slice(b"opencode-link-v1/home:");
        to_sign.extend_from_slice(&self.static_public);
        to_sign.extend_from_slice(h1);

        let key = claimed_key.unwrap_or_else(|| self.public_key());
        let sig = match sign_override {
            Some(f) => f(&to_sign),
            None => self.identity.sign(&to_sign).to_bytes(),
        };

        let mut payload = [0u8; 96];
        payload[..32].copy_from_slice(&key);
        payload[32..].copy_from_slice(&sig);

        let mut msg2 = [0u8; MESSAGE_2_LEN];
        let len = hs.write_message(&payload, &mut msg2).expect("write msg2");
        assert_eq!(len, MESSAGE_2_LEN);
        (hs, msg2.to_vec())
    }

    fn complete_handshake(
        &self,
        mut hs: snow::HandshakeState,
        msg3: &[u8],
        machine: &str,
        max_message: usize,
    ) -> (Session, Vec<u8>, Vec<u8>) {
        let mut payload = [0u8; 129];
        let len = hs.read_message(msg3, &mut payload).expect("read msg3");
        assert_eq!(len, 129);
        let mut transport = hs.into_transport_mode().expect("transport");

        let mut welcome = vec![0u8; machine.len() + TAG_LEN];
        let wlen = transport
            .write_message(machine.as_bytes(), &mut welcome)
            .expect("encrypt welcome");
        welcome.truncate(wlen);

        let sent = 1u64;
        if sent.is_multiple_of(self.rekey_interval) {
            transport.rekey_outgoing();
        }

        let session = Session::from_transport_for_test(
            machine.to_owned(),
            transport,
            sent,
            0,
            self.rekey_interval,
            max_message,
        );
        (session, welcome, payload.to_vec())
    }
}

fn paired_sessions(rekey_interval: u64, max_message: usize) -> (Session, Session) {
    let home = FakeHome::new([0x11; 32], [0x33; 32]).with_rekey_interval(rekey_interval);
    let worker_id = Identity::from_seed([0x22; 32]);
    let options = DialOptions::new(home.public_key(), worker_id, Some(Secret::from([0x44; 32])))
        .with_rekey_interval(rekey_interval);
    let (dial, msg1) = Dial::start(options).expect("start");
    let (hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
    let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
    let (home_session, welcome, _) = home.complete_handshake(hs, &msg3, "gpu", max_message);
    let mut worker_session = awaiting.read_welcome(&welcome).expect("welcome");
    worker_session.set_max_message_for_test(max_message);
    (worker_session, home_session)
}

// =========================================================================
// 1. Pinned v1 transcript (packages/core/test/fixture/link-v1-transcript.json)
// =========================================================================

#[derive(Deserialize)]
struct TranscriptFixture {
    inputs: TranscriptInputs,
    outputs: TranscriptOutputs,
}

#[derive(Deserialize)]
struct TranscriptInputs {
    prologue: String,
    home_seed: String,
    worker_seed: String,
    worker_static: String,
    worker_ephemeral: String,
    secret: String,
    machine: String,
    hello: String,
    to_worker: String,
    to_home: String,
}

#[derive(Deserialize)]
struct TranscriptOutputs {
    home_identity: String,
    worker_identity: String,
    message_1: String,
    message_2: String,
    message_3: String,
    welcome: String,
    hello: String,
    to_worker: String,
    to_home: String,
}

#[test]
fn reproduces_pinned_v1_transcript_byte_for_byte() {
    let raw = fs::read_to_string(fixture_path("link-v1-transcript.json"))
        .expect("read link-v1-transcript.json");
    let fixture: TranscriptFixture = serde_json::from_str(&raw).expect("parse transcript");

    assert_eq!(fixture.inputs.prologue, "opencode-link-v1");

    let home_id = Identity::from_seed(from_hex_32(&fixture.inputs.home_seed));
    let worker_id = Identity::from_seed(from_hex_32(&fixture.inputs.worker_seed));
    assert_eq!(to_hex(&home_id.public_key()), fixture.outputs.home_identity);
    assert_eq!(
        to_hex(&worker_id.public_key()),
        fixture.outputs.worker_identity
    );

    let options = DialOptions::new(
        home_id.public_key(),
        worker_id,
        Some(Secret::from(from_hex_32(&fixture.inputs.secret))),
    )
    .with_fixed_keys(
        from_hex_32(&fixture.inputs.worker_static),
        from_hex_32(&fixture.inputs.worker_ephemeral),
    );

    let (dial, message_1) = Dial::start(options).expect("Dial::start");
    assert_eq!(message_1.len(), MESSAGE_1_LEN);
    assert_eq!(to_hex(&message_1), fixture.outputs.message_1);

    let message_2 = from_hex(&fixture.outputs.message_2);
    assert_eq!(message_2.len(), MESSAGE_2_LEN);
    let (awaiting, message_3) = dial.read_message_2(&message_2).expect("read_message_2");
    assert_eq!(message_3.len(), MESSAGE_3_LEN);
    assert_eq!(to_hex(&message_3), fixture.outputs.message_3);

    let welcome = from_hex(&fixture.outputs.welcome);
    let mut session = awaiting.read_welcome(&welcome).expect("read_welcome");
    assert_eq!(session.machine(), fixture.inputs.machine);

    let hello_frames = session
        .encode(fixture.inputs.hello.as_bytes())
        .expect("encode hello");
    assert_eq!(hello_frames.len(), 1);
    assert_eq!(to_hex(&hello_frames[0]), fixture.outputs.hello);

    let received = session
        .push(&from_hex(&fixture.outputs.to_worker))
        .expect("push to_worker");
    assert_eq!(received, Some(fixture.inputs.to_worker.into_bytes()));

    let to_home_frames = session
        .encode(fixture.inputs.to_home.as_bytes())
        .expect("encode to_home");
    assert_eq!(to_home_frames.len(), 1);
    assert_eq!(to_hex(&to_home_frames[0]), fixture.outputs.to_home);
}

// =========================================================================
// 2. Published Noise XX vectors (packages/core/test/fixture/noise-xx-vectors.json)
// =========================================================================

#[derive(Deserialize)]
struct NoiseVectorsFixture {
    #[serde(rename = "cacophony.txt")]
    cacophony: Vec<NoiseVector>,
    #[serde(rename = "snow.txt")]
    snow: Vec<NoiseVector>,
}

#[derive(Deserialize)]
struct NoiseVector {
    protocol_name: String,
    init_prologue: String,
    init_static: String,
    init_ephemeral: String,
    resp_prologue: String,
    resp_static: String,
    resp_ephemeral: String,
    handshake_hash: Option<String>,
    messages: Vec<NoiseVectorMessage>,
}

#[derive(Deserialize)]
struct NoiseVectorMessage {
    payload: String,
    ciphertext: String,
}

#[test]
fn passes_published_noise_xx_vectors() {
    let raw = fs::read_to_string(fixture_path("noise-xx-vectors.json"))
        .expect("read noise-xx-vectors.json");
    let fixture: NoiseVectorsFixture = serde_json::from_str(&raw).expect("parse noise vectors");

    let all: Vec<&NoiseVector> = fixture.cacophony.iter().chain(&fixture.snow).collect();
    assert_eq!(all.len(), 2);

    for vector in all {
        assert_eq!(vector.protocol_name, NOISE_PARAMS);
        let params: snow::params::NoiseParams = NOISE_PARAMS.parse().expect("params");

        let init_prologue = from_hex(&vector.init_prologue);
        let init_static = from_hex(&vector.init_static);
        let init_ephemeral = from_hex(&vector.init_ephemeral);
        let resp_prologue = from_hex(&vector.resp_prologue);
        let resp_static = from_hex(&vector.resp_static);
        let resp_ephemeral = from_hex(&vector.resp_ephemeral);

        let mut initiator = snow::Builder::new(params.clone())
            .prologue(&init_prologue)
            .expect("init prologue")
            .local_private_key(&init_static)
            .expect("init static")
            .fixed_ephemeral_key_for_testing_only(&init_ephemeral)
            .build_initiator()
            .expect("build initiator");

        let mut responder = snow::Builder::new(params)
            .prologue(&resp_prologue)
            .expect("resp prologue")
            .local_private_key(&resp_static)
            .expect("resp static")
            .fixed_ephemeral_key_for_testing_only(&resp_ephemeral)
            .build_responder()
            .expect("build responder");

        let mut buf = vec![0u8; MAX_NOISE_MESSAGE];
        for (index, msg) in vector.messages[..3].iter().enumerate() {
            let payload = from_hex(&msg.payload);
            let expected_ct = from_hex(&msg.ciphertext);
            let (sender, receiver) = if index % 2 == 0 {
                (&mut initiator, &mut responder)
            } else {
                (&mut responder, &mut initiator)
            };
            let ct_len = sender.write_message(&payload, &mut buf).expect("hs write");
            assert_eq!(&buf[..ct_len], expected_ct.as_slice());

            let mut pt = vec![0u8; MAX_NOISE_MESSAGE];
            let pt_len = receiver
                .read_message(&expected_ct, &mut pt)
                .expect("hs read");
            assert_eq!(&pt[..pt_len], payload.as_slice());
            assert_eq!(
                initiator.get_handshake_hash(),
                responder.get_handshake_hash()
            );
        }

        if let Some(expected_hash) = &vector.handshake_hash {
            assert_eq!(to_hex(initiator.get_handshake_hash()), *expected_hash);
        }

        let mut init_transport = initiator.into_transport_mode().expect("init transport");
        let mut resp_transport = responder.into_transport_mode().expect("resp transport");

        for (index, msg) in vector.messages[3..].iter().enumerate() {
            let payload = from_hex(&msg.payload);
            let expected_ct = from_hex(&msg.ciphertext);
            // Transport message 0 is overall message 4 (responder -> initiator).
            let (sender, receiver) = if index % 2 == 0 {
                (&mut resp_transport, &mut init_transport)
            } else {
                (&mut init_transport, &mut resp_transport)
            };
            let ct_len = sender
                .write_message(&payload, &mut buf)
                .expect("transport write");
            assert_eq!(&buf[..ct_len], expected_ct.as_slice());

            let mut pt = vec![0u8; MAX_NOISE_MESSAGE];
            let pt_len = receiver
                .read_message(&expected_ct, &mut pt)
                .expect("transport read");
            assert_eq!(&pt[..pt_len], payload.as_slice());
        }
    }
}

// =========================================================================
// 3. Join strings (ported from packages/core/test/machine-join.test.ts)
// =========================================================================

// Produced by `Join.encode` in `packages/core/src/machine/join.ts` (and pinned in
// `packages/core/test/machine-join.test.ts`): home=[1;32], secret=[2;32],
// expires=1_767_225_600_000, reach=[{type:"url", url:"https://home.example"}].
const TS_JOIN_STANDARD: &str = "ocjoin_eyJ2IjoxLCJob21lIjoiQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRSIsInNlY3JldCI6IkFnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0kiLCJleHBpcmVzIjoxNzY3MjI1NjAwMDAwLCJyZWFjaCI6W3sidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vaG9tZS5leGFtcGxlIn1dfQ";

// Produced by running `Join.encode` from `packages/core` via Bun:
// home=[0xaa;32], secret=[0x55;32], expires=0, reach=[].
const TS_JOIN_EMPTY_REACH: &str = "ocjoin_eyJ2IjoxLCJob21lIjoicXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxbyIsInNlY3JldCI6IlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlUiLCJleHBpcmVzIjowLCJyZWFjaCI6W119";

// Produced by running `Join.encode` from `packages/core` via Bun:
// home=[0x10;32], secret=[0x20;32], expires=Number.MAX_SAFE_INTEGER (9007199254740991),
// reach=[{type:"url", url:"https://a.example/ws"}, {type:"url", url:"wss://b.example:8443/link"}].
const TS_JOIN_MULTI_REACH: &str = "ocjoin_eyJ2IjoxLCJob21lIjoiRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQSIsInNlY3JldCI6IklDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0EiLCJleHBpcmVzIjo5MDA3MTk5MjU0NzQwOTkxLCJyZWFjaCI6W3sidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vYS5leGFtcGxlL3dzIn0seyJ0eXBlIjoidXJsIiwidXJsIjoid3NzOi8vYi5leGFtcGxlOjg0NDMvbGluayJ9XX0";

// Built from a real `Join.encode` output (home=[0x33;32], secret=[0x44;32],
// expires=1_800_000_000_000, reach=[{type:"url", url:"https://relay.example/ws"}]) via Bun in
// `packages/core`, adding an unknown reach entry `{type:"relay", id:"r1"}` (confirmed accepted
// by TS `Join.decode`).
const TS_JOIN_UNKNOWN_REACH: &str = "ocjoin_eyJ2IjoxLCJob21lIjoiTXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TSIsInNlY3JldCI6IlJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVEiLCJleHBpcmVzIjoxODAwMDAwMDAwMDAwLCJyZWFjaCI6W3sidHlwZSI6InJlbGF5IiwiaWQiOiJyMSJ9LHsidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vcmVsYXkuZXhhbXBsZS93cyJ9XX0";

// Built from the same real `Join.encode` output via Bun in `packages/core`, adding an extra
// top-level field `"future_field":{"nested":[1,2]}` (confirmed accepted by TS `Join.decode`).
const TS_JOIN_EXTRA_FIELD: &str = "ocjoin_eyJ2IjoxLCJob21lIjoiTXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TXpNek16TSIsInNlY3JldCI6IlJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVEiLCJleHBpcmVzIjoxODAwMDAwMDAwMDAwLCJyZWFjaCI6W3sidHlwZSI6InVybCIsInVybCI6Imh0dHBzOi8vcmVsYXkuZXhhbXBsZS93cyJ9XSwiZnV0dXJlX2ZpZWxkIjp7Im5lc3RlZCI6WzEsMl19fQ";

fn encode_join_json(value: &serde_json::Value) -> String {
    let json = serde_json::to_vec(value).expect("serialize json");
    format!("ocjoin_{}", URL_SAFE_NO_PAD.encode(json))
}

fn base_join_json() -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    map.insert("v".into(), serde_json::json!(1));
    map.insert(
        "home".into(),
        serde_json::json!(URL_SAFE_NO_PAD.encode([1u8; 32])),
    );
    map.insert(
        "secret".into(),
        serde_json::json!(URL_SAFE_NO_PAD.encode([2u8; 32])),
    );
    map.insert("expires".into(), serde_json::json!(1_767_225_600_000u64));
    map.insert(
        "reach".into(),
        serde_json::json!([{ "type": "url", "url": "https://home.example" }]),
    );
    map
}

#[test]
fn decodes_real_ts_join_strings() {
    let decoded = join::decode(TS_JOIN_STANDARD).expect("standard join");
    assert_eq!(decoded.home, [1u8; 32]);
    assert_eq!(decoded.secret.as_bytes(), &[2u8; 32]);
    assert_eq!(decoded.expires, 1_767_225_600_000);
    assert_eq!(
        decoded.reach,
        vec![Reach::Url("https://home.example".to_owned())]
    );

    let empty = join::decode(TS_JOIN_EMPTY_REACH).expect("empty reach join");
    assert_eq!(empty.home, [0xaa; 32]);
    assert_eq!(empty.secret.as_bytes(), &[0x55; 32]);
    assert_eq!(empty.expires, 0);
    assert!(empty.reach.is_empty());

    let multi = join::decode(TS_JOIN_MULTI_REACH).expect("multi reach join");
    assert_eq!(multi.home, [0x10; 32]);
    assert_eq!(multi.secret.as_bytes(), &[0x20; 32]);
    assert_eq!(multi.expires, 9_007_199_254_740_991);
    assert_eq!(
        multi.reach,
        vec![
            Reach::Url("https://a.example/ws".to_owned()),
            Reach::Url("wss://b.example:8443/link".to_owned()),
        ]
    );

    for (name, encoded) in [
        ("unknown_reach", TS_JOIN_UNKNOWN_REACH),
        ("extra_field", TS_JOIN_EXTRA_FIELD),
    ] {
        let parsed = join::decode(encoded).unwrap_or_else(|_| panic!("decode {name}"));
        assert_eq!(parsed.home, [0x33; 32]);
        assert_eq!(parsed.secret.as_bytes(), &[0x44; 32]);
        assert_eq!(parsed.expires, 1_800_000_000_000);
        assert_eq!(
            parsed.reach,
            vec![Reach::Url("https://relay.example/ws".to_owned())]
        );
    }
}

#[test]
fn join_rejects_bad_prefix_version_sizes_expiry_and_non_canonical_base64() {
    // Wrong prefix
    assert_eq!(
        join::decode(&TS_JOIN_STANDARD.replacen("ocjoin_", "opencode_", 1)).unwrap_err(),
        JoinError
    );
    assert_eq!(join::decode("").unwrap_err(), JoinError);

    // Wrong version, key length, secret length, expires
    let bad_fields: &[(&str, serde_json::Value)] = &[
        ("v", serde_json::json!(2)),
        ("v", serde_json::json!(0)),
        ("home", serde_json::json!(URL_SAFE_NO_PAD.encode([1u8; 31]))),
        ("home", serde_json::json!(URL_SAFE_NO_PAD.encode([1u8; 33]))),
        (
            "secret",
            serde_json::json!(URL_SAFE_NO_PAD.encode([2u8; 31])),
        ),
        (
            "secret",
            serde_json::json!(URL_SAFE_NO_PAD.encode([2u8; 33])),
        ),
        ("expires", serde_json::json!(-1)),
        ("expires", serde_json::json!(1.5)),
        ("expires", serde_json::json!(9_007_199_254_740_992u64)),
        ("expires", serde_json::json!("soon")),
        // Non-object entry inside reach is rejected
        ("reach", serde_json::json!(["https://home.example"])),
    ];
    for (field, value) in bad_fields {
        let mut obj = base_join_json();
        obj.insert((*field).into(), value.clone());
        let encoded = encode_join_json(&serde_json::Value::Object(obj));
        assert_eq!(
            join::decode(&encoded).unwrap_err(),
            JoinError,
            "expected failure for field {field}={value}"
        );
    }

    // Non-canonical outer base64url: padding `=`
    assert_eq!(
        join::decode(&format!("{TS_JOIN_STANDARD}=")).unwrap_err(),
        JoinError
    );
    // Non-canonical outer base64url: trailing non-zero unused bit.
    // Pick a URL length whose JSON byte length is not a multiple of 3 so the final
    // base64url character has unused low bits that must be zero in canonical form.
    let mut raw_b64 = String::new();
    for extra in 1..=3 {
        let mut obj = base_join_json();
        obj.insert(
            "reach".into(),
            serde_json::json!([{ "type": "url", "url": "a".repeat(extra) }]),
        );
        let candidate =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&serde_json::Value::Object(obj)).unwrap());
        if !candidate.len().is_multiple_of(4) {
            raw_b64 = candidate;
            break;
        }
    }
    assert_ne!(raw_b64.len() % 4, 0);
    // Flip the lowest bit of the last base64url digit (guaranteed unused bit when len%4==2 or 3).
    let last = raw_b64.pop().unwrap();
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let idx = alphabet.iter().position(|&c| c == last as u8).unwrap();
    raw_b64.push(alphabet[idx ^ 1] as char);
    assert_eq!(
        join::decode(&format!("ocjoin_{raw_b64}")).unwrap_err(),
        JoinError
    );

    // Non-canonical inner key base64url (padding and non-canonical trailing bit on 32-byte key).
    let mut padded_key = base_join_json();
    padded_key.insert(
        "home".into(),
        serde_json::json!(format!("{}=", URL_SAFE_NO_PAD.encode([1u8; 32]))),
    );
    assert_eq!(
        join::decode(&encode_join_json(&serde_json::Value::Object(padded_key))).unwrap_err(),
        JoinError
    );
    let mut non_canon_key = URL_SAFE_NO_PAD.encode([1u8; 32]); // ends in 'E' (index 4, low 2 bits 00)
    assert_eq!(non_canon_key.pop(), Some('E'));
    non_canon_key.push('F'); // index 5, low 2 bits 01 -> non-canonical
    let mut bad_key_obj = base_join_json();
    bad_key_obj.insert("home".into(), serde_json::json!(non_canon_key));
    assert_eq!(
        join::decode(&encode_join_json(&serde_json::Value::Object(bad_key_obj))).unwrap_err(),
        JoinError
    );

    // Over-long join string (> 4,096 chars) vs exact 4,096-byte boundary.
    let mut long_obj = base_join_json();
    long_obj.insert(
        "reach".into(),
        serde_json::json!([{ "type": "url", "url": format!("https://home.example/{}", "a".repeat(4_000)) }]),
    );
    let long = encode_join_json(&serde_json::Value::Object(long_obj));
    assert!(long.len() > join::MAX_LENGTH);
    assert_eq!(join::decode(&long).unwrap_err(), JoinError);

    // JSON array instead of object must be refused even when canonically encoded.
    let array_payload = serde_json::json!([
        1,
        URL_SAFE_NO_PAD.encode([1u8; 32]),
        URL_SAFE_NO_PAD.encode([2u8; 32]),
        0,
        []
    ]);
    assert_eq!(
        join::decode(&encode_join_json(&array_payload)).unwrap_err(),
        JoinError
    );
    let spaced_array = format!(
        "ocjoin_{}",
        URL_SAFE_NO_PAD.encode(format!(
            "  {}",
            serde_json::to_string(&array_payload).unwrap()
        ))
    );
    assert_eq!(join::decode(&spaced_array).unwrap_err(), JoinError);

    // Deliberate strictness vs TS decoder on spellings the home never prints:
    // floats/exponents/-0, duplicate fields, and out-of-range numbers inside unknown reach.
    let home_b64 = URL_SAFE_NO_PAD.encode([1u8; 32]);
    let secret_b64 = URL_SAFE_NO_PAD.encode([2u8; 32]);
    let strict_raw_json_cases = [
        format!(
            r#"{{"v":1.0,"home":"{home_b64}","secret":"{secret_b64}","expires":0,"reach":[]}}"#
        ),
        format!(r#"{{"v":1,"home":"{home_b64}","secret":"{secret_b64}","expires":-0,"reach":[]}}"#),
        format!(
            r#"{{"v":1,"v":1,"home":"{home_b64}","secret":"{secret_b64}","expires":0,"reach":[]}}"#
        ),
        format!(
            r#"{{"v":1,"home":"{home_b64}","secret":"{secret_b64}","expires":0,"reach":[{{"type":"other","n":1e400}}]}}"#
        ),
    ];
    for raw_json in strict_raw_json_cases {
        let encoded = format!("ocjoin_{}", URL_SAFE_NO_PAD.encode(raw_json.as_bytes()));
        assert_eq!(
            join::decode(&encoded).unwrap_err(),
            JoinError,
            "expected strict refusal for {raw_json}"
        );
    }

    // Non-base64url characters (`+`, `/`, whitespace) are refused.
    let mut with_plus = TS_JOIN_STANDARD.to_owned();
    with_plus.replace_range(10..11, "+");
    assert_eq!(join::decode(&with_plus).unwrap_err(), JoinError);
    assert_eq!(
        join::decode(&format!("{TS_JOIN_STANDARD}\n")).unwrap_err(),
        JoinError
    );
}

#[test]
fn join_drops_unknown_reach_entries_and_keeps_known_ones() {
    let mut obj = base_join_json();
    obj.insert(
        "reach".into(),
        serde_json::json!([
            { "type": "carrier", "band": "x" },
            { "type": "url", "url": 42 },
            { "type": "url", "url": "https://home.example", "extra": true }
        ]),
    );
    let decoded =
        join::decode(&encode_join_json(&serde_json::Value::Object(obj))).expect("valid join");
    assert_eq!(
        decoded.reach,
        vec![Reach::Url("https://home.example".to_owned())]
    );
}

// =========================================================================
// 4. Handshake refusals & secret redaction
// =========================================================================

#[test]
fn refuses_wrong_home_key_wrong_signer_and_wrong_transcript() {
    let real_home = FakeHome::new([0x11; 32], [0x33; 32]);
    let other_home = FakeHome::new([0x99; 32], [0x33; 32]);
    let worker_id = Identity::from_seed([0x22; 32]);
    let secret = Secret::from([0x77; 32]);

    // 1. Impostor sends its own valid key & signature (doesn't match pinned home key)
    let (dial, msg1) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        Some(secret.clone()),
    ))
    .expect("start");
    let (_, impostor_msg2) = other_home.accept_msg1_and_write_msg2(&msg1, None, None);
    let err = dial.read_message_2(&impostor_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::HomeKeyMismatch);
    assert_eq!(err.to_string(), "the link was refused");

    // 2. Right pinned key claimed, signed by another key
    let (dial, msg1) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        Some(secret.clone()),
    ))
    .expect("start");
    let (_, bad_sig_msg2) =
        other_home.accept_msg1_and_write_msg2(&msg1, Some(real_home.public_key()), None);
    let err = dial.read_message_2(&bad_sig_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidHomeSignature);
    assert_eq!(err.to_string(), "the link was refused");

    // 3. Replayed signature from an earlier handshake with the same home Noise static
    let (dial_cap, msg1_cap) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        None,
    ))
    .expect("start cap");
    let sig_cell = std::cell::Cell::new([0u8; 64]);
    let (_, msg2_cap) = real_home.accept_msg1_and_write_msg2(
        &msg1_cap,
        None,
        Some(&|data| {
            let sig = real_home.identity.sign(data).to_bytes();
            sig_cell.set(sig);
            sig
        }),
    );
    assert!(dial_cap.read_message_2(&msg2_cap).is_ok());
    let recorded_sig = sig_cell.get();

    let (dial2, msg1_b) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        None,
    ))
    .expect("start b");
    let (_, replay_msg2) =
        real_home.accept_msg1_and_write_msg2(&msg1_b, None, Some(&|_| recorded_sig));
    let err = dial2.read_message_2(&replay_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidHomeSignature);

    // 4. Signature over the static key alone (omitting h1)
    let (dial3, msg1_c) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        None,
    ))
    .expect("start c");
    let (_, static_only_msg2) = real_home.accept_msg1_and_write_msg2(
        &msg1_c,
        None,
        Some(&|data| {
            // data = HOME_LABEL (22) || home_static (32) || h1 (32)
            real_home.identity.sign(&data[22..54]).to_bytes()
        }),
    );
    let err = dial3.read_message_2(&static_only_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidHomeSignature);

    // 5. Signature under wrong domain label ("opencode-link-v1/machine:")
    let (dial4, msg1_d) = Dial::start(DialOptions::new(
        real_home.public_key(),
        worker_id.clone(),
        None,
    ))
    .expect("start d");
    let (_, wrong_label_msg2) = real_home.accept_msg1_and_write_msg2(
        &msg1_d,
        None,
        Some(&|data| {
            let mut wrong = Vec::new();
            wrong.extend_from_slice(b"opencode-link-v1/machine:");
            wrong.extend_from_slice(&data[22..]);
            real_home.identity.sign(&wrong).to_bytes()
        }),
    );
    let err = dial4.read_message_2(&wrong_label_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidHomeSignature);

    // 6. Small-order (identity) pinned home key is refused by `verify_strict` even with a
    // forged signature `(R = identity, s = 0)` that satisfies `[8][s]B = [8]R + [8][k]A`.
    let mut small_order_key = [0u8; 32];
    small_order_key[0] = 1; // compressed Ed25519 identity point
    let mut forged_sig = [0u8; 64];
    forged_sig[0] = 1; // R = identity point, s = 0
    let (dial5, msg1_e) =
        Dial::start(DialOptions::new(small_order_key, worker_id, None)).expect("start e");
    let (_, small_order_msg2) =
        real_home.accept_msg1_and_write_msg2(&msg1_e, Some(small_order_key), Some(&|_| forged_sig));
    let err = dial5.read_message_2(&small_order_msg2).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidHomeSignature);
}

#[test]
fn refuses_wrong_lengths_and_flipped_bits_in_message_2_and_welcome() {
    let home = FakeHome::new([0x11; 32], [0x33; 32]);
    let worker_id = Identity::from_seed([0x22; 32]);

    // Message 2 one byte short and one byte long
    for delta in [-1isize, 1isize] {
        let (dial, msg1) =
            Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None))
                .expect("start");
        let (_, mut msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        if delta < 0 {
            msg2.pop();
        } else {
            msg2.push(0);
        }
        let err = dial.read_message_2(&msg2).unwrap_err();
        assert_eq!(err.cause, HandshakeCause::BadLength);
    }

    // Welcome shorter than TAG_LEN and longer than MAX_NOISE_MESSAGE
    for bad_len in [TAG_LEN - 1, MAX_NOISE_MESSAGE + 1] {
        let (dial, msg1) =
            Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None))
                .expect("start");
        let (_, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let (awaiting, _) = dial.read_message_2(&msg2).expect("msg2");
        let err = awaiting.read_welcome(&vec![0u8; bad_len]).unwrap_err();
        assert_eq!(err.cause, HandshakeCause::BadLength);
    }

    // Flipped bit in every byte of message 2
    for byte_idx in 0..MESSAGE_2_LEN {
        let (dial, msg1) =
            Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None))
                .expect("start");
        let (_, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let tampered = flip_bit(&msg2, byte_idx * 8 + (byte_idx % 8));
        assert!(
            dial.read_message_2(&tampered).is_err(),
            "byte {byte_idx} flip in msg2 must fail"
        );
    }

    // Flipped bit in every byte of welcome
    let (dial_sample, msg1_sample) =
        Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None)).expect("start");
    let (hs_sample, msg2_sample) = home.accept_msg1_and_write_msg2(&msg1_sample, None, None);
    let (_, msg3_sample) = dial_sample.read_message_2(&msg2_sample).expect("msg2");
    let (_, welcome_sample, _) =
        home.complete_handshake(hs_sample, &msg3_sample, "gpu", MAX_MESSAGE);
    for byte_idx in 0..welcome_sample.len() {
        let (dial, msg1) =
            Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None))
                .expect("start");
        let (hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
        let (_, welcome, _) = home.complete_handshake(hs, &msg3, "gpu", MAX_MESSAGE);
        let tampered = flip_bit(&welcome, byte_idx * 8 + (byte_idx % 8));
        assert!(
            awaiting.read_welcome(&tampered).is_err(),
            "byte {byte_idx} flip in welcome must fail"
        );
    }

    // Invalid UTF-8 in welcome is refused
    let (dial, msg1) =
        Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None)).expect("start");
    let (mut hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
    let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
    let mut payload = [0u8; 129];
    hs.read_message(&msg3, &mut payload).expect("msg3");
    let mut transport = hs.into_transport_mode().expect("transport");
    let mut bad_welcome = [0u8; 2 + TAG_LEN];
    transport
        .write_message(&[0xff, 0xfe], &mut bad_welcome)
        .expect("encrypt");
    let err = awaiting.read_welcome(&bad_welcome).unwrap_err();
    assert_eq!(err.cause, HandshakeCause::InvalidWelcomeUtf8);
}

#[test]
fn welcome_enforces_machine_name_rules() {
    let home = FakeHome::new([0x11; 32], [0x33; 32]);
    let worker_id = Identity::from_seed([0x22; 32]);

    let deliver_welcome = |raw_name: &[u8]| {
        let (dial, msg1) =
            Dial::start(DialOptions::new(home.public_key(), worker_id.clone(), None))
                .expect("start");
        let (mut hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
        let mut payload = [0u8; 129];
        hs.read_message(&msg3, &mut payload).expect("msg3");
        let mut transport = hs.into_transport_mode().expect("transport");
        let mut welcome = vec![0u8; raw_name.len() + TAG_LEN];
        let n = transport
            .write_message(raw_name, &mut welcome)
            .expect("encrypt welcome");
        welcome.truncate(n);
        awaiting.read_welcome(&welcome)
    };

    let sixty_four = format!("a{}", "b".repeat(63));
    let invalid: &[(&str, &[u8])] = &[
        ("utf-8 bom prefix", b"\xef\xbb\xbfgpu"),
        ("empty", b""),
        ("1 char", b"a"),
        ("64 chars", sixty_four.as_bytes()),
        ("uppercase", b"Gpu"),
        ("starts with digit", b"1gpu"),
        ("starts with hyphen", b"-gpu"),
        ("underscore", b"gpu_1"),
        ("reserved local", b"local"),
    ];
    for &(label, bytes) in invalid {
        let err = deliver_welcome(bytes).unwrap_err();
        assert_eq!(
            err.cause,
            HandshakeCause::InvalidMachineName,
            "expected InvalidMachineName for welcome case: {label}"
        );
        assert_eq!(
            err.to_string(),
            "the link was refused",
            "expected refusal for welcome case: {label}"
        );
    }

    // Valid 63-character machine name (and 2-char minimum) succeed.
    let sixty_three = format!("a{}", "b0-".repeat(20) + "xy");
    assert_eq!(sixty_three.len(), 63);
    for valid in ["ab", "gpu-01", sixty_three.as_str()] {
        let session = deliver_welcome(valid.as_bytes())
            .unwrap_or_else(|e| panic!("expected valid welcome {valid:?}, got {e:?}"));
        assert_eq!(session.machine(), valid);
    }
}

#[test]
fn reconnect_without_secret_sends_zero_flag_and_zeros_at_exact_length() {
    let home = FakeHome::new([0x11; 32], [0x33; 32]);
    let worker_id = Identity::from_seed([0x22; 32]);
    let (dial, msg1) =
        Dial::start(DialOptions::new(home.public_key(), worker_id, None)).expect("start");
    let (hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
    let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
    assert_eq!(msg3.len(), MESSAGE_3_LEN);
    let (_, welcome, msg3_payload) = home.complete_handshake(hs, &msg3, "box", MAX_MESSAGE);
    assert_eq!(msg3_payload[96], 0);
    assert_eq!(&msg3_payload[97..129], &[0u8; 32]);
    let session = awaiting.read_welcome(&welcome).expect("welcome");
    assert_eq!(session.machine(), "box");
}

#[test]
fn debug_formatting_never_exposes_secrets() {
    let secret_bytes = [0xdeu8; 32];
    let seed_bytes = [0xadu8; 32];
    let secret = Secret::from(secret_bytes);
    let identity = Identity::from_seed(seed_bytes);
    let decoded = join::decode(TS_JOIN_STANDARD).expect("decode");

    let secret_dbg = format!("{secret:?}");
    let join_dbg = format!("{decoded:?}");
    let id_dbg = format!("{identity:?}");
    let opts = DialOptions::new([0x11; 32], identity, Some(secret));
    let opts_dbg = format!("{opts:?}");
    let (dial, _) = Dial::start(opts).expect("start");
    let dial_dbg = format!("{dial:?}");

    assert!(!secret_dbg.contains("222"));
    assert!(secret_dbg.contains("REDACTED"));
    assert!(join_dbg.contains("REDACTED"));
    assert!(!id_dbg.contains("173"));
    assert!(!opts_dbg.contains("222"));
    assert!(!dial_dbg.contains("222"));
}

// =========================================================================
// 5. Framing: boundaries, bad frames, cap checks without 160 MiB allocation
// =========================================================================

#[test]
fn frames_round_trip_boundary_lengths_with_exact_frame_counts_and_tags() {
    // Also verify raw decrypted frame tag sequences by inspecting ciphertext lengths:
    // a `more` frame is always MAX_NOISE_MESSAGE (65,535) bytes; a `final` frame is
    // 1 + piece_len + 16 bytes.
    let cases: &[(usize, usize)] = &[
        (0, 1),
        (MAX_PIECE - 1, 1),
        (MAX_PIECE, 1),
        (MAX_PIECE + 1, 2),
        (2 * MAX_PIECE, 2),
        (2 * MAX_PIECE + 1, 3),
    ];

    let (mut worker, mut home) = paired_sessions(REKEY_INTERVAL, MAX_MESSAGE);

    for &(len, expected_frames) in cases {
        let msg: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        let frames = worker.encode(&msg).expect("encode");
        assert_eq!(
            frames.len(),
            expected_frames,
            "frame count mismatch for len={len}"
        );
        for frame in &frames[..frames.len() - 1] {
            assert_eq!(frame.len(), MAX_NOISE_MESSAGE);
        }

        let mut reassembled = None;
        for (idx, frame) in frames.iter().enumerate() {
            let res = home.push(frame).expect("push");
            if idx + 1 < frames.len() {
                assert!(res.is_none(), "expected None for non-final frame {idx}");
            } else {
                reassembled = res;
            }
        }
        assert_eq!(reassembled.as_deref(), Some(msg.as_slice()));
    }
}

#[test]
fn verifies_exact_wire_frame_tags_with_raw_transport_pair() {
    // Verify the exact plaintext tag byte (0x00 vs 0x01) for every boundary length.
    let cases: &[(usize, &[u8])] = &[
        (0, &[0]),
        (MAX_PIECE - 1, &[0]),
        (MAX_PIECE, &[0]),
        (MAX_PIECE + 1, &[1, 0]),
        (2 * MAX_PIECE, &[1, 0]),
    ];
    for &(len, expected_tags) in cases {
        let home = FakeHome::new([0x11; 32], [0x33; 32]);
        let (dial, msg1) = Dial::start(DialOptions::new(
            home.public_key(),
            Identity::from_seed([0x22; 32]),
            None,
        ))
        .expect("start");
        let (mut hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
        let mut p = [0u8; 129];
        hs.read_message(&msg3, &mut p).expect("msg3");
        let mut raw_home = hs.into_transport_mode().expect("transport");
        let mut welcome = [0u8; 3 + TAG_LEN];
        raw_home
            .write_message(b"gpu", &mut welcome)
            .expect("welcome");
        let mut worker = awaiting.read_welcome(&welcome).expect("read_welcome");

        let msg = vec![0x5au8; len];
        let frames = worker.encode(&msg).expect("encode");
        let mut tags = Vec::new();
        let mut pt = vec![0u8; MAX_NOISE_MESSAGE];
        for frame in &frames {
            let n = raw_home.read_message(frame, &mut pt).expect("decrypt");
            tags.push(pt[0]);
            if pt[0] == 1 {
                assert_eq!(n, MAX_PIECE + 1);
            }
        }
        assert_eq!(
            tags.as_slice(),
            expected_tags,
            "tags mismatch for len={len}"
        );
    }
}

#[test]
fn refuses_bad_frames_and_ends_session_permanently() {
    let make_raw_sender = || {
        let home = FakeHome::new([0x11; 32], [0x33; 32]);
        let (dial, msg1) = Dial::start(DialOptions::new(
            home.public_key(),
            Identity::from_seed([0x22; 32]),
            None,
        ))
        .expect("start");
        let (mut hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
        let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
        let mut p = [0u8; 129];
        hs.read_message(&msg3, &mut p).expect("msg3");
        let mut raw_home = hs.into_transport_mode().expect("transport");
        let mut welcome = [0u8; 3 + TAG_LEN];
        raw_home
            .write_message(b"gpu", &mut welcome)
            .expect("welcome");
        let worker = awaiting.read_welcome(&welcome).expect("read_welcome");
        (worker, raw_home)
    };

    let seal = |raw: &mut snow::TransportState, plaintext: &[u8]| -> Vec<u8> {
        let mut out = vec![0u8; plaintext.len() + TAG_LEN];
        let n = raw.write_message(plaintext, &mut out).expect("encrypt");
        out.truncate(n);
        out
    };

    // Short `more` frame (MAX_PIECE - 1 bytes instead of MAX_PIECE)
    let mut short_more = vec![0x01];
    short_more.extend(std::iter::repeat_n(0xaa, MAX_PIECE - 1));
    let bad_plaintexts: &[(&str, Vec<u8>)] = &[
        ("short more", short_more),
        ("empty more", vec![0x01]),
        ("empty frame", vec![]),
        ("unknown tag 2", vec![0x02, b'x']),
        ("unknown tag 255", vec![0xff]),
    ];

    for (name, pt) in bad_plaintexts {
        let (mut worker, mut raw_home) = make_raw_sender();
        let bad_ct = seal(&mut raw_home, pt);
        let err = worker.push(&bad_ct).unwrap_err();
        assert_eq!(err, FrameError::BadFrame, "case: {name}");
        assert!(worker.is_closed(), "session must close on {name}");
        // Session stays dead in both directions
        let valid_after = seal(&mut raw_home, &[0x00, b'o', b'k']);
        assert_eq!(worker.push(&valid_after), Err(FrameError::Closed));
        assert_eq!(worker.encode(b"after"), Err(FrameError::Closed));
    }

    // Out-of-bounds carrier lengths rejected before Noise
    for bad_len in [TAG_LEN - 1, MAX_NOISE_MESSAGE + 1] {
        let (mut worker, _) = make_raw_sender();
        assert_eq!(worker.push(&vec![0u8; bad_len]), Err(FrameError::BadFrame));
        assert!(worker.is_closed());
    }

    // Failed decrypt (flipped bit) ends the session
    let (mut worker, mut raw_home) = make_raw_sender();
    let valid = seal(&mut raw_home, &[0x00, b'h', b'i']);
    let tampered = flip_bit(&valid, 0);
    assert_eq!(worker.push(&tampered), Err(FrameError::Decrypt));
    assert!(worker.is_closed());
    assert_eq!(worker.push(&valid), Err(FrameError::Closed));
    assert_eq!(worker.encode(b"nope"), Err(FrameError::Closed));
}

#[test]
fn message_cap_arithmetic_and_enforcement_without_allocating_160_mib() {
    // 1. Exact 160 MiB constant and overflow arithmetic without allocating 160 MiB
    assert_eq!(MAX_MESSAGE, 160 * 1024 * 1024);
    assert!(fits_within_cap(0, MAX_MESSAGE, MAX_MESSAGE));
    assert!(!fits_within_cap(0, MAX_MESSAGE + 1, MAX_MESSAGE));
    assert!(fits_within_cap(
        MAX_MESSAGE - MAX_PIECE,
        MAX_PIECE,
        MAX_MESSAGE
    ));
    assert!(!fits_within_cap(MAX_MESSAGE, 1, MAX_MESSAGE));
    assert!(!fits_within_cap(usize::MAX, 1, MAX_MESSAGE));

    // 2. End-to-end send and receive enforcement at a small multi-frame cap
    let cap = 2 * MAX_PIECE + 10;

    // Exactly at cap succeeds on both sides
    let (mut worker, mut home) = paired_sessions(REKEY_INTERVAL, cap);
    let at_cap = vec![0x3cu8; cap];
    let frames = worker.encode(&at_cap).expect("at cap encodes");
    assert_eq!(frames.len(), 3);
    let mut got = None;
    for frame in &frames {
        got = home.push(frame).expect("at cap decodes");
    }
    assert_eq!(got, Some(at_cap));

    // One byte over cap refused on send (before encrypting) and ends session
    let over_cap = vec![0x3cu8; cap + 1];
    assert_eq!(worker.encode(&over_cap), Err(FrameError::TooLong));
    assert!(worker.is_closed());
    assert_eq!(worker.encode(b"ok"), Err(FrameError::Closed));

    // One byte over cap refused on receive (when sender has larger cap) and ends session
    let (mut big_sender, mut small_receiver) = paired_sessions(REKEY_INTERVAL, MAX_MESSAGE);
    small_receiver.set_max_message_for_test(cap);
    let frames = big_sender.encode(&over_cap).expect("big sender encodes");
    assert_eq!(frames.len(), 3);
    assert_eq!(small_receiver.push(&frames[0]), Ok(None));
    assert_eq!(small_receiver.push(&frames[1]), Ok(None));
    assert_eq!(small_receiver.push(&frames[2]), Err(FrameError::TooLong));
    assert!(small_receiver.is_closed());
    let follow_up = big_sender.encode(b"after").expect("sender still open");
    assert_eq!(small_receiver.push(&follow_up[0]), Err(FrameError::Closed));
}

// =========================================================================
// 6. Rekey: multi-rekey round-trip, chunked mid-message rekey, and
//    cross-language agreement with TypeScript + independent Noise REKEY check
// =========================================================================

#[test]
fn rekeys_across_many_messages_and_inside_chunked_messages_both_ways() {
    // Interval = 3: welcome is home->worker msg #1, so 20 messages cross 7 rekeys.
    let (mut worker, mut home) = paired_sessions(3, MAX_MESSAGE);

    for i in 0..20usize {
        let up = format!("up-{i}");
        let up_frames = worker.encode(up.as_bytes()).expect("worker encode");
        assert_eq!(up_frames.len(), 1);
        assert_eq!(
            home.push(&up_frames[0]).expect("home push"),
            Some(up.into_bytes())
        );

        let down = format!("down-{i}");
        let down_frames = home.encode(down.as_bytes()).expect("home encode");
        assert_eq!(down_frames.len(), 1);
        assert_eq!(
            worker.push(&down_frames[0]).expect("worker push"),
            Some(down.into_bytes())
        );
    }

    // Rekey falling inside a 4-frame chunked message in both directions.
    let (mut worker, mut home) = paired_sessions(3, MAX_MESSAGE);
    let big_up: Vec<u8> = (0..(3 * MAX_PIECE + 123))
        .map(|i| (i % 239) as u8)
        .collect();
    let big_down: Vec<u8> = (0..(3 * MAX_PIECE + 456))
        .map(|i| (i % 233) as u8)
        .collect();

    let up_frames = worker.encode(&big_up).expect("big up encode");
    assert_eq!(up_frames.len(), 4);
    let mut got_up = None;
    for f in &up_frames {
        got_up = home.push(f).expect("home push chunk");
    }
    assert_eq!(got_up, Some(big_up));

    let down_frames = home.encode(&big_down).expect("big down encode");
    assert_eq!(down_frames.len(), 4);
    let mut got_down = None;
    for f in &down_frames {
        got_down = worker.push(f).expect("worker push chunk");
    }
    assert_eq!(got_down, Some(big_down));

    // Follow-up messages after the chunked rekeys still succeed both ways.
    let f_up = worker.encode(b"after-up").expect("after-up");
    assert_eq!(home.push(&f_up[0]), Ok(Some(b"after-up".to_vec())));
    let f_down = home.encode(b"after-down").expect("after-down");
    assert_eq!(worker.push(&f_down[0]), Ok(Some(b"after-down".to_vec())));
}

#[test]
fn rekey_interval_one_rekeys_immediately_after_welcome() {
    let (mut worker, mut home) = paired_sessions(1, MAX_MESSAGE);
    for i in 0..5 {
        let down = format!("d{i}");
        let frames = home.encode(down.as_bytes()).expect("home encode");
        assert_eq!(worker.push(&frames[0]), Ok(Some(down.into_bytes())));

        let up = format!("u{i}");
        let frames = worker.encode(up.as_bytes()).expect("worker encode");
        assert_eq!(home.push(&frames[0]), Ok(Some(up.into_bytes())));
    }
}

#[test]
fn skewed_rekey_intervals_fail_at_first_message_after_rekey() {
    let home = FakeHome::new([0x11; 32], [0x33; 32]).with_rekey_interval(3);
    let options = DialOptions::new(home.public_key(), Identity::from_seed([0x22; 32]), None)
        .with_rekey_interval(4);
    let (dial, msg1) = Dial::start(options).expect("start");
    let (hs, msg2) = home.accept_msg1_and_write_msg2(&msg1, None, None);
    let (awaiting, msg3) = dial.read_message_2(&msg2).expect("msg2");
    let (mut home_session, welcome, _) = home.complete_handshake(hs, &msg3, "gpu", MAX_MESSAGE);
    let mut worker_session = awaiting.read_welcome(&welcome).expect("welcome");

    // Welcome was home->worker msg #1. Msg #2 and #3 succeed; home rekeys after #3, worker doesn't.
    let f2 = home_session.encode(b"m2").expect("m2");
    assert_eq!(worker_session.push(&f2[0]), Ok(Some(b"m2".to_vec())));
    let f3 = home_session.encode(b"m3").expect("m3");
    assert_eq!(worker_session.push(&f3[0]), Ok(Some(b"m3".to_vec())));
    // Msg #4 was encrypted under home's rekeyed key, so worker fails to decrypt.
    let f4 = home_session.encode(b"m4").expect("m4");
    assert_eq!(worker_session.push(&f4[0]), Err(FrameError::Decrypt));
    assert!(worker_session.is_closed());
}

#[test]
fn rekey_matches_typescript_vectors_and_independent_spec_derivation() {
    // Vectors generated by running `packages/core/src/machine/noise.ts` + `frames.ts`
    // (`Frames.rekeying(split, 2)`) on the exact handshake inputs of `link-v1-transcript.json`:
    //   home->worker: welcome (#1), "h2w-1" (#2 -> rekey #1), "h2w-2" (#3, nonce 2),
    //                 "h2w-3" (#4 -> rekey #2), "h2w-4" (#5, nonce 4)
    //   worker->home: "w2h-1" (#1), "w2h-2" (#2 -> rekey #1), "w2h-3" (#3, nonce 2),
    //                 "w2h-4" (#4 -> rekey #2), "w2h-5" (#5, nonce 4)
    const TS_H2W: &[(&str, &str)] = &[
        ("h2w-1", "45644e45ca51e8ff167f782a0fce28805e456accd11d"),
        ("h2w-2", "15f479e6cee962eee6b3815b87d1799d5e271286a3de"),
        ("h2w-3", "8102a73269b532e53f48a97aa005a6184ec4706730f3"),
        ("h2w-4", "4060a1315bcb22fad5eaab346372665628d302c8a7a1"),
    ];
    const TS_W2H: &[(&str, &str)] = &[
        ("w2h-1", "4183ef90f9f241c922a1588b12fa0a4cef0e468a930b"),
        ("w2h-2", "1ae2dab1b54c398540d73565636245b37fb94b203b62"),
        ("w2h-3", "7174e6e01bc6fc7ca56d056ba1f147d0a8314071f46c"),
        ("w2h-4", "c6c0b717af4913d123f08acbc9bd6785828e4291cf19"),
        ("w2h-5", "46874f6768eadb8aa1bf2b6a7f94fddd64a35a5ed8fb"),
    ];

    let raw = fs::read_to_string(fixture_path("link-v1-transcript.json"))
        .expect("read link-v1-transcript.json");
    let fixture: TranscriptFixture = serde_json::from_str(&raw).expect("parse transcript");

    let home_id = Identity::from_seed(from_hex_32(&fixture.inputs.home_seed));
    let worker_id = Identity::from_seed(from_hex_32(&fixture.inputs.worker_seed));
    let options = DialOptions::new(
        home_id.public_key(),
        worker_id,
        Some(Secret::from(from_hex_32(&fixture.inputs.secret))),
    )
    .with_fixed_keys(
        from_hex_32(&fixture.inputs.worker_static),
        from_hex_32(&fixture.inputs.worker_ephemeral),
    )
    .with_rekey_interval(2);

    let (dial, _) = Dial::start(options).expect("start");
    let (awaiting, _) = dial
        .read_message_2(&from_hex(&fixture.outputs.message_2))
        .expect("msg2");
    let mut session = awaiting
        .read_welcome(&from_hex(&fixture.outputs.welcome))
        .expect("welcome");

    for &(expected_pt, ct_hex) in TS_H2W {
        let got = session.push(&from_hex(ct_hex)).expect("push TS h2w");
        assert_eq!(got.as_deref(), Some(expected_pt.as_bytes()));
    }

    for &(pt, expected_ct_hex) in TS_W2H {
        let frames = session.encode(pt.as_bytes()).expect("encode w2h");
        assert_eq!(frames.len(), 1);
        assert_eq!(to_hex(&frames[0]), expected_ct_hex);
    }

    // Independent spec derivation of the Noise XX Split keys & REKEY(k) for the transcript
    // inputs, verifying nonce preservation (nonce = 2 and nonce = 4) without using TransportState.
    let home_static =
        from_hex_32("0303030303030303030303030303030303030303030303030303030303030303");
    let home_ephem =
        from_hex_32("0404040404040404040404040404040404040404040404040404040404040404");
    let worker_static = from_hex_32(&fixture.inputs.worker_static);
    let worker_ephem = from_hex_32(&fixture.inputs.worker_ephemeral);

    let x25519_pub = |privkey: &[u8; 32]| -> [u8; 32] {
        let mut dh = DefaultResolver.resolve_dh(&DHChoice::Curve25519).unwrap();
        dh.set(privkey);
        dh.pubkey().try_into().unwrap()
    };
    let x25519_dh = |privkey: &[u8; 32], pubkey: &[u8; 32]| -> [u8; 32] {
        let mut dh = DefaultResolver.resolve_dh(&DHChoice::Curve25519).unwrap();
        dh.set(privkey);
        let mut out = [0u8; 32];
        dh.dh(pubkey, &mut out).unwrap();
        out
    };
    let hkdf2 = |ck: &[u8; 32], ikm: &[u8]| -> ([u8; 32], [u8; 32]) {
        let mut hash = DefaultResolver.resolve_hash(&HashChoice::SHA256).unwrap();
        let (mut o1, mut o2, mut o3) = ([0u8; 32], [0u8; 32], [0u8; 32]);
        hash.hkdf(ck, ikm, 2, &mut o1, &mut o2, &mut o3);
        (o1, o2)
    };
    let aes_gcm_seal = |key: &[u8; 32], nonce: u64, pt: &[u8]| -> Vec<u8> {
        let mut cipher = DefaultResolver
            .resolve_cipher(&CipherChoice::AESGCM)
            .unwrap();
        cipher.set(key);
        let mut out = vec![0u8; pt.len() + TAG_LEN];
        let n = cipher.encrypt(nonce, &[], pt, &mut out);
        out.truncate(n);
        out
    };
    let spec_rekey = |key: &[u8; 32]| -> [u8; 32] {
        aes_gcm_seal(key, u64::MAX, &[0u8; 32])[..32]
            .try_into()
            .unwrap()
    };

    let mut ck = [0u8; 32];
    ck[..NOISE_PARAMS.len()].copy_from_slice(NOISE_PARAMS.as_bytes());
    let ee = x25519_dh(&worker_ephem, &x25519_pub(&home_ephem));
    let es = x25519_dh(&worker_ephem, &x25519_pub(&home_static));
    let se = x25519_dh(&worker_static, &x25519_pub(&home_ephem));
    ck = hkdf2(&ck, &ee).0;
    ck = hkdf2(&ck, &es).0;
    ck = hkdf2(&ck, &se).0;
    let (init_key, resp_key) = hkdf2(&ck, &[]);

    // Worker->home msg #3 ("w2h-3") uses rekey(init_key) at nonce 2; msg #5 uses rekey^2 at nonce 4.
    let init_k1 = spec_rekey(&init_key);
    let init_k2 = spec_rekey(&init_k1);
    assert_eq!(
        to_hex(&aes_gcm_seal(&init_k1, 2, b"\x00w2h-3")),
        TS_W2H[2].1
    );
    assert_eq!(
        to_hex(&aes_gcm_seal(&init_k2, 4, b"\x00w2h-5")),
        TS_W2H[4].1
    );

    // Home->worker msg #3 ("h2w-2", after welcome #1 and h2w-1 #2) uses rekey(resp_key) at nonce 2.
    let resp_k1 = spec_rekey(&resp_key);
    let resp_k2 = spec_rekey(&resp_k1);
    assert_eq!(
        to_hex(&aes_gcm_seal(&resp_k1, 2, b"\x00h2w-2")),
        TS_H2W[1].1
    );
    assert_eq!(
        to_hex(&aes_gcm_seal(&resp_k2, 4, b"\x00h2w-4")),
        TS_H2W[3].1
    );
}
