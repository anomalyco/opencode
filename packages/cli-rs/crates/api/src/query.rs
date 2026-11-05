//! Query string encoding, bracket-encoded like `appendQuery`
//! (`packages/client/src/promise/generated/client.ts:2795-2810`).

use serde_json::Value;

pub use opencode_api_types::js::js_string;

/// Appends `value` under `key`: `null` as `"null"`, arrays as repeated keys, objects as `key[child]`,
/// and scalars as JavaScript's `String(value)` would write them.
pub fn append(pairs: &mut Vec<(String, String)>, key: &str, value: &Value) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| append(pairs, key, item)),
        Value::Object(map) => map.iter().for_each(|(child, item)| append(pairs, &format!("{key}[{child}]"), item)),
        _ => pairs.push((key.to_owned(), js_string(value))),
    }
}

/// The `application/x-www-form-urlencoded` form of `pairs`, as `URLSearchParams` serializes it.
pub fn encode(pairs: &[(String, String)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn query(key: &str, value: Value) -> String {
        let mut pairs = Vec::new();
        append(&mut pairs, key, &value);
        encode(&pairs)
    }

    #[test]
    fn nested_objects_use_brackets() {
        assert_eq!(
            query("location", json!({ "directory": "/a b", "workspace": { "id": "w" } })),
            "location%5Bdirectory%5D=%2Fa+b&location%5Bworkspace%5D%5Bid%5D=w"
        );
    }

    #[test]
    fn arrays_repeat_and_null_is_written() {
        assert_eq!(query("types", json!(["a", "b"])), "types=a&types=b");
        assert_eq!(query("cursor", Value::Null), "cursor=null");
    }
}
