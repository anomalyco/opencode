mod output;
mod parse;
mod tree;

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
