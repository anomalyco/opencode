//! Identifiers, ported from `packages/schema/src/identifier.ts` (F.3).
//!
//! An identifier is 12 hex digits of `timestamp * 0x1000 + counter` (bitwise inverted for descending
//! order) followed by 14 random base-62 characters. The counter restarts whenever the millisecond
//! changes, so identifiers minted in one process sort by creation within a millisecond too.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const LENGTH: usize = 26;
const CHARS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

static CLOCK: Mutex<(i64, i64)> = Mutex::new((0, 0));

pub fn ascending() -> String {
    create(false, now())
}

pub fn descending() -> String {
    create(true, now())
}

/// A session ID, `ses_` and a descending identifier, so newer sessions sort first.
pub fn session() -> String {
    format!("ses_{}", descending())
}

/// A message ID, `msg_` and an ascending identifier.
pub fn message() -> String {
    format!("msg_{}", ascending())
}

/// A part ID, `prt_` and an ascending identifier.
pub fn part() -> String {
    format!("prt_{}", ascending())
}

pub fn create(descending: bool, timestamp: i64) -> String {
    let counter = {
        let mut clock = CLOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if clock.0 != timestamp {
            *clock = (timestamp, 0);
        }
        clock.1 += 1;
        clock.1
    };
    let current = timestamp.wrapping_mul(0x1000).wrapping_add(counter);
    let value = if descending { !current } else { current };
    let mut id = String::with_capacity(LENGTH);
    for index in 0..6 {
        id.push_str(&format!("{:02x}", (value >> (40 - 8 * index)) & 0xff));
    }
    let mut bytes = [0_u8; LENGTH - 12];
    rand::fill(&mut bytes);
    id.extend(
        bytes
            .iter()
            .map(|byte| char::from(CHARS[usize::from(*byte) % CHARS.len()])),
    );
    id
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        descending: bool,
        timestamp: i64,
        repeat: usize,
        prefix: String,
    }

    /// P-ORACLE: `parity/oracle/F.3-identifier.ts` records the time prefixes TypeScript mints for a
    /// call sequence; the same sequence must give the same prefixes here. One test owns the global
    /// counter so parallel tests cannot interleave with the sequence.
    #[test]
    fn matches_the_typescript_identifier_oracle() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../parity/fixtures/F.3/identifier.json"))
                .unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            for _ in 1..case.repeat {
                create(case.descending, case.timestamp);
            }
            let id = create(case.descending, case.timestamp);
            assert_eq!(
                id[..12],
                case.prefix,
                "descending {} at {}",
                case.descending,
                case.timestamp
            );
            assert_eq!(id.len(), LENGTH);
            assert!(id[12..].bytes().all(|byte| CHARS.contains(&byte)));
        }

        let older = session();
        let newer = format!("ses_{}", create(true, now() + 1));
        assert!(newer < older, "descending IDs sort newest first");
        let first = message();
        let second = message();
        assert!(first < second, "ascending IDs sort by creation");
        assert!(part().starts_with("prt_"));
    }
}
