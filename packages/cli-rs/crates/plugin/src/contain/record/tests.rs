use super::*;

fn record() -> (opencode_util::temp::TempDir, Record) {
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Record::create(dir.path()).unwrap();
    (dir, record)
}

fn fault() -> Artifact {
    Artifact::external("example.fault", "/plugins/fault", "00000000deadbeef")
}

// Expected: inside a call the record names its build (ID, target, digest) and call; after it, nobody. A built-in is
// named by its ID alone, so a crash in it is never taken for an external build of the same ID.
#[test]
fn a_crash_names_the_build_and_the_call() {
    let (_dir, record) = record();
    record.name(3, &fault());
    record.name(4, &Artifact::builtin("example.fault"));
    let generation = record.enter(3, kind("render-slot"), 40);
    assert_eq!(record.running(), Some(Running { generation, slot: 3, kind: kind("render-slot"), started: 40 }));
    assert_eq!(record.crash(), Crash { artifact: Some(fault()), call: Some("render-slot".into()), hang: false });
    assert!(record.leave(generation));
    assert_eq!((record.running(), record.crash()), (None, Crash::default()));
    let builtin = record.enter(4, kind("run-command"), 50);
    assert_eq!(record.crash().artifact, Some(Artifact::builtin("example.fault")));
    assert!(record.leave(builtin));
}

// Expected (bigboi 6, carbon 1): the watchdog claims a call only while it runs. A call that returned first keeps it
// from claiming, so a client that is not hung is never ended; once it claimed, the call cannot leave, and the record
// names the claimed call even if another one's word were written later.
#[test]
fn the_watchdog_claims_only_a_running_call() {
    let (_dir, record) = record();
    record.name(0, &fault());
    record.name(1, &Artifact::builtin("other"));
    let first = record.enter(0, kind("run-command"), 0);
    assert!(record.leave(first));
    assert!(!record.claim(first), "a call that returned is not claimed");
    let second = record.enter(1, kind("render-slot"), 10);
    assert!(!record.claim(first), "an old generation is not claimed");
    assert!(record.claim(second));
    assert!(!record.leave(second), "a claimed call cannot leave");
    let crash = record.crash();
    assert_eq!(
        crash,
        Crash { artifact: Some(Artifact::builtin("other")), call: Some("render-slot".into()), hang: true }
    );
}

// Expected: a coherent read names nothing while the state and the call disagree: a stale start cannot pair with
// another call's identity.
#[test]
fn a_torn_read_names_nobody() {
    let (_dir, record) = record();
    record.name(0, &fault());
    let generation = record.enter(0, kind("run-command"), 5);
    // As if the UI thread had left and was entering the next call: the call word is new, the state still old.
    record.word(W_STATE).store(generation << 2 | IDLE, Ordering::Release);
    assert_eq!(record.running(), None);
    record.word(W_CALL).store((0x1234 << 32) | (1 << 8) | 7, Ordering::Release);
    record.word(W_STATE).store(generation << 2 | RUNNING, Ordering::Release);
    assert_eq!(record.running(), None, "a call word that fails its checksum names nobody");
}

// Expected (carbon 6, bigboi 4): identities are kept whole or not at all. One too long for an entry stays unnamed
// rather than be cut to a prefix another plugin may have; a slot past the table is unnamed; flipped bytes name nobody.
#[test]
fn an_identity_is_whole_or_unnamed() {
    let (_dir, record) = record();
    let long = Artifact::external(&"x".repeat(300), &"/p".repeat(200), "0123456789abcdef");
    record.name(0, &long);
    assert_eq!(record.named(0), None);
    record.name(NAMES as u16, &fault());
    assert_eq!(record.named(NAMES as u16), None);
    record.name(1, &fault());
    assert_eq!(record.named(1), Some(fault()));
    for at in [HEADER + NAME + 4, HEADER + NAME + 10, HEADER + NAME + 30] {
        let byte = record.read(at, 1)[0];
        record.write(at, &[byte ^ 0x40]);
        assert_eq!(record.named(1), None, "a flipped byte at {at}");
        record.write(at, &[byte]);
    }
    assert_eq!(record.named(1), Some(fault()));
}

// Expected (bigboi 8): a snapshot is published whole. A writer interrupted while it fills the other slot leaves the
// previous snapshot readable; a draft too long to keep is dropped, and says so.
#[test]
fn a_snapshot_survives_a_crash_in_the_middle_of_a_write() {
    let (_dir, record) = record();
    assert_eq!(record.snapshot(), None);
    let first = Snapshot { session: Some("ses_1".into()), draft: "héllo".into(), dropped: false };
    record.publish(&first);
    assert_eq!(record.snapshot(), Some(first.clone()));
    // A crash after half the next slot was written: its bytes changed, its checksum and the commit did not.
    let other = HEADER + NAMES * NAME + SLOT;
    record.write(other + 4, b"garbage");
    assert_eq!(record.snapshot(), Some(first));
    let home = Snapshot { session: None, draft: String::new(), dropped: false };
    record.publish(&home);
    assert_eq!(record.snapshot(), Some(home));
    let long = Snapshot { session: Some("ses_2".into()), draft: "a".repeat(DRAFT_MAX + 1), dropped: false };
    record.publish(&long);
    assert_eq!(
        record.snapshot(),
        Some(Snapshot { session: Some("ses_2".into()), draft: String::new(), dropped: true })
    );
    let exact = Snapshot { session: Some("ses_3".into()), draft: "é".repeat(DRAFT_MAX / 2), dropped: false };
    record.publish(&exact);
    assert_eq!(record.snapshot(), Some(exact));
}

// Expected: the handoff reads back as written, and garbage reads as no handoff.
#[test]
fn the_handoff_reads_back() {
    let (_dir, record) = record();
    assert_eq!(record.handoff(), Handoff::default());
    let handoff = Handoff {
        crash: Some(Crash { artifact: Some(fault()), call: Some("render-slot".into()), hang: true }),
        safe: false,
    };
    record.set_handoff(&handoff);
    assert_eq!(record.handoff(), handoff);
    let unnamed = Handoff { crash: Some(Crash::default()), safe: true };
    record.set_handoff(&unnamed);
    assert_eq!(record.handoff(), unnamed);
    record.write(HANDOFF + 4, &[7, 7]);
    assert_eq!(record.handoff(), Handoff::default());
}

// Expected (bigboi 7): a record is opened only from a file that is one, and a second mapping of the same file (the
// client's, and the parent's that reads it after) sees the same words.
#[test]
fn a_handed_over_record_is_the_same_record() {
    let (dir, record) = record();
    let other = Record::open(record.file().try_clone().unwrap()).unwrap();
    record.name(0, &fault());
    let generation = record.enter(0, kind("setup"), 1);
    assert_eq!(other.crash().artifact, Some(fault()));
    assert!(other.claim(generation));
    assert!(!record.leave(generation));
    let stranger = opencode_util::page::private_file(dir.path(), SIZE).unwrap();
    assert!(Record::open(stranger).is_err());
}

// Expected (carbon 1): the watchdog never pairs one call's identity or start with another call's generation, however
// the UI thread's stores and its reads interleave. Each call here has slot and start that follow from its generation.
#[test]
fn a_running_call_is_read_whole_under_contention() {
    let (_dir, record) = record();
    let record = std::sync::Arc::new(record);
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let writer = {
        let (record, stop) = (record.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut next = 1u64;
            while !stop.load(Ordering::Relaxed) {
                let generation = record.enter((next % 100) as u16, 1, next * 3);
                assert_eq!(generation, next);
                assert!(record.leave(generation));
                next += 1;
            }
        })
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
    let mut seen = 0;
    while std::time::Instant::now() < deadline {
        if let Some(running) = record.running() {
            seen += 1;
            assert_eq!((running.slot, running.started), ((running.generation % 100) as u16, running.generation * 3));
        }
    }
    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();
    assert!(seen > 0, "no call was seen running");
}
