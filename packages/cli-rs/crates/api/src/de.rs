//! Serde helpers the generated types use.

use serde::de::{DeserializeOwned, Error};
use serde::{Deserialize, Deserializer};

/// For an optional and nullable field: absent is `None` (through `#[serde(default)]`), `null` is
/// `Some(None)`, and a value is `Some(Some(value))`.
pub fn double_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Decodes the member of a tagged union once its tag is known.
pub fn variant<T: DeserializeOwned, E: Error>(value: serde_json::Value) -> Result<T, E> {
    serde_json::from_value(value).map_err(E::custom)
}
