use opencode_local::jsonc::{MAX_DEPTH, Segment, modify, parse, parse_tree};
use opencode_util::rng::SplitMix64;

#[test]
fn jsonc_never_panics() {
    let count: usize = std::env::var("DIFF_CASES").ok().and_then(|n| n.parse().ok()).unwrap_or(200);
    let seed: u64 = std::env::var("DIFF_SEED").ok().and_then(|n| n.parse().ok()).unwrap_or(1);
    let tokens = [
        "{",
        "}",
        "[",
        "]",
        ",",
        ":",
        "\"a\"",
        "\"日本\"",
        "\"é\"",
        "\"😀\"",
        "\"e\u{301}\"",
        "1",
        "-2.5e3",
        "true",
        "null",
        " ",
        "\n",
        "\r\n",
        "\t",
        "// c 日本\n",
        "/* é */",
        "/*",
        "\"",
        "\\",
        "\"\\u00e9\"",
        "\"\\ud83d\"",
        "\u{feff}",
        "\u{a0}",
        "\u{2028}",
        "x",
        "😀",
        ",,",
        "0x1",
        "NaN",
    ];
    let keys = ["a", "日本", "é", "😀", "", "$schema"];
    let mut rng = SplitMix64(seed);
    for _ in 0..count {
        let text: String = (0..rng.below(24)).map(|_| tokens[rng.below(tokens.len() as u64) as usize]).collect();
        let path: Vec<Segment> = (0..rng.below(3))
            .map(|_| match rng.below(3) {
                0 => Segment::Index(rng.below(3) as usize),
                _ => Segment::Key(keys[rng.below(keys.len() as u64) as usize].to_owned()),
            })
            .collect();
        let value = [None, Some(serde_json::json!("日本😀")), Some(serde_json::json!({ "é": [1, null] }))]
            [rng.below(3) as usize]
            .clone();
        let outcome = std::panic::catch_unwind(|| {
            let _ = parse(&text);
            let _ = parse_tree(&text);
            if let Ok(edited) = modify(&text, &path, value.as_ref()) {
                let _ = parse(&edited);
            }
        });
        assert!(outcome.is_ok(), "{text:?} {path:?} {value:?}");
    }
}

// Nesting past the bound is a parse error rather than a stack overflow, in any thread, and an edit fails rather than
// formatting gigabytes.
#[test]
fn deep_jsonc_is_invalid_not_a_crash() {
    let nested = |depth: usize| "[".repeat(depth) + &"]".repeat(depth);
    assert!(parse(&nested(MAX_DEPTH)).is_some());
    for depth in [MAX_DEPTH + 1, 100_000] {
        assert_eq!(parse(&nested(depth)), None, "{depth}");
        assert!(parse_tree(&nested(depth)).errors > 0, "{depth}");
        let edit = modify(&nested(depth), &[Segment::Index(0)], Some(&serde_json::json!(1)));
        assert_eq!(edit.unwrap_err().to_string(), "Can not edit a document nested deeper than 512 levels");
    }
}
