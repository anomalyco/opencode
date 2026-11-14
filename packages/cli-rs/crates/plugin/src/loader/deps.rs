//! What a native build asks the platform loader to load with it (bigboi-3): the dependencies and search paths an ELF
//! or Mach-O file names. The loader opens a build from a private copy that holds only that one file, so a dependency
//! comes from the system, from the paths the build names, or, for a relative path, from the current directory, which
//! is the project. An approval names one file's bytes (rich-plugins 3.9), so what it covers must not reach code
//! outside it.
//!
//! - No build may name a path the loader resolves against the current directory, a search path with `..` beside its
//!   own directory (which would leave the private copy), or an empty search path entry (which glibc reads as the
//!   current directory).
//! - A project's build may also name no absolute path outside the system's libraries (`/usr/lib`, and `/System` on
//!   macOS), since such a path can point back into the project. Its dependencies are then system libraries and the
//!   user's own `LD_LIBRARY_PATH` or `DYLD_*` settings.
//!
//! Windows needs no reading: `win::load_library` searches no directory a project controls. A file that is neither
//! ELF nor Mach-O passes here; the platform loader refuses it.

/// Checks the dependencies `bytes` names, with the stricter rule for a project's build.
pub fn check(bytes: &[u8], project: bool) -> Result<(), String> {
    let names = named(bytes)?;
    for name in &names {
        if let Some(reason) = refused(name, project) {
            return Err(format!("the library depends on {:?}, {reason}", name.text()));
        }
    }
    Ok(())
}

/// A dependency or search path an executable file names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Name {
    /// An ELF `DT_NEEDED` or a Mach-O `LC_*_DYLIB` path.
    Library(String),
    /// One entry of an ELF `DT_RPATH` or `DT_RUNPATH`, or a Mach-O `LC_RPATH`.
    Search(String),
}

impl Name {
    fn text(&self) -> &str {
        match self {
            Name::Library(text) | Name::Search(text) => text,
        }
    }
}

/// Why `name` is refused, if it is.
fn refused(name: &Name, project: bool) -> Option<&'static str> {
    let text = name.text();
    // The directory of the private copy, which holds the build alone.
    let own = ["$ORIGIN", "${ORIGIN}", "@loader_path"];
    let here = |prefix: &str| text.strip_prefix(prefix).map(|rest| rest.trim_start_matches('/'));
    if let Some(rest) = own.iter().find_map(|prefix| here(prefix)) {
        return match rest.split('/').any(|part| part == "..") {
            true => Some("which leaves the plugin's own directory"),
            false => None,
        };
    }
    // The client's own directory, or a path found through the search paths, which are checked themselves.
    if text.starts_with("@executable_path") || text.starts_with("@rpath") {
        return None;
    }
    if text.is_empty() && matches!(name, Name::Search(_)) {
        return Some("an empty search path, which means the current directory");
    }
    if !text.starts_with('/') {
        return match name {
            // A bare name is searched for in the search paths and the system's directories.
            Name::Library(_) if !text.contains('/') => None,
            _ => Some("a path relative to the current directory, which is the project"),
        };
    }
    let system = text.starts_with("/usr/lib/") || text.starts_with("/System/");
    match project && !system {
        true => Some("a path outside the system's libraries, which a project's plugin may not name"),
        false => None,
    }
}

/// The names `bytes` asks the loader for; none for a file that is neither ELF nor Mach-O. A file that claims to be one
/// but cannot be read as one is refused.
pub fn named(bytes: &[u8]) -> Result<Vec<Name>, String> {
    if bytes.starts_with(b"\x7fELF") {
        return elf(bytes).ok_or_else(|| "the library's ELF dynamic section cannot be read".to_owned());
    }
    match bytes.get(..4).map(|magic| [magic[0], magic[1], magic[2], magic[3]]) {
        Some([0xca, 0xfe, 0xba, 0xbe] | [0xca, 0xfe, 0xba, 0xbf]) => fat(bytes),
        Some(magic) if macho_magic(magic).is_some() => macho(bytes),
        _ => Ok(Vec::new()),
    }
    .map_err(|()| "the library's Mach-O load commands cannot be read".to_owned())
}

/// Reads integers of one width and byte order.
#[derive(Clone, Copy)]
struct Reader<'a> {
    bytes: &'a [u8],
    big: bool,
}

impl Reader<'_> {
    fn u16(self, at: usize) -> Option<u64> {
        let raw: [u8; 2] = self.bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(u64::from(if self.big { u16::from_be_bytes(raw) } else { u16::from_le_bytes(raw) }))
    }

    fn u32(self, at: usize) -> Option<u64> {
        let raw: [u8; 4] = self.bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(u64::from(if self.big { u32::from_be_bytes(raw) } else { u32::from_le_bytes(raw) }))
    }

    fn u64(self, at: usize) -> Option<u64> {
        let raw: [u8; 8] = self.bytes.get(at..at.checked_add(8)?)?.try_into().ok()?;
        Some(if self.big { u64::from_be_bytes(raw) } else { u64::from_le_bytes(raw) })
    }

    /// A word of the file's class: 8 bytes in a 64-bit file.
    fn word(self, wide: bool, at: usize) -> Option<u64> {
        if wide { self.u64(at) } else { self.u32(at) }
    }

    /// The NUL-terminated string at `at`.
    fn string(self, at: usize) -> Option<String> {
        let rest = self.bytes.get(at..)?;
        let end = rest.iter().position(|byte| *byte == 0)?;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }
}

const PT_LOAD: u64 = 1;
const PT_DYNAMIC: u64 = 2;
const DT_NEEDED: u64 = 1;
const DT_STRTAB: u64 = 5;
const DT_RPATH: u64 = 15;
const DT_RUNPATH: u64 = 29;

/// An ELF file's `DT_NEEDED` names and `DT_RPATH` and `DT_RUNPATH` entries.
fn elf(bytes: &[u8]) -> Option<Vec<Name>> {
    let wide = match bytes.get(4)? {
        1 => false,
        2 => true,
        _ => return None,
    };
    let big = match bytes.get(5)? {
        1 => false,
        2 => true,
        _ => return None,
    };
    let read = Reader { bytes, big };
    let (phoff, phentsize, phnum) = match wide {
        true => (read.u64(0x20)?, read.u16(0x36)?, read.u16(0x38)?),
        false => (read.u32(0x1c)?, read.u16(0x2a)?, read.u16(0x2c)?),
    };
    // (type, offset, address, size in the file) of each program header.
    let headers: Vec<(u64, u64, u64, u64)> = (0..phnum)
        .map(|index| {
            let at = usize::try_from(phoff.checked_add(index.checked_mul(phentsize)?)?).ok()?;
            Some(match wide {
                true => (read.u32(at)?, read.u64(at + 8)?, read.u64(at + 16)?, read.u64(at + 32)?),
                false => (read.u32(at)?, read.u32(at + 4)?, read.u32(at + 8)?, read.u32(at + 16)?),
            })
        })
        .collect::<Option<_>>()?;
    // A file without a dynamic section is linked statically and loads nothing more.
    let Some(&(_, dynamic, _, size)) = headers.iter().find(|header| header.0 == PT_DYNAMIC) else {
        return Some(Vec::new());
    };
    let entry = if wide { 16 } else { 8 };
    let entries: Vec<(u64, u64)> = (0..size / entry)
        .map(|index| {
            let at = usize::try_from(dynamic.checked_add(index * entry)?).ok()?;
            Some((read.word(wide, at)?, read.word(wide, at + entry as usize / 2)?))
        })
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .take_while(|(tag, _)| *tag != 0)
        .collect();
    let names: Vec<&(u64, u64)> =
        entries.iter().filter(|(tag, _)| matches!(*tag, DT_NEEDED | DT_RPATH | DT_RUNPATH)).collect();
    if names.is_empty() {
        return Some(Vec::new());
    }
    // The string table is named by its address; the loadable segment that holds it gives its place in the file.
    let address = entries.iter().find(|(tag, _)| *tag == DT_STRTAB)?.1;
    let table = headers
        .iter()
        .filter(|header| header.0 == PT_LOAD)
        .find(|(_, _, start, size)| address >= *start && address - start < *size)
        .map(|(_, offset, start, _)| offset + (address - start))?;
    let mut out = Vec::new();
    for (tag, value) in names {
        let text = read.string(usize::try_from(table.checked_add(*value)?).ok()?)?;
        match *tag {
            DT_NEEDED => out.push(Name::Library(text)),
            _ => out.extend(text.split(':').map(|entry| Name::Search(entry.to_owned()))),
        }
    }
    Some(out)
}

const LC_LOAD_DYLIB: u64 = 0xc;
const LC_LOAD_WEAK_DYLIB: u64 = 0x8000_0018;
const LC_RPATH: u64 = 0x8000_001c;
const LC_REEXPORT_DYLIB: u64 = 0x8000_001f;
const LC_LAZY_LOAD_DYLIB: u64 = 0x20;
const LC_LOAD_UPWARD_DYLIB: u64 = 0x8000_0023;

/// Whether `magic` is a thin Mach-O header's: `(wide, big-endian)`.
fn macho_magic(magic: [u8; 4]) -> Option<(bool, bool)> {
    match u32::from_le_bytes(magic) {
        0xfeed_face => Some((false, false)),
        0xfeed_facf => Some((true, false)),
        _ => match u32::from_be_bytes(magic) {
            0xfeed_face => Some((false, true)),
            0xfeed_facf => Some((true, true)),
            _ => None,
        },
    }
}

/// The dylib paths and run paths of a thin Mach-O file's load commands.
fn macho(bytes: &[u8]) -> Result<Vec<Name>, ()> {
    let magic = bytes.get(..4).ok_or(())?;
    let (wide, big) = macho_magic([magic[0], magic[1], magic[2], magic[3]]).ok_or(())?;
    let read = Reader { bytes, big };
    let count = read.u32(16).ok_or(())?;
    let mut at = if wide { 32 } else { 28 };
    let mut out = Vec::new();
    for _ in 0..count {
        let (command, size) = (read.u32(at).ok_or(())?, read.u32(at + 4).ok_or(())?);
        if size < 8 {
            return Err(());
        }
        let name = || {
            let offset = read.u32(at + 8)?;
            read.string(at.checked_add(usize::try_from(offset).ok()?)?)
        };
        match command {
            LC_LOAD_DYLIB | LC_LOAD_WEAK_DYLIB | LC_REEXPORT_DYLIB | LC_LAZY_LOAD_DYLIB | LC_LOAD_UPWARD_DYLIB => {
                out.push(Name::Library(name().ok_or(())?))
            }
            LC_RPATH => out.push(Name::Search(name().ok_or(())?)),
            _ => {}
        }
        at = at.checked_add(usize::try_from(size).map_err(|_| ())?).ok_or(())?;
    }
    Ok(out)
}

/// The names of every slice of a universal Mach-O file.
fn fat(bytes: &[u8]) -> Result<Vec<Name>, ()> {
    let read = Reader { bytes, big: true };
    let wide = bytes.get(3) == Some(&0xbf);
    let count = read.u32(4).ok_or(())?;
    let entry = if wide { 32 } else { 20 };
    let mut out = Vec::new();
    for index in 0..usize::try_from(count).map_err(|_| ())? {
        let at = 8 + index * entry;
        let (offset, size) = match wide {
            true => (read.u64(at + 8).ok_or(())?, read.u64(at + 16).ok_or(())?),
            false => (read.u32(at + 8).ok_or(())?, read.u32(at + 12).ok_or(())?),
        };
        let start = usize::try_from(offset).map_err(|_| ())?;
        let end = start.checked_add(usize::try_from(size).map_err(|_| ())?).ok_or(())?;
        out.extend(macho(bytes.get(start..end).ok_or(())?)?);
    }
    Ok(out)
}

/// A little-endian ELF64 file with one loadable segment over the whole file, a dynamic section, and a string table
/// holding `needed` and `runpath`.
#[cfg(test)]
pub(crate) fn elf64(needed: &[&str], runpath: Option<&str>) -> Vec<u8> {
    let mut strings = vec![0u8];
    let mut add = |text: &str| {
        let at = strings.len() as u64;
        strings.extend(text.as_bytes());
        strings.push(0);
        at
    };
    let mut dynamic: Vec<(u64, u64)> = needed.iter().map(|name| (DT_NEEDED, add(name))).collect();
    if let Some(path) = runpath {
        dynamic.push((DT_RUNPATH, add(path)));
    }
    let (phoff, phnum) = (64u64, 2u64);
    let dynoff = phoff + 56 * phnum;
    let strtab = dynoff + 16 * (dynamic.len() as u64 + 2);
    dynamic.push((DT_STRTAB, strtab));
    dynamic.push((0, 0));
    let mut out = vec![0u8; 64];
    out[..4].copy_from_slice(b"\x7fELF");
    (out[4], out[5]) = (2, 1);
    out[0x20..0x28].copy_from_slice(&phoff.to_le_bytes());
    out[0x36..0x38].copy_from_slice(&56u16.to_le_bytes());
    out[0x38..0x3a].copy_from_slice(&(phnum as u16).to_le_bytes());
    let total = strtab + strings.len() as u64;
    for (kind, offset, size) in [(PT_LOAD, 0, total), (PT_DYNAMIC, dynoff, 16 * dynamic.len() as u64)] {
        let mut header = vec![0u8; 56];
        header[..4].copy_from_slice(&(kind as u32).to_le_bytes());
        header[8..16].copy_from_slice(&offset.to_le_bytes());
        header[16..24].copy_from_slice(&offset.to_le_bytes());
        header[32..40].copy_from_slice(&size.to_le_bytes());
        out.extend(header);
    }
    for (tag, value) in dynamic {
        out.extend(tag.to_le_bytes());
        out.extend(value.to_le_bytes());
    }
    out.extend(strings);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A little-endian 64-bit Mach-O file with one load command per `(command, path)`.
    fn macho64(commands: &[(u64, &str)]) -> Vec<u8> {
        let mut out = vec![0u8; 32];
        out[..4].copy_from_slice(&0xfeed_facfu32.to_le_bytes());
        out[16..20].copy_from_slice(&(commands.len() as u32).to_le_bytes());
        for (command, path) in commands {
            let offset = if *command == LC_RPATH { 12 } else { 24 };
            let size = (offset + path.len() + 1).next_multiple_of(8);
            let mut body = vec![0u8; size];
            body[..4].copy_from_slice(&(*command as u32).to_le_bytes());
            body[4..8].copy_from_slice(&(size as u32).to_le_bytes());
            body[8..12].copy_from_slice(&(offset as u32).to_le_bytes());
            body[offset..offset + path.len()].copy_from_slice(path.as_bytes());
            out.extend(body);
        }
        out
    }

    // Expected (bigboi-3): an ELF build names its libraries and search paths, and the policy refuses what the current
    // directory or a path outside the private copy would supply; a project's build may name system libraries only.
    #[test]
    fn elf_dependencies_follow_the_policy() {
        let plain = elf64(&["libc.so.6", "libm.so.6"], None);
        assert_eq!(named(&plain).unwrap(), [Name::Library("libc.so.6".into()), Name::Library("libm.so.6".into())]);
        assert_eq!(check(&plain, true), Ok(()));
        for (runpath, trusted, project) in [
            ("$ORIGIN", true, true),
            ("${ORIGIN}/", true, true),
            ("lib", false, false),
            ("", false, false),
            ("/usr/lib:", false, false),
            ("$ORIGIN/../lib", false, false),
            ("/opt/x/lib", true, false),
        ] {
            let bytes = elf64(&["libc.so.6"], Some(runpath));
            assert_eq!(check(&bytes, false).is_ok(), trusted, "{runpath:?}");
            assert_eq!(check(&bytes, true).is_ok(), project, "{runpath:?}");
        }
        for (needed, trusted, project) in
            [("./libx.so", false, false), ("sub/libx.so", false, false), ("/opt/libx.so", true, false)]
        {
            let bytes = elf64(&[needed], None);
            assert_eq!((check(&bytes, false).is_ok(), check(&bytes, true).is_ok()), (trusted, project), "{needed}");
        }
        let error = check(&elf64(&["libc.so.6"], Some("lib")), true).unwrap_err();
        assert!(error.contains("\"lib\"") && error.contains("current directory"), "{error}");
        // A file that claims to be ELF but is cut short is refused, not passed.
        assert!(check(&plain[..100], false).is_err());
        // Neither ELF nor Mach-O: the platform loader decides.
        assert_eq!(check(b"MZ\x90\x00", true), Ok(()));
    }

    // Expected (bigboi-3): the same policy for Mach-O load commands, also inside a universal file.
    #[test]
    fn macho_dependencies_follow_the_policy() {
        let system = macho64(&[(LC_LOAD_DYLIB, "/usr/lib/libSystem.B.dylib")]);
        assert_eq!(named(&system).unwrap(), [Name::Library("/usr/lib/libSystem.B.dylib".into())]);
        assert_eq!(check(&system, true), Ok(()));
        for (command, path, trusted, project) in [
            (LC_LOAD_DYLIB, "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", true, true),
            (LC_LOAD_DYLIB, "@rpath/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@executable_path/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@loader_path/libx.dylib", true, true),
            (LC_LOAD_DYLIB, "@loader_path/../libx.dylib", false, false),
            (LC_LOAD_WEAK_DYLIB, "lib/libx.dylib", false, false),
            (LC_LOAD_DYLIB, "/opt/homebrew/lib/libx.dylib", true, false),
            (LC_RPATH, "@loader_path", true, true),
            (LC_RPATH, "build", false, false),
            (LC_RPATH, "/Users/me/repo/lib", true, false),
        ] {
            let bytes = macho64(&[(LC_LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"), (command, path)]);
            assert_eq!((check(&bytes, false).is_ok(), check(&bytes, true).is_ok()), (trusted, project), "{path}");
        }
        // A universal file holding one slice.
        let universal = |slice: Vec<u8>| {
            let mut out = vec![0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1];
            out.extend([0u8; 8]);
            out.extend(32u32.to_be_bytes());
            out.extend((slice.len() as u32).to_be_bytes());
            // The alignment, then padding up to the slice at 32.
            out.extend([0u8; 8]);
            out.extend(slice);
            out
        };
        assert_eq!(named(&universal(system.clone())).unwrap(), named(&system).unwrap());
        assert!(check(&universal(macho64(&[(LC_RPATH, "build")])), false).is_err());
        assert!(check(&system[..20], false).is_err());
    }
}
