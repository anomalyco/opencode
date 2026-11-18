//! An undotted key keeps its TS name `plugin.{id}.{key}`. Dotted keys use `..` as the separator so
//! `(acme.cloud, token)` and `(acme, cloud.token)` cannot collide. Reads fall back to the old name until the
//! first write; merges must migrate the old object before applying fields.

use crate::Host;

pub const KEYS: usize = 128;
pub const VALUE_BYTES: usize = 256 << 10;

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
/// over the stored object, as the host merges them (a value that is no object is replaced by the fields). A merge
/// that replaces a field with one of its size keeps the value's size, so it stays legal.
pub(crate) fn bounded_merge(
    host: &dyn Host,
    name: &Name,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    bounded(merged(read(host, name), fields.iter().map(|(k, v)| (k.clone(), v.clone()))).len())
}

pub(crate) fn merged(
    previous: Option<String>,
    fields: impl IntoIterator<Item = (String, serde_json::Value)>,
) -> String {
    let mut object: serde_json::Map<_, _> =
        previous.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default();
    object.extend(fields);
    serde_json::Value::Object(object).to_string()
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

    #[test]
    fn names_keep_every_pair_apart() {
        let parts = ["a", "b", "ab", "a.b", "b.a", "a.b.c", "x-y", "x_y", "a.bb", "aa.b"];
        let mut names = std::collections::HashSet::new();
        for id in parts {
            for key in parts {
                let name = name(id, key).unwrap();
                assert!(names.insert(name.now.clone()), "collision: {id} {key}");
                let ts = format!("plugin.{id}.{key}");
                if key.contains('.') {
                    assert_eq!(name.before.as_ref(), Some(&ts));
                } else {
                    assert_eq!(name, Name { now: ts, before: None });
                }
            }
        }
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
