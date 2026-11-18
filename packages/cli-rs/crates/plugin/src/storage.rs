//! Where a plugin's storage keys live in the host's storage (review carbon-6), on every carrier: the linked one, the C
//! ABI's and the JS pipe's.
//!
//! A key the plugin declared is kept under one name of the host's storage. TS names it `plugin.{id}.{key}`, which two
//! plugins can share: a plugin `acme` with a key `cloud.token` and a plugin `acme.cloud` with a key `token` both name
//! `plugin.acme.cloud.token`. So the name of `(id, key)` is:
//!
//! - `plugin.{id}.{key}` for a key with no dot, as TS has it, so the stores of both clients stay one;
//! - `plugin.{id}..{key}` for a key with a dot.
//!
//! An ID and a key are made of letters, digits, `.`, `_` and `-`, and neither starts or ends with a dot or holds two in
//! a row. Then the names are apart: a name with `..` is of a dotted key, whose ID is what comes before the one `..`; a
//! name without is of a dot-free key, whose ID is what comes before the last dot. A pair the rule refuses is refused
//! where it is asked for, and nothing is read or kept for it.
//!
//! What was stored under a dotted key's TS name stays readable: a read finds it there while the new name holds
//! nothing, and the first write moves it to the new name. Until then it is read as it was.
//!
//! What the host keeps for a plugin is bounded: [`KEYS`] declared keys, and [`VALUE_BYTES`] of JSON a value.

use crate::Host;

/// The storage keys one plugin may declare (FT-9: opencode-tokscope declares about 80, its 64 history shards and a
/// dozen others).
pub const KEYS: usize = 128;
/// The JSON bytes one stored value may have (CT-36: opencodebar keeps a price list of 1 MB, prompt-search an index of
/// every prompt, 330 KB at 900 sessions). A value is a file of its own, read when it is asked for; what goes to and
/// from the JS host goes in parts.
pub const VALUE_BYTES: usize = 4 << 20;

/// The host's names of a plugin's key: where it is kept, and where TS kept it, when that is another name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Name {
    pub now: String,
    pub before: Option<String>,
}

/// The names of plugin `id`'s key `key`, or why the pair has none.
pub(crate) fn name(id: &str, key: &str) -> Result<Name, String> {
    if !part(id) {
        return Err(format!("plugin ID {id:?} cannot name storage"));
    }
    if !part(key) {
        return Err(format!("storage key {key:?} is not letters, digits, '.', '_' and '-' between them"));
    }
    match key.contains('.') {
        false => Ok(Name { now: format!("plugin.{id}.{key}"), before: None }),
        true => Ok(Name { now: format!("plugin.{id}..{key}"), before: Some(format!("plugin.{id}.{key}")) }),
    }
}

/// Whether `text` is an ID or a key the names keep apart.
fn part(text: &str) -> bool {
    !text.is_empty()
        && text.chars().all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-'))
        && !text.starts_with('.')
        && !text.ends_with('.')
        && !text.contains("..")
}

/// The value of `name`: its own, else what TS kept under its old name.
pub(crate) fn read(host: &dyn Host, name: &Name) -> Option<String> {
    host.storage_read(&name.now).or_else(|| host.storage_read(name.before.as_deref()?))
}

/// Before a write to `name`: moves what its old name holds to it, while it holds nothing of its own, so a merge keeps
/// those fields and later reads find them.
pub(crate) fn migrate(host: &dyn Host, name: &Name) -> Result<(), String> {
    let Some(before) = &name.before else { return Ok(()) };
    if host.storage_read(&name.now).is_some() {
        return Ok(());
    }
    match host.storage_read(before) {
        Some(json) => host.storage_write(&name.now, &json),
        None => Ok(()),
    }
}

/// Declares `key` among `keys`, a plugin's, within [`KEYS`].
pub(crate) fn declare(keys: &mut Vec<String>, key: &str) -> Result<(), String> {
    if keys.iter().any(|known| known == key) {
        return Ok(());
    }
    if keys.len() >= KEYS {
        return Err(format!("a plugin declares {KEYS} storage keys at most"));
    }
    keys.push(key.to_owned());
    Ok(())
}

/// Refuses a merge of `fields` into what `name` holds when the value it makes is past [`VALUE_BYTES`]: the fields
/// over the stored object, as the host merges them (a value that is no object is replaced by the fields). A merge that
/// replaces a field with one of its size keeps the value's size, so it stays legal (final re-review big-boi).
pub(crate) fn bounded_merge(
    host: &dyn Host,
    name: &Name,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let mut merged = match read(host, name).and_then(|json| serde_json::from_str(&json).ok()) {
        Some(serde_json::Value::Object(object)) => object,
        _ => serde_json::Map::new(),
    };
    merged.extend(fields.iter().map(|(key, value)| (key.clone(), value.clone())));
    bounded(serde_json::Value::Object(merged).to_string().len())
}

/// Refuses a value of `bytes` JSON bytes past [`VALUE_BYTES`].
pub(crate) fn bounded(bytes: usize) -> Result<(), String> {
    match bytes <= VALUE_BYTES {
        true => Ok(()),
        false => Err(format!("a stored value of {bytes} bytes, past {VALUE_BYTES}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pair a name is of, by the rule the module states: what an independent reader of the names makes of them.
    fn parse(name: &str) -> (String, String) {
        let rest = name.strip_prefix("plugin.").unwrap();
        match rest.split_once("..") {
            Some((id, key)) => (id.to_owned(), key.to_owned()),
            None => {
                let (id, key) = rest.rsplit_once('.').unwrap();
                (id.to_owned(), key.to_owned())
            }
        }
    }

    // Expected (review carbon-6): no two pairs share a name, over every pair of short IDs and keys of letters and dots,
    // the ones carbon names among them, and each name reads back as its pair; a dot-free key keeps TS's name, a dotted
    // one names TS's as its old name; a pair the rule cannot keep apart has none.
    #[test]
    fn names_keep_every_pair_apart() {
        let parts: Vec<String> = ["a", "b", "ab", "a.b", "b.a", "a.b.c", "x-y", "x_y", "a.bb", "aa.b"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        let mut seen = std::collections::HashMap::new();
        for id in &parts {
            for key in &parts {
                let name = name(id, key).unwrap();
                assert_eq!(parse(&name.now), (id.clone(), key.clone()), "{name:?}");
                if let Some(other) = seen.insert(name.now.clone(), (id.clone(), key.clone())) {
                    panic!("{id:?} {key:?} and {other:?} share {}", name.now);
                }
            }
        }
        assert_eq!(
            name("opencode.diffs", "view").unwrap(),
            Name { now: "plugin.opencode.diffs.view".into(), before: None }
        );
        let dotted = name("acme", "cloud.token").unwrap();
        assert_eq!(dotted.before.as_deref(), Some("plugin.acme.cloud.token"));
        assert_ne!(dotted.now, name("acme.cloud", "token").unwrap().now);
        for (id, key) in [
            ("a.", "k"),
            (".a", "k"),
            ("a..b", "k"),
            ("a", "k."),
            ("a", ".k"),
            ("a", "k..j"),
            ("a", ""),
            ("", "k"),
            ("a", "k/j"),
            ("a", "../k"),
            ("a b", "k"),
        ] {
            assert!(name(id, key).is_err(), "{id:?} {key:?}");
        }
    }

    // Expected (review carbon-6): a plugin declares 64 keys at most, a key twice counts once, and a value past 256 KiB is
    // refused.
    #[test]
    fn what_a_plugin_keeps_is_bounded() {
        let mut keys = Vec::new();
        for index in 0..KEYS {
            declare(&mut keys, &format!("k{index}")).unwrap();
        }
        declare(&mut keys, "k0").unwrap();
        assert!(declare(&mut keys, "one-more").is_err());
        assert_eq!(keys.len(), KEYS);
        assert!(bounded(VALUE_BYTES).is_ok() && bounded(VALUE_BYTES + 1).is_err());
    }
}
