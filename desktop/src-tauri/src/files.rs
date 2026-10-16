//! Asset file storage in `<data>/files/`, mirroring the iOS `IO.m` file commands.
//!
//! Security: every name coming from JS goes through [`valid_name`], which only admits
//! a single plain file name (no separators, no "..", no Windows device names), so no
//! command can reach outside the files directory.

use std::fs;
use std::path::{Path, PathBuf};

use base64::alphabet;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;

/// Standard alphabet, padding optional, for lenient decoding of JS-produced base64.
const LENIENT_B64: GeneralPurpose = GeneralPurpose::new(
    &alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`, no "..", and not a Windows reserved device name.
pub fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > 201 || name.contains("..") {
        return false;
    }
    if !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return false;
    }
    // Windows: "CON", "nul.txt", "COM1.sjr" etc. address devices, not files.
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    !reserved
}

/// Resolves a validated name inside `dir`, or None if the name is not acceptable.
pub fn resolve(dir: &Path, name: &str) -> Option<PathBuf> {
    valid_name(name).then(|| dir.join(name))
}

/// Decodes base64, tolerating a `data:...;base64,` prefix, whitespace and missing padding.
pub fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let mut s = input.trim();
    if s.starts_with("data:") {
        let comma = s.find(',')?;
        s = &s[comma + 1..];
    }
    let cleaned: String = s.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    LENIENT_B64.decode(cleaned.as_bytes()).ok()
}

pub fn encode_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Writes the file; returns the name on success, "-1" on failure.
pub fn write(dir: &Path, name: &str, b64: &str) -> String {
    let (Some(path), Some(bytes)) = (resolve(dir, name), decode_base64(b64)) else {
        return "-1".into();
    };
    // Write to a temp file then rename, so a crash never leaves a truncated asset.
    let tmp = dir.join(format!("~{name}.tmp"));
    let ok = fs::write(&tmp, &bytes).and_then(|_| fs::rename(&tmp, &path));
    match ok {
        Ok(()) => name.to_string(),
        Err(_) => {
            let _ = fs::remove_file(&tmp);
            "-1".into()
        }
    }
}

pub fn read(dir: &Path, name: &str) -> Option<String> {
    let path = resolve(dir, name)?;
    fs::read(path).ok().map(|b| encode_base64(&b))
}

pub fn remove(dir: &Path, name: &str) -> String {
    match resolve(dir, name).map(fs::remove_file) {
        Some(Ok(())) => format!("File: {name} removed"),
        _ => format!("Couldn't remove {name} file"),
    }
}

/// Names of regular files in `dir` whose name ends with `ext` (iOS `getFilesType`).
pub fn list_with_suffix(dir: &Path, ext: &str) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(ext) && valid_name(n))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_validation() {
        for ok in ["a", "abc.png", "0123456789abcdef0123456789abcdef.svg", "x_y-z.1.sjr", "Thumb.PNG"] {
            assert!(valid_name(ok), "{ok} should be valid");
        }
        let long_ok = "a".repeat(201);
        assert!(valid_name(&long_ok));
        let too_long = "a".repeat(202);
        assert!(!valid_name(&too_long));
        for bad in [
            "", ".hidden", "-x", "_x", "a..b", "..", "../x", "a/b", "a\\b", "C:x", "a b", "a%2e",
            "x\0", "é.png", "CON", "nul.txt", "com1.png", "LPT9", "a:stream",
        ] {
            assert!(!valid_name(bad), "{bad:?} should be rejected");
        }
        // names that merely start with a device word are fine
        assert!(valid_name("console.png"));
        assert!(valid_name("COM10.png"));
    }

    #[test]
    fn base64_prefix_and_whitespace_stripping() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("data:image/png;base64,aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("data:application/octet-stream;base64,aGVs\r\nbG8").unwrap(), b"hello");
        assert_eq!(decode_base64("  aGVs bG8=\n").unwrap(), b"hello");
        assert!(decode_base64("data:image/png;base64").is_none());
        assert!(decode_base64("!!!").is_none());
    }

    #[test]
    fn write_read_remove_roundtrip_and_traversal_rejected() {
        let dir = std::env::temp_dir().join(format!("sjr-files-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(write(&dir, "a.txt", "data:text/plain;base64,aGk="), "a.txt");
        assert_eq!(read(&dir, "a.txt").unwrap(), "aGk=");
        assert_eq!(list_with_suffix(&dir, ".txt"), vec!["a.txt".to_string()]);
        assert_eq!(write(&dir, "../evil.txt", "aGk="), "-1");
        assert!(read(&dir, "..\\a.txt").is_none());
        assert_eq!(remove(&dir, "a.txt"), "File: a.txt removed");
        assert_eq!(remove(&dir, "a.txt"), "Couldn't remove a.txt file");
        assert!(read(&dir, "a.txt").is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
