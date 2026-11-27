//! Extension-to-MIME lookups backed by the generated `mime-types` table.

mod types;

use crate::path::Flavor;

/// `FSUtil.mimeType`: `mime-types`' `lookup`, else `application/octet-stream`.
pub fn mime_type(path: &str) -> &'static str {
    lookup(Flavor::NATIVE, path).unwrap_or("application/octet-stream")
}

/// `extname("x." + path)`: the extension of the last segment, unless its only dot leads.
pub fn lookup(flavor: Flavor, path: &str) -> Option<&'static str> {
    lookup_name(flavor, &format!("x.{path}"))
}

/// `Bun.file(filename).type.split(";")[0]` for a file name: requires a dot-prefixed extension, else
/// `application/octet-stream`.
pub fn from_filename(filename: &str) -> &'static str {
    lookup_name(Flavor::NATIVE, filename).unwrap_or("application/octet-stream")
}

fn lookup_name(flavor: Flavor, path: &str) -> Option<&'static str> {
    let base = flavor.basename(path);
    let dot = base.rfind('.').filter(|at| *at > 0)?;
    let extension = base[dot + 1..].to_lowercase();
    types::TYPES.binary_search_by(|(key, _)| (*key).cmp(extension.as_str())).ok().map(|index| types::TYPES[index].1)
}
