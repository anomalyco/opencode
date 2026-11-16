//! Where a plugin named by npm package lies in the package cache TS installs into, found as TS's `Npm.resolve` finds
//! it (`packages/util/src/npm.ts:358-366`), which the TS client asks for a server plugin's TUI part, and after its
//! install for a `cli.json` entry (`packages/cli/src/commands/handlers/default.ts:143`). Nothing is installed or
//! fetched here: a package the cache does not hold is not found.
//!
//! The cache is `<cache>/npm/<key>` (`npm.ts:148`), `<cache>` the global cache directory (`~/.cache/opencode`). The
//! key is the spec as written, not a version it resolves to (`npm.ts:92-97`):
//!
//! - a registry spec (a version, a range or a tag of a named package, as `npm-package-arg` parses it) is
//!   `<name>@<spec>`, the spec being `latest` for a bare name (`foo@latest`; `foo@^1` is `foo@^1`, `foo@` is `foo@*`);
//! - a git spec is `git-<slug>-<the first 12 hex digits of the spec's SHA-256>`;
//! - anything else (an alias, a directory, a URL, a spec `npm-package-arg` refuses) is the spec itself.
//!
//! On Windows the characters a file name cannot hold become `_` (`sanitize`). Each install is a generation, a
//! numbered directory; the newest, the largest number, is the one used (`npm.ts:149-162`), else the key's directory
//! itself. The package is that directory's `node_modules/<name>`: the spec's name, else the first dependency of the
//! generation's `package.json`, else the spec (`installedName`, `npm.ts:173-183`).

use std::path::{Path, PathBuf};

/// A package the cache holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Package {
    pub directory: PathBuf,
    pub name: String,
}

/// Why a plugin named by npm package `spec` is not loaded: the cache does not hold it, and `opencode-native` installs
/// nothing.
pub fn missing(spec: &str) -> String {
    format!(
        "not in opencode's package cache, and opencode-native installs nothing: run `opencode-native plugin add {spec}`"
    )
}

/// The package `spec` names in the cache under `cache`, if the cache holds it.
pub fn resolve(spec: &str, cache: &Path) -> Option<Package> {
    let target = parse(spec);
    let root = cache.join("npm").join(key(spec, target.as_ref()));
    let base = generation(&root).unwrap_or(root);
    let name = target.and_then(|target| target.name).or_else(|| first_dependency(&base)).unwrap_or(spec.to_owned());
    let directory = base.join("node_modules").join(&name);
    directory.is_dir().then_some(Package { directory, name })
}

/// What `npm-package-arg` makes of a spec, as far as the key and the name go.
#[derive(Debug, PartialEq, Eq)]
struct Target {
    kind: Kind,
    name: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    /// A version, range or tag of `name`, and the spec part of the key.
    Registry(String),
    /// A git spec.
    Git,
}

/// The directory under `<cache>/npm` that holds the installs of `spec` (TS `Npm.cacheKey`).
pub fn cache_key(spec: &str) -> String {
    key(spec, parse(spec).as_ref())
}

/// The cache key of `spec` (`key`, `npm.ts:92-97`).
fn key(spec: &str, target: Option<&Target>) -> String {
    match target {
        Some(Target { kind: Kind::Registry(range), name: Some(name) }) => sanitize(&format!("{name}@{range}")),
        Some(Target { kind: Kind::Git, .. }) => {
            let digest = ring::digest::digest(&ring::digest::SHA256, spec.as_bytes());
            let hex: String = digest.as_ref().iter().map(|byte| format!("{byte:02x}")).collect();
            format!("git-{}-{}", git_slug(spec), &hex[..12])
        }
        _ => sanitize(spec),
    }
}

/// `parse` (`npm.ts:68-90`): a registry target for a version, range or tag of a named package, a git target, or none.
fn parse(spec: &str) -> Option<Target> {
    if let Some(target) = git(spec) {
        return Some(target);
    }
    let (name, range) = split(spec)?;
    if !valid_name(name)
        || ["npm:", "file:", "http:", "https:", "git+", "git:"].iter().any(|kind| range.starts_with(kind))
    {
        return None;
    }
    // A bare name is `latest` (`result.raw === result.name`); `name@` is the range `*`, as `npm-package-arg` reads it.
    let range = match (spec == name, range) {
        (true, _) => "latest".to_owned(),
        (false, "") => "*".to_owned(),
        (false, range) => range.to_owned(),
    };
    // A tag must be URI-safe; a range or version is not (`foo@>=1 <2`). What is neither, `npm-package-arg` refuses.
    if !semver_like(&range) && !uri_safe(&range) {
        return None;
    }
    Some(Target { kind: Kind::Registry(range), name: Some(name.to_owned()) })
}

/// `name` and what follows its `@`: a scoped name keeps its first `@`.
fn split(spec: &str) -> Option<(&str, &str)> {
    let at = match spec.strip_prefix('@') {
        Some(rest) => rest.find('@').map(|index| index + 1),
        None => spec.find('@'),
    };
    Some(match at {
        Some(index) => (&spec[..index], &spec[index + 1..]),
        None => (spec, ""),
    })
}

/// A package name `npm-package-arg` takes (old names too, so capitals count): `name` or `@scope/name`, of URL-safe
/// characters, not starting with `.` or `_`.
fn valid_name(name: &str) -> bool {
    let part = |part: &str| {
        !part.is_empty()
            && !part.starts_with('.')
            && !part.starts_with('_')
            && part.chars().all(|char| char.is_ascii_alphanumeric() || "-._~!*'()".contains(char))
    };
    match name.strip_prefix('@') {
        Some(scoped) => scoped.split_once('/').is_some_and(|(scope, name)| part(scope) && part(name)),
        None => part(name),
    }
}

/// Whether `range` reads as a semver version or range (digits, `x`, `*`, operators, `||`, spaces, `-`).
fn semver_like(range: &str) -> bool {
    range.chars().any(|char| char.is_ascii_digit() || char == '*' || char == 'x' || char == 'X')
        && range.chars().all(|char| char.is_ascii_alphanumeric() || " .*xX^~<>=|-+".contains(char))
        && range.chars().next().is_some_and(|char| !char.is_ascii_alphabetic() || matches!(char, 'x' | 'X' | 'v'))
}

/// `encodeURIComponent(tag) === tag`.
fn uri_safe(tag: &str) -> bool {
    !tag.is_empty() && tag.chars().all(|char| char.is_ascii_alphanumeric() || "-_.!~*'()".contains(char))
}

/// A git spec as `npm-package-arg` reads one: a `git+` or `git://` URL, a hosted shorthand (`github:`, `gitlab:`,
/// `bitbucket:`, `gist:`, or `user/repo`), or a name whose spec is one of those.
fn git(spec: &str) -> Option<Target> {
    let hosted = |spec: &str| {
        ["git+", "git://", "github:", "gitlab:", "bitbucket:", "gist:"].iter().any(|prefix| spec.starts_with(prefix))
            || shorthand(spec)
    };
    if hosted(spec) {
        return Some(Target { kind: Kind::Git, name: None });
    }
    let (name, range) = split(spec)?;
    (valid_name(name) && !range.is_empty() && hosted(range))
        .then(|| Target { kind: Kind::Git, name: Some(name.to_owned()) })
}

/// `user/repo`, with an optional `#committish`: GitHub's shorthand.
fn shorthand(spec: &str) -> bool {
    let path = spec.split('#').next().unwrap_or_default();
    !spec.starts_with('@')
        && !spec.starts_with('.')
        && !spec.starts_with('/')
        && path.split('/').count() == 2
        && path.split('/').all(|part| {
            !part.is_empty() && part.chars().all(|char| char.is_ascii_alphanumeric() || "-._".contains(char))
        })
}

/// `gitSlug` (`npm.ts:99-115`).
fn git_slug(spec: &str) -> String {
    let target = spec.split('#').next().unwrap_or_default();
    let target = percent_decode(target).unwrap_or_else(|| target.to_owned());
    // `/\.git$/i`.
    let target = match target
        .len()
        .checked_sub(4)
        .filter(|at| target.get(*at..).is_some_and(|end| end.eq_ignore_ascii_case(".git")))
    {
        Some(at) => target[..at].to_owned(),
        None => target,
    };
    let last = target.rsplit(['/', ':', '\\']).next().unwrap_or_default();
    let mut slug = String::new();
    let mut dash = false;
    for char in last.chars() {
        match char.is_ascii_alphanumeric() || "._-".contains(char) {
            true => {
                slug.push(char);
                dash = false;
            }
            false if !dash => {
                slug.push('-');
                dash = true;
            }
            false => {}
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "repository".to_owned() } else { slug.to_owned() }
}

/// `decodeURIComponent`, or `None` where it throws.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = text.get(index + 1..index + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// `sanitize` (`npm.ts:45-50`): on Windows, `<>:"|?*` and control characters become `_`.
fn sanitize(key: &str) -> String {
    match cfg!(windows) {
        true => {
            key.chars().map(|char| if "<>:\"|?*".contains(char) || (char as u32) < 32 { '_' } else { char }).collect()
        }
        false => key.to_owned(),
    }
}

/// The newest generation under `root`: its numbered directory with the largest number.
fn generation(root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let newest = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let number = (!name.is_empty() && name.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| name.parse::<u128>().ok())??;
            Some((number, name))
        })
        .max_by_key(|(number, _)| *number)?;
    Some(root.join(newest.1))
}

/// The first dependency of `<base>/package.json`, as an install records the package it added.
fn first_dependency(base: &Path) -> Option<String> {
    let text = std::fs::read_to_string(base.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    manifest.get("dependencies")?.as_object()?.keys().next().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The keys of each spec form, as `npm.ts` makes them: checked against `npm-package-arg` 13's parse of each (the
    /// type and the raw spec, run with Bun in the TS checkout).
    #[test]
    fn a_spec_is_keyed_by_its_text() {
        let registry = |spec: &str| key(spec, parse(spec).as_ref());
        assert_eq!(registry("foo"), "foo@latest");
        assert_eq!(registry("foo@1.2.3"), "foo@1.2.3");
        assert_eq!(registry("foo@^1"), "foo@^1");
        assert_eq!(registry("foo@latest"), "foo@latest");
        assert_eq!(registry("foo@beta"), "foo@beta");
        assert_eq!(registry("foo@"), "foo@*");
        assert_eq!(registry("Foo"), "Foo@latest");
        assert_eq!(registry("@s/foo"), "@s/foo@latest");
        assert_eq!(registry("@s/foo@2"), "@s/foo@2");
        assert_eq!(registry("@s/foo@>=1 <2"), "@s/foo@>=1 <2");
        // Not registry specs: the spec itself.
        for spec in ["foo@npm:bar@1", "file:../x", "https://x.org/y.tgz", "foo bar"] {
            assert_eq!(registry(spec), sanitize(spec), "{spec}");
        }
        // Git: the slug and the spec's hash (`createHash("sha256").update(pkg).digest("hex").slice(0, 12)`).
        let git = registry("github:u/r");
        assert!(git.starts_with("git-r-") && git.len() == "git-r-".len() + 12, "{git}");
        assert!(registry("u/r").starts_with("git-r-"));
        assert!(registry("git+https://x.org/y.git#abc").starts_with("git-y-"));
        assert_eq!(parse("foo@git+https://x.org/y.git").and_then(|target| target.name), Some("foo".to_owned()));
    }

    // Expected (TS `Npm.resolve`): the newest generation's `node_modules/<name>`; a scoped name nests; a git spec's
    // name is the generation's first dependency; nothing in the cache, or only a key without the package, is not found.
    #[test]
    fn a_package_resolves_in_the_newest_generation() {
        let cache = opencode_util::temp::tempdir().unwrap();
        let install = |key: &str, generation: &str, name: &str| {
            let root = cache.path().join("npm").join(key).join(generation);
            std::fs::create_dir_all(root.join("node_modules").join(name)).unwrap();
            let manifest = serde_json::json!({ "dependencies": { name: "x" } });
            std::fs::write(root.join("package.json"), manifest.to_string()).unwrap();
            root.join("node_modules").join(name)
        };
        install("foo@latest", "100", "foo");
        let newest = install("foo@latest", "1200", "foo");
        install("foo@latest", "999", "foo");
        assert_eq!(resolve("foo", cache.path()), Some(Package { directory: newest, name: "foo".into() }));
        let scoped = install("@s/foo@^2", "5", "@s/foo");
        assert_eq!(resolve("@s/foo@^2", cache.path()).map(|package| package.directory), Some(scoped));
        // `foo@1` is another key than `foo`: it is not installed.
        assert_eq!(resolve("foo@1", cache.path()), None);
        let git = key("github:u/r", parse("github:u/r").as_ref());
        let named = install(&git, "7", "real-name");
        assert_eq!(resolve("github:u/r", cache.path()), Some(Package { directory: named, name: "real-name".into() }));
        std::fs::create_dir_all(cache.path().join("npm").join("bar@latest").join("3")).unwrap();
        assert_eq!(resolve("bar", cache.path()), None);
        assert_eq!(resolve("baz", cache.path()), None);
    }
}
