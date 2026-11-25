//! Clips at a Unicode scalar boundary within a UTF-16 budget; the cut may fall inside a grapheme.

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

    #[test]
    fn tail_is_the_longest_suffix_within_the_utf16_budget() {
        for a in ["", "x", "é", "€", "😀"] {
            for b in ["", "ab", "\u{301}", "😀", "😀😀"] {
                let text = format!("{a}{b}{a}");
                for limit in 0..=text.encode_utf16().count() + 1 {
                    let suffix = tail(&text, limit);
                    let units = suffix.encode_utf16().count();
                    let prefix = text.strip_suffix(suffix).unwrap();
                    assert!(units <= limit);
                    assert!(prefix.chars().next_back().is_none_or(|c| units + c.len_utf16() > limit));
                }
            }
        }
    }
}
