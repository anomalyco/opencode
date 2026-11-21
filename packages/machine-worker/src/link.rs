//! Connecting (worker) side of the `opencode-link-v1` Noise XX handshake.

use std::fmt;

use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use zeroize::{Zeroize, Zeroizing};

use crate::Secret;
use crate::frames::{MAX_NOISE_MESSAGE, REKEY_INTERVAL, Session, TAG_LEN, TransportGuard};

pub(crate) const NOISE_PARAMS: &str = "Noise_XX_25519_AESGCM_SHA256";
const PROLOGUE: &[u8] = b"opencode-link-v1";
const HOME_LABEL: &[u8] = b"opencode-link-v1/home:";
const MACHINE_LABEL: &[u8] = b"opencode-link-v1/machine:";

const KEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;

/// Exact byte length of handshake message 1 (`e`).
pub const MESSAGE_1_LEN: usize = KEY_LEN;
/// Exact byte length of handshake message 2 (`e, s, { home_key || sig }`).
pub const MESSAGE_2_LEN: usize = KEY_LEN + KEY_LEN + TAG_LEN + (KEY_LEN + SIGNATURE_LEN) + TAG_LEN;
/// Exact byte length of handshake message 3 (`s, { worker_key || sig || has_secret || secret }`).
pub const MESSAGE_3_LEN: usize =
    KEY_LEN + TAG_LEN + (KEY_LEN + SIGNATURE_LEN + 1 + KEY_LEN) + TAG_LEN;

const MSG2_PAYLOAD_LEN: usize = KEY_LEN + SIGNATURE_LEN;
const MSG3_PAYLOAD_LEN: usize = KEY_LEN + SIGNATURE_LEN + 1 + KEY_LEN;

/// Internal reason a handshake was refused. Contains no key, secret, or signature bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HandshakeCause {
    NoiseInit,
    NoiseWrite,
    NoiseRead,
    BadLength,
    HomeKeyMismatch,
    InvalidHomeKey,
    InvalidHomeSignature,
    InvalidWelcomeUtf8,
    InvalidMachineName,
}

/// One error for every refused handshake.
///
/// `Display` is the only text that may ever be shown to or sent toward the peer: it is
/// always `"the link was refused"` so callers cannot leak which check failed. `Debug`
/// includes a secret-free internal cause variant strictly for the worker's own local logs.
#[derive(Clone, Copy)]
pub struct HandshakeError {
    pub(crate) cause: HandshakeCause,
}

impl HandshakeError {
    pub(crate) fn new(cause: HandshakeCause) -> Self {
        Self { cause }
    }
}

impl fmt::Debug for HandshakeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("HandshakeError").field(&self.cause).finish()
    }
}

impl fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the link was refused")
    }
}

impl std::error::Error for HandshakeError {}

/// The worker's long-term Ed25519 signing identity. Zeroized on drop and never exposes
/// secret bytes in `Debug` output.
#[derive(Clone)]
pub struct Identity {
    signing_key: SigningKey,
}

impl Identity {
    /// Derive a signing identity from a raw 32-byte Ed25519 seed.
    #[must_use]
    pub fn from_seed(mut seed: [u8; KEY_LEN]) -> Self {
        let signing_key = SigningKey::from_bytes(&seed);
        seed.zeroize();
        Self { signing_key }
    }

    /// Return the 32-byte Ed25519 public key.
    #[must_use]
    pub fn public_key(&self) -> [u8; KEY_LEN] {
        self.signing_key.verifying_key().to_bytes()
    }
}

impl fmt::Debug for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Identity")
            .field("public_key", &self.public_key())
            .finish_non_exhaustive()
    }
}

/// Inputs for dialing a home server.
pub struct DialOptions {
    home: [u8; KEY_LEN],
    identity: Identity,
    secret: Option<Secret>,
    #[cfg(test)]
    fixed_static: Option<[u8; KEY_LEN]>,
    #[cfg(test)]
    fixed_ephemeral: Option<[u8; KEY_LEN]>,
    #[cfg(test)]
    rekey_interval: Option<u64>,
}

impl DialOptions {
    /// Construct dial options with the pinned home key, worker identity, and optional
    /// one-time enrolment secret (`None` on reconnect).
    #[must_use]
    pub fn new(home: [u8; KEY_LEN], identity: Identity, secret: Option<Secret>) -> Self {
        Self {
            home,
            identity,
            secret,
            #[cfg(test)]
            fixed_static: None,
            #[cfg(test)]
            fixed_ephemeral: None,
            #[cfg(test)]
            rekey_interval: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_fixed_keys(
        mut self,
        static_private: [u8; KEY_LEN],
        ephemeral_private: [u8; KEY_LEN],
    ) -> Self {
        self.fixed_static = Some(static_private);
        self.fixed_ephemeral = Some(ephemeral_private);
        self
    }

    #[cfg(test)]
    pub(crate) fn with_rekey_interval(mut self, interval: u64) -> Self {
        assert!(interval > 0, "rekey interval must be non-zero");
        self.rekey_interval = Some(interval);
        self
    }
}

impl fmt::Debug for DialOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DialOptions")
            .field("home", &self.home)
            .field("identity", &self.identity)
            .field("has_secret", &self.secret.is_some())
            .finish_non_exhaustive()
    }
}

/// Handshake state after sending message 1, awaiting message 2 from the home.
/// Consumed on `read_message_2` so a failed handshake can never be reused.
pub struct Dial {
    handshake: snow::HandshakeState,
    h1: [u8; KEY_LEN],
    local_static_public: [u8; KEY_LEN],
    home: [u8; KEY_LEN],
    identity: Identity,
    secret: Option<Secret>,
    rekey_interval: u64,
}

impl fmt::Debug for Dial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Dial").finish_non_exhaustive()
    }
}

impl Dial {
    /// Begin a handshake, generating a fresh X25519 Noise static key and returning
    /// the next state together with handshake message 1 (32 bytes).
    pub fn start(options: DialOptions) -> Result<(Self, Vec<u8>), HandshakeError> {
        let params: snow::params::NoiseParams = NOISE_PARAMS
            .parse()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;

        let (local_static_private, local_static_public) = build_static_keypair(&params, &options)?;

        // Uses `snow`'s `DefaultResolver`, which accepts low-order X25519 keys (all-zero DH
        // output) where `noise.ts` refuses them. Because message 2 must still carry a valid
        // signature by the pinned home key before message 3 is ever written, only the home
        // itself could produce that, so we deliberately do not add a custom resolver.
        let builder = snow::Builder::new(params)
            .prologue(PROLOGUE)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?
            .local_private_key(&*local_static_private)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;

        #[cfg(test)]
        let builder = match &options.fixed_ephemeral {
            Some(ephemeral) => builder.fixed_ephemeral_key_for_testing_only(ephemeral),
            None => builder,
        };

        let mut handshake = builder
            .build_initiator()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;

        // `snow` checks `written + payload.len() + TAG_LEN <= out.len()` even before a
        // cipher key is established, so message 1 needs `TAG_LEN` spare bytes in the buffer.
        let mut msg1 = [0u8; MESSAGE_1_LEN + TAG_LEN];
        let len = handshake
            .write_message(&[], &mut msg1)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseWrite))?;
        if len != MESSAGE_1_LEN {
            return Err(HandshakeError::new(HandshakeCause::BadLength));
        }

        let h1: [u8; KEY_LEN] = handshake
            .get_handshake_hash()
            .try_into()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseWrite))?;

        #[cfg(test)]
        let rekey_interval = options.rekey_interval.unwrap_or(REKEY_INTERVAL);
        #[cfg(not(test))]
        let rekey_interval = REKEY_INTERVAL;

        Ok((
            Self {
                handshake,
                h1,
                local_static_public,
                home: options.home,
                identity: options.identity,
                secret: options.secret,
                rekey_interval,
            },
            msg1[..len].to_vec(),
        ))
    }

    /// Process handshake message 2 from the home, verify the pinned home identity and
    /// transcript signature, and only then produce message 3 (193 bytes).
    pub fn read_message_2(
        mut self,
        message: &[u8],
    ) -> Result<(AwaitingWelcome, Vec<u8>), HandshakeError> {
        if message.len() != MESSAGE_2_LEN {
            return Err(HandshakeError::new(HandshakeCause::BadLength));
        }

        let mut payload = [0u8; MSG2_PAYLOAD_LEN];
        let len = self
            .handshake
            .read_message(message, &mut payload)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseRead))?;
        if len != MSG2_PAYLOAD_LEN {
            return Err(HandshakeError::new(HandshakeCause::BadLength));
        }

        let remote_static: [u8; KEY_LEN] = self
            .handshake
            .get_remote_static()
            .and_then(|key| key.try_into().ok())
            .ok_or_else(|| HandshakeError::new(HandshakeCause::NoiseRead))?;

        let h2: [u8; KEY_LEN] = self
            .handshake
            .get_handshake_hash()
            .try_into()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseRead))?;

        if payload[..KEY_LEN] != self.home {
            return Err(HandshakeError::new(HandshakeCause::HomeKeyMismatch));
        }

        let verifying_key = VerifyingKey::from_bytes(&self.home)
            .map_err(|_| HandshakeError::new(HandshakeCause::InvalidHomeKey))?;
        let signature = Signature::from_slice(&payload[KEY_LEN..])
            .map_err(|_| HandshakeError::new(HandshakeCause::InvalidHomeSignature))?;

        let mut home_signed = [0u8; HOME_LABEL.len() + KEY_LEN + KEY_LEN];
        home_signed[..HOME_LABEL.len()].copy_from_slice(HOME_LABEL);
        home_signed[HOME_LABEL.len()..HOME_LABEL.len() + KEY_LEN].copy_from_slice(&remote_static);
        home_signed[HOME_LABEL.len() + KEY_LEN..].copy_from_slice(&self.h1);

        // Deliberately stricter than the TypeScript verifier (which accepts small-order and
        // non-canonical keys/signatures): the home's key is an honest key, so strict
        // verification never refuses a real home while ruling out degenerate signatures.
        verifying_key
            .verify_strict(&home_signed, &signature)
            .map_err(|_| HandshakeError::new(HandshakeCause::InvalidHomeSignature))?;

        let mut machine_signed = [0u8; MACHINE_LABEL.len() + KEY_LEN + KEY_LEN];
        machine_signed[..MACHINE_LABEL.len()].copy_from_slice(MACHINE_LABEL);
        machine_signed[MACHINE_LABEL.len()..MACHINE_LABEL.len() + KEY_LEN]
            .copy_from_slice(&self.local_static_public);
        machine_signed[MACHINE_LABEL.len() + KEY_LEN..].copy_from_slice(&h2);

        let worker_sig = self.identity.signing_key.sign(&machine_signed);

        let mut msg3_payload = Zeroizing::new([0u8; MSG3_PAYLOAD_LEN]);
        msg3_payload[..KEY_LEN].copy_from_slice(&self.identity.public_key());
        msg3_payload[KEY_LEN..KEY_LEN + SIGNATURE_LEN].copy_from_slice(&worker_sig.to_bytes());
        if let Some(secret) = &self.secret {
            msg3_payload[KEY_LEN + SIGNATURE_LEN] = 1;
            msg3_payload[KEY_LEN + SIGNATURE_LEN + 1..].copy_from_slice(secret.as_bytes());
        }

        let mut msg3 = [0u8; MESSAGE_3_LEN];
        let msg3_len = self
            .handshake
            .write_message(&*msg3_payload, &mut msg3)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseWrite))?;
        if msg3_len != MESSAGE_3_LEN {
            return Err(HandshakeError::new(HandshakeCause::BadLength));
        }

        let transport = self
            .handshake
            .into_transport_mode()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseWrite))?;

        Ok((
            AwaitingWelcome {
                transport: TransportGuard::new(transport),
                rekey_interval: self.rekey_interval,
            },
            msg3.to_vec(),
        ))
    }
}

/// Handshake state after sending message 3, awaiting the home's encrypted welcome.
/// Consumed on `read_welcome` so a failed welcome can never be retried.
pub struct AwaitingWelcome {
    transport: TransportGuard,
    rekey_interval: u64,
}

impl fmt::Debug for AwaitingWelcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AwaitingWelcome").finish_non_exhaustive()
    }
}

impl AwaitingWelcome {
    /// Decrypt the home's welcome transport message (the machine name in UTF-8) and
    /// enter framed transport mode.
    pub fn read_welcome(mut self, welcome: &[u8]) -> Result<Session, HandshakeError> {
        if welcome.len() < TAG_LEN || welcome.len() > MAX_NOISE_MESSAGE {
            return Err(HandshakeError::new(HandshakeCause::BadLength));
        }

        let mut plaintext = vec![0u8; welcome.len() - TAG_LEN];
        let len = self
            .transport
            .inner_mut()
            .read_message(welcome, &mut plaintext)
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseRead))?;
        plaintext.truncate(len);

        // Welcome is transport message #1 from the home and counts toward its rekey interval.
        let received = 1u64;
        if received.is_multiple_of(self.rekey_interval) {
            self.transport.inner_mut().rekey_incoming();
        }

        let machine = String::from_utf8(plaintext)
            .map_err(|_| HandshakeError::new(HandshakeCause::InvalidWelcomeUtf8))?;
        if !is_valid_machine_name(&machine) {
            return Err(HandshakeError::new(HandshakeCause::InvalidMachineName));
        }

        Ok(Session::new(
            machine,
            self.transport,
            received,
            self.rekey_interval,
        ))
    }
}

/// Matches `Machines.Name` in `packages/core/src/machine/machines.ts`:
/// `^[a-z][a-z0-9-]{1,62}$` and never `"local"`.
fn is_valid_machine_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.len() < 2 || bytes.len() > 63 || name == "local" {
        return false;
    }
    bytes[0].is_ascii_lowercase()
        && bytes[1..]
            .iter()
            .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn build_static_keypair(
    params: &snow::params::NoiseParams,
    options: &DialOptions,
) -> Result<(Zeroizing<[u8; KEY_LEN]>, [u8; KEY_LEN]), HandshakeError> {
    #[cfg(test)]
    if let Some(fixed_private) = options.fixed_static {
        use snow::params::DHChoice;
        use snow::resolvers::{CryptoResolver, DefaultResolver};

        let mut dh = DefaultResolver
            .resolve_dh(&DHChoice::Curve25519)
            .ok_or_else(|| HandshakeError::new(HandshakeCause::NoiseInit))?;
        dh.set(&fixed_private);
        let public: [u8; KEY_LEN] = dh
            .pubkey()
            .try_into()
            .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;
        return Ok((Zeroizing::new(fixed_private), public));
    }

    #[cfg(not(test))]
    let _ = options;

    let mut keypair = snow::Builder::new(params.clone())
        .generate_keypair()
        .map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;
    let private_res: Result<[u8; KEY_LEN], _> = keypair.private.as_slice().try_into();
    let public_res: Result<[u8; KEY_LEN], _> = keypair.public.as_slice().try_into();
    keypair.private.zeroize();

    let private =
        Zeroizing::new(private_res.map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?);
    let public = public_res.map_err(|_| HandshakeError::new(HandshakeCause::NoiseInit))?;
    Ok((private, public))
}
