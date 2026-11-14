//! The run record (synthesis 4.5): one private mapped file per client, which the parent creates and keeps. Around
//! every plugin call the host stores which plugin and which call runs. It also holds what a restart needs: the session
//! on screen and the composer's draft, written as one snapshot whenever either changes. After a crash or a hang the
//! parent reads what it says, and hands it to the next client in that client's own record.
//!
//! Every field has one access type and fields never overlap, so the UI thread, the watchdog and the parent may use the
//! record at once:
//!
//! - **Words** (`AtomicU64`): the call state with its generation, the running call, its start, the call the
//!   watchdog claimed, the call whose notice it painted, the committed snapshot, whether the terminal was taken.
//! - **Names** (bytes, published by a checksum word): each plugin slot's identity, written once before the slot's
//!   first call and never again. An identity is the plugin's ID and, for an external plugin, its target and build, so
//!   a crash names the artifact and not only an ID another plugin may share.
//! - **Snapshots** (bytes, two slots): the session and the draft. A writer fills the slot that is not committed, then
//!   commits it with one word, so a crash in the middle leaves the previous whole snapshot.
//! - **Handoff** (bytes): what the parent tells the next client: the crash it restarts after, and safe mode.
//!
//! A call's life: `enter` stores the call and its start, then the state `running(g)`; `leave` swaps `running(g)` for
//! `idle(g)`. The watchdog ends a client only after it swapped `running(g)` for `hung(g)`: a call that returned first
//! keeps it from killing the client, and once it won, the call it claimed is the one the record names.
//!
//! A plugin can still write the page (a wild write): checksums make garbage name nobody. A valid wrong name cannot be
//! told from a right one, and a crash names the last call, not the cause.

// The record views its mapping as atomics: each view below says why it is sound.
#![allow(unsafe_code)]

use std::fs::File;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU8, AtomicU32, AtomicU64, Ordering, fence};

use opencode_util::page::Page;

/// The plugins a record can name; a later one runs unnamed.
pub const NAMES: usize = 128;
const NAME: usize = 512;
const HEADER: usize = 4096;
const SLOT: usize = 256 * 1024;
pub const SIZE: usize = HEADER + NAMES * NAME + 2 * SLOT;
/// The longest session ID a snapshot keeps.
const SESSION_MAX: usize = 255;
/// The longest draft a snapshot keeps, in bytes.
pub const DRAFT_MAX: usize = SLOT - 16 - SESSION_MAX - 1;

const MAGIC: u64 = u64::from_le_bytes(*b"OCRUN\x00\x00\x02");
const W_MAGIC: usize = 0;
const W_STATE: usize = 1;
const W_CALL: usize = 2;
const W_STARTED: usize = 3;
const W_HANG: usize = 4;
const W_NOTICED: usize = 5;
const W_COMMIT: usize = 6;
const W_TERMINAL: usize = 7;
const HANDOFF: usize = 128;
const HANDOFF_LEN: usize = HEADER - HANDOFF;

const IDLE: u64 = 0;
const RUNNING: u64 = 1;
const HUNG: u64 = 2;

/// The call kinds a record can name, by index.
pub const KINDS: &[&str] = &[
    "setup",
    "run-command",
    "on-event",
    "on-reply",
    "on-wake",
    "on-mount",
    "on-route-mount",
    "render-slot",
    "render-route",
    "render-fence",
    "fence-gone",
    "dispose",
    "load",
];

/// The index of `kind` in [`KINDS`], or the last index past it for a kind it does not list.
pub fn kind(kind: &str) -> u8 {
    KINDS.iter().position(|known| *known == kind).unwrap_or(KINDS.len()) as u8
}

/// What a plugin is: its ID, and for an external plugin its target and build. An external plugin's ID while it loads
/// is not known yet: it is then empty.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Artifact {
    pub id: String,
    pub target: Option<String>,
    pub digest: Option<String>,
}

impl Artifact {
    pub fn builtin(id: &str) -> Artifact {
        Artifact { id: id.to_owned(), target: None, digest: None }
    }

    pub fn external(id: &str, target: &str, digest: &str) -> Artifact {
        Artifact { id: id.to_owned(), target: Some(target.to_owned()), digest: Some(digest.to_owned()) }
    }

    /// The bytes of the identity, or `None` when it does not fit in `room`.
    fn encode(&self, room: usize) -> Option<Vec<u8>> {
        let id = self.id.as_bytes();
        let target = self.target.as_deref().map(str::as_bytes);
        let digest = self.digest.as_deref().map(str::as_bytes);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&u16::try_from(id.len()).ok()?.to_le_bytes());
        bytes.extend_from_slice(
            &target
                .map_or(Some(u16::MAX), |target| u16::try_from(target.len()).ok().filter(|len| *len < u16::MAX))?
                .to_le_bytes(),
        );
        bytes.push(u8::try_from(digest.map_or(0, <[u8]>::len)).ok().filter(|len| *len < u8::MAX)?);
        bytes.push(u8::from(digest.is_some()));
        bytes.extend_from_slice(id);
        bytes.extend_from_slice(target.unwrap_or_default());
        bytes.extend_from_slice(digest.unwrap_or_default());
        (bytes.len() <= room).then_some(bytes)
    }

    fn decode(bytes: &[u8]) -> Option<(Artifact, usize)> {
        let id_len = usize::from(u16::from_le_bytes([*bytes.first()?, *bytes.get(1)?]));
        let target_len = u16::from_le_bytes([*bytes.get(2)?, *bytes.get(3)?]);
        let digest_len = usize::from(*bytes.get(4)?);
        let has_digest = *bytes.get(5)? == 1;
        let target_len_usize = if target_len == u16::MAX { 0 } else { usize::from(target_len) };
        let end = 6 + id_len + target_len_usize + digest_len;
        let text = |range: std::ops::Range<usize>| String::from_utf8(bytes.get(range)?.to_vec()).ok();
        let id = text(6..6 + id_len)?;
        let target = (target_len != u16::MAX).then(|| text(6 + id_len..6 + id_len + target_len_usize)).flatten();
        if target_len != u16::MAX && target.is_none() {
            return None;
        }
        let digest = has_digest.then(|| text(6 + id_len + target_len_usize..end)).flatten();
        if has_digest && digest.is_none() {
            return None;
        }
        Some((Artifact { id, target, digest }, end))
    }
}

/// What the parent tells the next client.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Handoff {
    /// The crash this client restarts after.
    pub crash: Option<Crash>,
    /// Every external plugin starts off: the second crash that named no plugin.
    pub safe: bool,
}

/// A crash, as a dead client's record told it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Crash {
    /// The plugin and call that ran, if the record names them.
    pub artifact: Option<Artifact>,
    pub call: Option<String>,
    /// The watchdog gave up on that call.
    pub hang: bool,
}

/// What a restart restores: the session on screen and the composer's text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub session: Option<String>,
    pub draft: String,
    /// The draft was too long to keep; `draft` is empty.
    pub dropped: bool,
}

/// A call that runs, as the watchdog reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Running {
    pub generation: u64,
    pub slot: u16,
    pub kind: u8,
    /// Milliseconds since the record was made.
    pub started: u64,
}

/// A live record.
pub struct Record {
    page: Page,
}

impl Record {
    /// Creates a private record in `dir` (see [`opencode_util::page::private_file`]).
    pub fn create(dir: &Path) -> io::Result<Record> {
        let record = Record { page: Page::map(opencode_util::page::private_file(dir, SIZE)?, SIZE)? };
        record.word(W_MAGIC).store(MAGIC, Ordering::Release);
        Ok(record)
    }

    /// The record in `file`, which a parent created and handed over.
    pub fn open(file: File) -> io::Result<Record> {
        let record = Record { page: Page::map(file, SIZE)? };
        if record.word(W_MAGIC).load(Ordering::Acquire) != MAGIC {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not a plugin run record"));
        }
        Ok(record)
    }

    pub fn file(&self) -> &File {
        self.page.file()
    }

    fn word(&self, index: usize) -> &AtomicU64 {
        debug_assert!((index + 1) * 8 <= HANDOFF);
        // SAFETY: inside the header, 8-byte aligned (the mapping is page-aligned), and only ever used as this atomic.
        unsafe { AtomicU64::from_ptr(self.page.as_ptr().add(index * 8).cast()) }
    }

    fn word32(&self, at: usize) -> &AtomicU32 {
        assert!(at.is_multiple_of(4) && at.checked_add(4).is_some_and(|end| end <= SIZE));
        // SAFETY: inside the mapping, aligned, and only ever used as this atomic (a checksum at an entry's start).
        unsafe { AtomicU32::from_ptr(self.page.as_ptr().add(at).cast()) }
    }

    fn bytes(&self, at: usize, len: usize) -> &[AtomicU8] {
        assert!(at.checked_add(len).is_some_and(|end| end <= SIZE));
        // SAFETY: inside the mapping; these bytes are only ever used as `AtomicU8`.
        unsafe { std::slice::from_raw_parts(self.page.as_ptr().add(at).cast::<AtomicU8>(), len) }
    }

    fn write(&self, at: usize, data: &[u8]) {
        self.bytes(at, data.len()).iter().zip(data).for_each(|(cell, byte)| cell.store(*byte, Ordering::Relaxed));
    }

    fn read(&self, at: usize, len: usize) -> Vec<u8> {
        self.bytes(at, len).iter().map(|cell| cell.load(Ordering::Relaxed)).collect()
    }

    /// Names plugin slot `slot`, once, before its first call. A slot past [`NAMES`], or an identity too long for an
    /// entry, stays unnamed.
    pub fn name(&self, slot: u16, artifact: &Artifact) {
        let slot = usize::from(slot);
        if slot >= NAMES {
            return;
        }
        let at = HEADER + slot * NAME;
        let Some(encoded) = artifact.encode(NAME - 4) else { return };
        self.write(at + 4, &encoded);
        self.word32(at).store(checksum(&encoded), Ordering::Release);
    }

    /// The identity of slot `slot`, if it holds a valid one.
    pub fn named(&self, slot: u16) -> Option<Artifact> {
        let slot = usize::from(slot);
        if slot >= NAMES {
            return None;
        }
        let at = HEADER + slot * NAME;
        let check = self.word32(at).load(Ordering::Acquire);
        if check == 0 {
            return None;
        }
        let bytes = self.read(at + 4, NAME - 4);
        let (artifact, len) = Artifact::decode(&bytes)?;
        (checksum(&bytes[..len]) == check).then_some(artifact)
    }

    /// A call of plugin `slot` of kind `kind` (an index of [`KINDS`]) starts `started` ms after the record was made.
    /// Returns its generation. Only the UI thread enters and leaves.
    pub fn enter(&self, slot: u16, kind: u8, started: u64) -> u64 {
        let generation = (self.word(W_STATE).load(Ordering::Relaxed) >> 2) + 1;
        self.word(W_CALL).store(word(slot, kind), Ordering::Relaxed);
        self.word(W_STARTED).store(started + 1, Ordering::Relaxed);
        self.word(W_STATE).store((generation << 2) | RUNNING, Ordering::Release);
        generation
    }

    /// Call `generation` returned. False when the watchdog claimed it first: the process is about to end.
    pub fn leave(&self, generation: u64) -> bool {
        let state = self.word(W_STATE);
        state
            .compare_exchange((generation << 2) | RUNNING, generation << 2 | IDLE, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// The running call: a coherent read of its state, identity and start.
    pub fn running(&self) -> Option<Running> {
        let before = self.word(W_STATE).load(Ordering::Acquire);
        if before & 3 != RUNNING {
            return None;
        }
        let call = self.word(W_CALL).load(Ordering::Relaxed);
        let started = self.word(W_STARTED).load(Ordering::Relaxed);
        fence(Ordering::Acquire);
        if self.word(W_STATE).load(Ordering::Relaxed) != before {
            return None;
        }
        let (slot, kind) = self::call(call)?;
        Some(Running { generation: before >> 2, slot, kind, started: started.checked_sub(1)? })
    }

    /// Claims call `generation` as hung, if it still runs; its identity is then what the record names.
    pub fn claim(&self, generation: u64) -> bool {
        let claimed = self
            .word(W_STATE)
            .compare_exchange(
                (generation << 2) | RUNNING,
                (generation << 2) | HUNG,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok();
        if claimed {
            // The call word cannot change any more: the UI thread's `leave` now fails, and it enters nothing after.
            self.word(W_HANG).store(self.word(W_CALL).load(Ordering::Acquire), Ordering::Release);
        }
        claimed
    }

    /// The watchdog painted the notice of call `generation`.
    pub fn noticed(&self, generation: u64) {
        self.word(W_NOTICED).store(generation, Ordering::Release);
    }

    /// Whether the notice of call `generation` was painted.
    pub fn was_noticed(&self, generation: u64) -> bool {
        self.word(W_NOTICED).load(Ordering::Acquire) == generation
    }

    /// The client took the terminal over: a parent that restores it after a crash resets its modes.
    pub fn set_terminal(&self) {
        self.word(W_TERMINAL).store(1, Ordering::Release);
    }

    pub fn terminal(&self) -> bool {
        self.word(W_TERMINAL).load(Ordering::Acquire) == 1
    }

    /// Publishes `snapshot`: the slot not committed is written whole, then committed.
    pub fn publish(&self, snapshot: &Snapshot) {
        let committed = self.word(W_COMMIT).load(Ordering::Acquire);
        let index = if committed == 1 { 1 } else { 0 };
        let at = HEADER + NAMES * NAME + index * SLOT;
        let session = snapshot.session.as_deref().unwrap_or_default().as_bytes();
        let session = &session[..session.len().min(SESSION_MAX)];
        let kept = !snapshot.dropped && snapshot.draft.len() <= DRAFT_MAX;
        let draft = if kept { snapshot.draft.as_bytes() } else { &[] };
        let mut body = Vec::with_capacity(12 + session.len() + draft.len());
        body.extend_from_slice(&(session.len() as u32).to_le_bytes());
        body.extend_from_slice(&(if kept { draft.len() as u32 } else { u32::MAX }).to_le_bytes());
        body.extend_from_slice(&u32::from(snapshot.session.is_some()).to_le_bytes());
        body.extend_from_slice(session);
        body.extend_from_slice(draft);
        self.word32(at).store(0, Ordering::Relaxed);
        self.write(at + 4, &body);
        self.word32(at).store(checksum(&body), Ordering::Release);
        self.word(W_COMMIT).store(index as u64 + 1, Ordering::Release);
    }

    /// The committed snapshot, if it is whole.
    pub fn snapshot(&self) -> Option<Snapshot> {
        let index = match self.word(W_COMMIT).load(Ordering::Acquire) {
            1 => 0,
            2 => 1,
            _ => return None,
        };
        let at = HEADER + NAMES * NAME + index * SLOT;
        let check = self.word32(at).load(Ordering::Acquire);
        let head = self.read(at + 4, 12);
        let session_len = u32::from_le_bytes(head[0..4].try_into().ok()?) as usize;
        let draft_len = u32::from_le_bytes(head[4..8].try_into().ok()?);
        let has_session = u32::from_le_bytes(head[8..12].try_into().ok()?) == 1;
        let dropped = draft_len == u32::MAX;
        let draft_len = if dropped { 0 } else { draft_len as usize };
        if session_len > SESSION_MAX || draft_len > DRAFT_MAX {
            return None;
        }
        let body = self.read(at + 4, 12 + session_len + draft_len);
        if checksum(&body) != check {
            return None;
        }
        let text = |range: std::ops::Range<usize>| String::from_utf8(body[range].to_vec()).ok();
        Some(Snapshot {
            session: if has_session { Some(text(12..12 + session_len)?) } else { None },
            draft: text(12 + session_len..12 + session_len + draft_len)?,
            dropped,
        })
    }

    /// Writes the parent's handoff; the client reads it at start, before any plugin runs.
    pub fn set_handoff(&self, handoff: &Handoff) {
        let mut body = vec![u8::from(handoff.safe), 0, 0, 0];
        if let Some(crash) = &handoff.crash {
            body[1] = 1;
            body[2] = u8::from(crash.hang);
            body[3] = crash.call.as_deref().map_or(u8::MAX, kind);
            // The marker is always written: a shorter handoff over a longer one must not inherit its identity.
            match crash.artifact.as_ref().and_then(|artifact| artifact.encode(HANDOFF_LEN - 16)) {
                Some(encoded) => {
                    body.push(1);
                    body.extend_from_slice(&encoded);
                }
                None => body.push(0),
            }
        }
        let at = HANDOFF;
        self.write(at + 4, &body);
        self.word32(at).store(checksum(&body), Ordering::Release);
    }

    pub fn handoff(&self) -> Handoff {
        let at = HANDOFF;
        let check = self.word32(at).load(Ordering::Acquire);
        let bytes = self.read(at + 4, HANDOFF_LEN - 8);
        let crash = (bytes[1] == 1).then(|| {
            let artifact = (bytes.get(4) == Some(&1)).then(|| Artifact::decode(&bytes[5..])).flatten();
            let len = 5 + artifact.as_ref().map_or(0, |(_, len)| *len);
            (
                Crash {
                    artifact: artifact.map(|(artifact, _)| artifact),
                    call: KINDS.get(usize::from(bytes[3])).map(|kind| (*kind).to_owned()),
                    hang: bytes[2] == 1,
                },
                len,
            )
        });
        let len = crash.as_ref().map_or(4, |(_, len)| *len);
        if check == 0 || checksum(&bytes[..len]) != check {
            return Handoff::default();
        }
        Handoff { crash: crash.map(|(crash, _)| crash), safe: bytes[0] == 1 }
    }

    /// What this record, of a client that ended, says: the call it died in, or the call the watchdog claimed.
    pub fn crash(&self) -> Crash {
        let claimed = self::call(self.word(W_HANG).load(Ordering::Acquire));
        let hang = claimed.is_some();
        let running = claimed.or_else(|| {
            (self.word(W_STATE).load(Ordering::Acquire) & 3 == RUNNING)
                .then(|| self::call(self.word(W_CALL).load(Ordering::Acquire)))
                .flatten()
        });
        let Some((slot, kind)) = running else { return Crash::default() };
        match self.named(slot) {
            Some(artifact) => Crash {
                artifact: Some(artifact),
                call: KINDS.get(usize::from(kind)).map(|kind| (*kind).to_owned()),
                hang,
            },
            None => Crash { hang, ..Crash::default() },
        }
    }
}

/// Where a parent makes its clients' records: the runtime directory when it is set and absolute, else the temporary
/// one. The file has no name there for long (see [`opencode_util::page::private_file`]).
pub fn dir() -> std::path::PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .filter(|dir| dir.is_absolute() && dir.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

fn word(slot: u16, kind: u8) -> u64 {
    let low = (u32::from(slot) << 8) | u32::from(kind);
    u64::from(low) | (u64::from(checksum(&low.to_le_bytes())) << 32)
}

fn call(word: u64) -> Option<(u16, u8)> {
    let low = word as u32;
    (word != 0 && (word >> 32) as u32 == checksum(&low.to_le_bytes()) && low >> 24 == 0)
        .then_some(((low >> 8) as u16, low as u8))
}

/// FNV-1a, never 0, so a zeroed field fails.
fn checksum(bytes: &[u8]) -> u32 {
    let hash = bytes.iter().fold(0x811c_9dc5u32, |hash, byte| (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193));
    hash.max(1)
}

#[cfg(test)]
mod tests;
