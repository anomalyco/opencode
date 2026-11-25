//! Random identifiers.

/// A random version 4 UUID in its hyphenated lowercase form, as `crypto.randomUUID()` writes it.
pub fn v4() -> String {
    let mut bytes = rand::random::<[u8; 16]>();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

#[cfg(test)]
mod tests {
    #[test]
    fn v4_is_a_hyphenated_version_4_uuid() {
        let id = super::v4();
        let groups: Vec<&str> = id.split('-').collect();
        assert_eq!(groups.iter().map(|g| g.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
        assert!(id.chars().all(|c| c == '-' || matches!(c, '0'..='9' | 'a'..='f')));
        assert!(groups[2].starts_with('4'));
        assert!(matches!(groups[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'));
        assert_ne!(id, super::v4());
    }
}
