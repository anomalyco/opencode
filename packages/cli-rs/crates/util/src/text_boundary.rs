//! `TextBoundary` (`packages/util/src/text-boundary.ts`): clip text to a budget of UTF-16 code units, as
//! JavaScript's `.length` counts them, without starting on half a character. The result can be shorter than the
//! budget by the part of the character at the cut. Boundaries are code points, not graphemes.

/// The last `limit` UTF-16 code units of `text`, without the low surrogate whose pair the limit cut off.
pub fn tail(text: &str, limit: usize) -> &str {
    let mut units = 0;
    for (index, character) in text.char_indices().rev() {
        units += character.len_utf16();
        if units > limit {
            return &text[index + character.len_utf8()..];
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLES: [&str; 4] = ["", "ascii", "ab😀cd", "😀é€\u{FFFD}😀"];

    #[test]
    fn every_tail_keeps_whole_characters_within_the_limit() {
        for text in SAMPLES {
            let length = text.encode_utf16().count();
            for limit in 0..=length + 1 {
                let tail = tail(text, limit);
                let units = tail.encode_utf16().count();
                assert!(text.ends_with(tail), "{text:?} {limit}");
                assert!(units <= limit, "{text:?} {limit}");
                assert!(units + 1 >= limit.min(length), "{text:?} {limit}");
            }
        }
    }

    #[test]
    fn a_cut_through_a_surrogate_pair_drops_the_whole_character() {
        assert_eq!(tail("😀x", 2), "x");
        assert_eq!(tail("😀x", 3), "😀x");
        assert_eq!(tail("ab😀", 1), "");
    }
}
