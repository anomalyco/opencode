//! The host facts a plugin reads that no data of the server holds (contract ergonomics 2.9): the user's locale, the UTC
//! offset of a time, and a text as the host's text layout counts it.

use opencode_plugin_abi as abi;
use opentui::prelude::*;
use unicode_segmentation::UnicodeSegmentation;

/// The user's locale as a BCP 47 tag, from the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set, as POSIX
/// orders them; `None` when that names none (`C`, `POSIX`, empty).
pub fn locale() -> Option<String> {
    locale_of(|name| std::env::var(name).ok())
}

/// [`locale`] over the variables `var` gives.
pub fn locale_of(var: impl Fn(&str) -> Option<String>) -> Option<String> {
    let value = ["LC_ALL", "LC_MESSAGES", "LANG"].into_iter().filter_map(var).find(|value| !value.is_empty())?;
    // `en_US.UTF-8@euro`: the language and the territory, without the codeset and the modifier.
    let name = value.split(['.', '@']).next().unwrap_or_default();
    if name.is_empty() || name == "C" || name == "POSIX" {
        return None;
    }
    Some(name.replace('_', "-"))
}

/// The seconds local time is east of UTC at `at`, in milliseconds since the epoch, in the process's zone.
pub fn utc_offset(at: i64) -> i32 {
    opencode_util::time::Zone::Local.offset(at)
}

/// The cells `text` takes in a row as OpenTUI draws it in `app`, and its graphemes; a line break takes no cell and is
/// no grapheme.
pub fn measure(app: &App, text: &str) -> abi::Measure {
    let lines = text.split('\n');
    let context = app.session().context();
    let (mut cells, mut graphemes) = (0, 0);
    for line in lines {
        cells += context
            .text_width(line, app.width_method())
            .unwrap_or_else(|_| unicode_width::UnicodeWidthStr::width(line) as u32);
        graphemes += line.graphemes(true).count() as u32;
    }
    abi::Measure { cells, graphemes }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: the first variable set wins, as POSIX orders them; its codeset and modifier go, and `_` becomes `-`;
    // `C` and `POSIX` name no locale.
    #[test]
    fn the_locale_is_the_first_variable_set() {
        let vars = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| (*value).to_owned())
        };
        assert_eq!(locale_of(vars(&[("LANG", "de_DE.UTF-8")])).as_deref(), Some("de-DE"));
        assert_eq!(locale_of(vars(&[("LANG", "de_DE.UTF-8"), ("LC_ALL", "fr_FR@euro")])).as_deref(), Some("fr-FR"));
        assert_eq!(locale_of(vars(&[("LANG", "en_US"), ("LC_MESSAGES", "sv_SE.UTF-8")])).as_deref(), Some("sv-SE"));
        assert_eq!(locale_of(vars(&[("LC_ALL", ""), ("LANG", "ja_JP")])).as_deref(), Some("ja-JP"));
        assert_eq!(locale_of(vars(&[("LANG", "C.UTF-8")])), None);
        assert_eq!(locale_of(vars(&[("LANG", "POSIX")])), None);
        assert_eq!(locale_of(vars(&[])), None);
    }

    // Runs in the zone `TZ` names, which `the_offset_follows_tz` sets with the offset it must read.
    #[test]
    fn the_offset_in_this_zone() {
        let Some(expected) = std::env::var("FACTS_OFFSET").ok() else { return };
        assert_eq!(utc_offset(1_700_000_000_000).to_string(), expected);
    }

    // Expected: the offset is the process's zone, as `TZ` names it: 0 in UTC, two hours east in `Etc/GMT-2` (POSIX's
    // sign is the other way round), five west in `Etc/GMT+5`.
    #[test]
    fn the_offset_follows_tz() {
        for (zone, offset) in [("UTC", 0), ("Etc/GMT-2", 7_200), ("Etc/GMT+5", -18_000)] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "facts::tests::the_offset_in_this_zone", "--test-threads=1"])
                .env("TZ", zone)
                .env("FACTS_OFFSET", offset.to_string())
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(output.status.success() && stdout.contains("1 passed"), "{zone}:\n{stdout}");
        }
    }

    // Expected: a wide character takes two cells, an `e` with a combining accent one cell and one grapheme, a family
    // joined by zero-width joiners one grapheme of two cells, and a line break neither.
    #[test]
    fn the_measure_counts_cells_and_graphemes_as_the_host_draws() {
        let app = opentui::testing::TestApp::new(40, 4);
        let text = |points: &[u32]| points.iter().filter_map(|point| char::from_u32(*point)).collect::<String>();
        let measure = |points: &[u32]| {
            let measure = measure(app.app(), &text(points));
            (measure.cells, measure.graphemes)
        };
        assert_eq!(measure(&[0x61, 0x62]), (2, 2));
        assert_eq!(measure(&[0x65e5, 0x672c]), (4, 2));
        assert_eq!(measure(&[0x65, 0x301]), (1, 1));
        assert_eq!(measure(&[0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]), (2, 1));
        assert_eq!(measure(&[0x61, 0x0a, 0x65e5]), (3, 2));
    }
}
