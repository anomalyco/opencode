//! `Locale` (`packages/tui/src/util/locale.ts`): the formatting the TUI and mini share.

pub use crate::tool_info::titlecase;

/// `Locale.duration`: `850ms`, `12.4s`, `3m 5s`, `2h 10m`, `1d 4h`.
pub fn duration(input: f64) -> String {
    if input < 1000.0 {
        return format!("{}ms", opencode_api_types::js::number_to_string(input));
    }
    if input < 60_000.0 {
        return format!("{}s", to_fixed_1(input / 1000.0));
    }
    let input = input.floor() as u64;
    if input < 3_600_000 {
        return format!("{}m {}s", input / 60_000, input % 60_000 / 1000);
    }
    if input < 86_400_000 {
        return format!("{}h {}m", input / 3_600_000, input % 3_600_000 / 60_000);
    }
    format!("{}d {}h", input / 86_400_000, input % 86_400_000 / 3_600_000)
}

/// `value.toFixed(1)`: like `{:.1}`, except that an exact tie rounds up, not to even.
fn to_fixed_1(value: f64) -> String {
    let exact = format!("{value:.60}");
    let tail = &exact[exact.find('.').map_or(exact.len(), |dot| dot + 2)..];
    if tail.starts_with('5') && tail[1..].bytes().all(|digit| digit == b'0') {
        return format!("{:.1}", value + 0.05);
    }
    format!("{value:.1}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_matches_locale_duration() {
        assert_eq!(duration(850.0), "850ms");
        assert_eq!(duration(12_400.0), "12.4s");
        // `toFixed` rounds an exact tie up; 1.45 is just below its tie.
        assert_eq!(duration(1_250.0), "1.3s");
        assert_eq!(duration(2_250.0), "2.3s");
        assert_eq!(duration(1_450.0), "1.4s");
        assert_eq!(duration(1_350.0), "1.4s");
        assert_eq!(duration(185_000.0), "3m 5s");
        assert_eq!(duration(7_800_000.0), "2h 10m");
        assert_eq!(duration(100_800_000.0), "1d 4h");
    }
}
