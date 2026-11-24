mod output;
mod parse;
mod tree;

#[test]
fn service_set_keeps_the_value_out_of_the_logged_arguments() {
    let cases: [(&[&str], &[&str]); 4] = [
        (&["service", "set", "password", "not-in-log"], &["service", "set", "password", "<redacted>"]),
        (
            &["service", "set", "env", "PROVIDER_KEY", "not-in-log"],
            &["service", "set", "env", "PROVIDER_KEY", "<redacted>"],
        ),
        (
            &["--server", "http://127.0.0.1:9", "service", "set", "password", "not-in-log"],
            &["--server", "http://127.0.0.1:9", "service", "set", "password", "<redacted>"],
        ),
        (&["service", "get", "password"], &["service", "get", "password"]),
    ];
    for (args, logged) in cases {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        assert_eq!(crate::logged_args(&args), logged);
    }
}

/// The first line where `expected` and `actual` differ, with its neighbors, for a readable failure.
fn lines_diff(expected: &str, actual: &str) -> String {
    let expected: Vec<&str> = expected.split('\n').collect();
    let actual: Vec<&str> = actual.split('\n').collect();
    let index =
        (0..expected.len().max(actual.len())).find(|index| expected.get(*index) != actual.get(*index)).unwrap_or(0);
    let around = |lines: &[&str]| {
        lines
            .iter()
            .enumerate()
            .skip(index.saturating_sub(2))
            .take(5)
            .map(|(index, line)| format!("  {:4} {line:?}", index + 1))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!("TypeScript:\n{}\nRust:\n{}", around(&expected), around(&actual))
}
