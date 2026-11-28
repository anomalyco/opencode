//! Identifiers start with 12 hex digits of `timestamp * 0x1000 + counter`, inverted for descending order, followed by
//! 14 random base-62 characters. The counter orders IDs minted within one millisecond.

use std::sync::Mutex;

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
        let mut clock = CLOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
    id.extend(bytes.iter().map(|byte| char::from(CHARS[usize::from(*byte) % CHARS.len()])));
    id
}

/// The same clock the client shows and the store times optimistic rows by: the P-TUI runner pins it
/// (`OPENCODE_DRIVE_NOW`), and client-minted IDs must sort against the server's IDs minted on that clock.
fn now() -> i64 {
    opencode_util::time::now_ms()
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

    /// One test owns the global counter so parallel calls cannot interleave with the recorded sequence.
    #[test]
    fn matches_the_typescript_identifier_oracle() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../parity/fixtures/F.3/identifier.json")).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            for _ in 1..case.repeat {
                create(case.descending, case.timestamp);
            }
            let id = create(case.descending, case.timestamp);
            assert_eq!(id[..12], case.prefix, "descending {} at {}", case.descending, case.timestamp);
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

    /// Message IDs take their timestamp from the client's clock, which the P-TUI runner pins
    /// (`OPENCODE_DRIVE_NOW`): a client-minted row must sort with the server's IDs minted on the same clock.
    #[test]
    fn message_timestamps_read_the_sim_clock() {
        const FIXED: i64 = 1_600_000_000_000;
        // The process reads the clock once, so a child sets it before anything else runs.
        if std::env::var_os("OPENCODE_RS_CLOCK_CHILD").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "id::tests::message_timestamps_read_the_sim_clock"])
                .env("OPENCODE_RS_CLOCK_CHILD", "1")
                .env("OPENCODE_DRIVE_NOW", FIXED.to_string())
                .output()
                .unwrap();
            let (stdout, stderr) = (String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            assert!(output.status.success() && stdout.contains("1 passed"), "{stdout}\n{stderr}");
            return;
        }
        let id = message();
        let stamp = (u64::from_str_radix(&id[4..16], 16).unwrap() >> 12) as i64;
        let fixed = (FIXED as u64 & ((1 << 36) - 1)) as i64;
        assert!((stamp - fixed).rem_euclid(1 << 36) < 5_000, "{}", id);
    }
}
