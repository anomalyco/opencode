//! The run record (synthesis 4.5): one mapped file per client process, in the runtime directory. Around every plugin
//! call the host stores which plugin and which call runs, and clears it after: two word stores. It also holds what a
//! restart needs, the open session and the composer's draft, written when they change. A clean exit removes the file;
//! after a crash or a hang, the parent reads what it says.
//!
//! A plugin can reach the page with a wild write, so every field that names something is checked: a call word whose
//! checksum does not match, or a name whose checksum does not, names nobody. A wrong name that is valid cannot be
//! told from a right one.
//!
//! Layout, in bytes:
//!
//! | at | what |
//! | ---: | --- |
//! | 0 | [`MAGIC`] |
//! | 8 | the running call: plugin slot (16 bits), call kind (8 bits), checksum (32 bits, high); 0 when none runs |
//! | 16 | when the running call started, in ms since the record was made, plus one; 0 when none runs |
//! | 24 | `HANG` once the watchdog gave up on the call |
//! | 64 | the open session: length (16 bits), then the ID |
//! | 320 | [`NAMES`] plugin names of [`NAME`] bytes each: checksum (32 bits), length (8 bits), the ID |
//! | [`DRAFT`] | the composer's draft: length (32 bits), then the text, cut at a character |

use std::io;
use std::path::{Path, PathBuf};

use opencode_util::page::Page;

pub const SIZE: usize = 64 * 1024;
pub const MAGIC: &[u8; 8] = b"OCRUN\x00\x00\x01";
const CALL: usize = 8;
const STARTED: usize = 16;
const HANG: usize = 24;
const SESSION: usize = 64;
const SESSION_LEN: usize = 256;
const NAME_AT: usize = 320;
/// The plugins a record can name; a later one runs unnamed.
pub const NAMES: usize = 32;
pub const NAME: usize = 128;
pub const DRAFT: usize = NAME_AT + NAMES * NAME;

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
];

/// The index of `kind` in [`KINDS`], or the last index past it for a kind it does not list.
pub fn kind(kind: &str) -> u8 {
    KINDS.iter().position(|known| *known == kind).unwrap_or(KINDS.len()) as u8
}

/// A live record.
pub struct Record {
    page: Page,
    path: PathBuf,
}

impl Record {
    pub fn create(path: &Path) -> io::Result<Record> {
        let page = Page::create(path, SIZE)?;
        page.write(0, MAGIC);
        Ok(Record { page, path: path.to_owned() })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Names plugin slot `slot` `id`, once, before it is first called.
    pub fn name(&self, slot: u16, id: &str) {
        let slot = usize::from(slot);
        if slot >= NAMES {
            return;
        }
        let mut len = id.len().min(NAME - 5);
        while !id.is_char_boundary(len) {
            len -= 1;
        }
        let at = NAME_AT + slot * NAME;
        self.page.write(at + 5, &id.as_bytes()[..len]);
        self.page.write(at + 4, &[len as u8]);
        self.page.store_u32(at, checksum(&id.as_bytes()[..len]));
    }

    /// A call of plugin `slot` of kind `kind` (an index of [`KINDS`]) starts `started` ms after the record was made.
    pub fn enter(&self, slot: u16, kind: u8, started: u64) {
        self.page.store(CALL, word(slot, kind));
        self.page.store(STARTED, started + 1);
    }

    /// The call returned.
    pub fn leave(&self) {
        self.page.store(STARTED, 0);
        self.page.store(CALL, 0);
    }

    /// The running call, and when it started, as [`Record::enter`] stored it.
    pub fn running(&self) -> Option<(u16, u8, u64)> {
        let started = self.page.load(STARTED).checked_sub(1)?;
        let (slot, kind) = call(self.page.load(CALL))?;
        Some((slot, kind, started))
    }

    /// The name of slot `slot`, if it holds a valid one.
    pub fn named(&self, slot: u16) -> Option<String> {
        name(&self.page.read(0, DRAFT), slot)
    }

    pub fn hang(&self) {
        self.page.write(HANG, b"HANG");
    }

    pub fn set_session(&self, id: Option<&str>) {
        let id = id.unwrap_or_default();
        let len = id.len().min(SESSION_LEN - 2);
        self.page.write(SESSION + 2, &id.as_bytes()[..len]);
        self.page.write(SESSION, &(len as u16).to_le_bytes());
    }

    pub fn set_draft(&self, text: &str) {
        let mut len = text.len().min(SIZE - DRAFT - 4);
        while !text.is_char_boundary(len) {
            len -= 1;
        }
        self.page.write(DRAFT + 4, &text.as_bytes()[..len]);
        self.page.write(DRAFT, &(len as u32).to_le_bytes());
    }

    /// The bytes of the record, as a parent reads the file.
    pub fn bytes(&self) -> Vec<u8> {
        self.page.read(0, SIZE)
    }
}

/// What a record says, read back.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Left {
    /// The plugin and call that were running.
    pub plugin: Option<String>,
    pub call: Option<String>,
    /// The watchdog gave up on that call.
    pub hang: bool,
    pub session: Option<String>,
    pub draft: Option<String>,
}

/// Reads a record's bytes; `None` when they are not a record.
pub fn read(bytes: &[u8]) -> Option<Left> {
    if bytes.len() < SIZE || &bytes[..8] != MAGIC {
        return None;
    }
    let word = u64::from_ne_bytes(bytes[CALL..CALL + 8].try_into().ok()?);
    let running = call(word).and_then(|(slot, kind)| Some((name(bytes, slot)?, KINDS.get(usize::from(kind))?)));
    let text = |at: usize, len: usize| {
        (len > 0).then(|| String::from_utf8_lossy(&bytes[at..(at + len).min(bytes.len())]).into_owned())
    };
    let session = usize::from(u16::from_le_bytes([bytes[SESSION], bytes[SESSION + 1]])).min(SESSION_LEN - 2);
    let draft = (u32::from_le_bytes(bytes[DRAFT..DRAFT + 4].try_into().ok()?) as usize).min(SIZE - DRAFT - 4);
    Some(Left {
        plugin: running.as_ref().map(|(plugin, _)| plugin.clone()),
        call: running.map(|(_, kind)| (*kind).to_owned()),
        hang: &bytes[HANG..HANG + 4] == b"HANG",
        session: text(SESSION + 2, session),
        draft: text(DRAFT + 4, draft),
    })
}

/// Where the client of process `pid` keeps its record: the runtime directory, else the temporary one.
pub fn path(pid: u32) -> PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map_or_else(std::env::temp_dir, PathBuf::from);
    dir.join(format!("opencode-plugins-{pid}.run"))
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

fn name(bytes: &[u8], slot: u16) -> Option<String> {
    let slot = usize::from(slot);
    if slot >= NAMES {
        return None;
    }
    let at = NAME_AT + slot * NAME;
    let len = usize::from(bytes[at + 4]).min(NAME - 5);
    let id = &bytes[at + 5..at + 5 + len];
    let check = u32::from_ne_bytes(bytes[at..at + 4].try_into().ok()?);
    (len > 0 && check == checksum(id)).then(|| String::from_utf8_lossy(id).into_owned())
}

/// FNV-1a, never 0 for the bytes it checks, so a zeroed field fails.
fn checksum(bytes: &[u8]) -> u32 {
    let hash = bytes.iter().fold(0x811c_9dc5u32, |hash, byte| (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193));
    hash.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> (opencode_util::temp::TempDir, Record) {
        let dir = opencode_util::temp::tempdir().unwrap();
        let record = Record::create(&dir.path().join("run")).unwrap();
        (dir, record)
    }

    // Expected: inside a call the file names its plugin and call; after it, nobody. The session and the draft read
    // back, the draft cut at a character, and the hang flag once set.
    #[test]
    fn the_file_says_what_ran_and_what_to_restore() {
        let (_dir, record) = record();
        record.name(3, "example.fault");
        record.set_session(Some("ses_1"));
        record.set_draft("héllo");
        record.enter(3, kind("render-slot"), 40);
        let left = read(&std::fs::read(record.path()).unwrap()).unwrap();
        assert_eq!(
            left,
            Left {
                plugin: Some("example.fault".into()),
                call: Some("render-slot".into()),
                hang: false,
                session: Some("ses_1".into()),
                draft: Some("héllo".into()),
            }
        );
        assert_eq!(record.running(), Some((3, kind("render-slot"), 40)));
        record.hang();
        assert!(read(&record.bytes()).unwrap().hang);
        record.leave();
        let left = read(&record.bytes()).unwrap();
        assert_eq!((left.plugin, left.call, record.running()), (None, None, None));
        let long = "é".repeat(SIZE);
        record.set_draft(&long);
        let draft = read(&record.bytes()).unwrap().draft.unwrap();
        assert!(long.starts_with(&draft) && draft.len() >= SIZE - DRAFT - 5, "{}", draft.len());
        record.set_session(None);
        assert_eq!(read(&record.bytes()).unwrap().session, None);
    }

    // Expected: garbage in a field names nobody. A call word with a wrong checksum, a name with a wrong checksum, a
    // slot past the names, and bytes that are not a record.
    #[test]
    fn a_damaged_record_names_nobody() {
        let (_dir, record) = record();
        record.name(0, "a.plugin");
        record.enter(0, 1, 0);
        let good = record.bytes();
        assert_eq!(read(&good).unwrap().plugin.as_deref(), Some("a.plugin"));
        for at in [CALL, CALL + 5, NAME_AT, NAME_AT + 6] {
            let mut bad = good.clone();
            bad[at] ^= 0x40;
            let left = read(&bad).unwrap();
            assert_eq!((left.plugin, left.call), (None, None), "a flipped byte at {at}");
        }
        record.enter(NAMES as u16, 1, 0);
        assert_eq!(read(&record.bytes()).unwrap().plugin, None);
        let mut other = good.clone();
        other[0] = b'X';
        assert_eq!(read(&other), None);
        assert_eq!(read(&good[..100]), None);
    }
}
