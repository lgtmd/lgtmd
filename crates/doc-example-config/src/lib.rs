//! A small configuration API used to exercise executable user documentation.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The application configuration. Values are validated before saving.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub port: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self { port: 8080 }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if (1..=65535).contains(&self.port) {
            Ok(())
        } else {
            Err(ConfigError::InvalidPort(self.port))
        }
    }

    pub fn from_json(source: &str) -> Result<Self, ConfigError> {
        let config: Self = serde_json::from_str(source).map_err(ConfigError::Json)?;
        config.validate()?;
        Ok(config)
    }

    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let source = fs::read_to_string(path).map_err(|error| ConfigError::Io {
            operation: "read",
            path: path.to_owned(),
            error,
        })?;
        Self::from_json(&source)
    }

    /// Validate first, then replace the output with a complete adjacent file.
    /// A rejected configuration never creates or changes the output file.
    pub fn save(&self, output: &Path) -> Result<(), ConfigError> {
        self.validate()?;
        let mut bytes = serde_json::to_vec_pretty(self).map_err(ConfigError::Json)?;
        bytes.push(b'\n');
        write_atomic(output, &bytes).map_err(|error| ConfigError::Io {
            operation: "save",
            path: output.to_owned(),
            error,
        })
    }
}

#[derive(Debug)]
pub enum ConfigError {
    InvalidPort(u32),
    Json(serde_json::Error),
    Io {
        operation: &'static str,
        path: PathBuf,
        error: io::Error,
    },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort(port) => write!(
                formatter,
                "port must be between 1 and 65535 (received {port})."
            ),
            Self::Json(error) => write!(formatter, "invalid configuration JSON: {error}"),
            Self::Io {
                operation,
                path,
                error,
            } => write!(
                formatter,
                "could not {operation} {}: {error}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Io { error, .. } => Some(error),
            Self::InvalidPort(_) => None,
        }
    }
}

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

struct PendingFile(PathBuf);

impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn write_atomic(output: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // Adjacent temporary files keep the final rename on one filesystem. Exclusive
    // creation preserves unrelated files even if a previous process left one behind.
    for _ in 0..128 {
        let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
        let pending = parent.join(format!(
            ".config-demo-{}-{sequence}.tmp",
            std::process::id()
        ));
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let pending = PendingFile(pending);
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&pending.0, output)?;
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate an adjacent temporary file",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_documented_port_bounds() {
        for port in [1, 8080, 65535] {
            assert!(Config { port }.validate().is_ok());
        }
        for port in [0, 65536, u32::MAX] {
            assert!(matches!(
                Config { port }.validate(),
                Err(ConfigError::InvalidPort(actual)) if actual == port
            ));
        }
    }

    #[test]
    fn parsing_rejects_unknown_fields_and_non_integer_ports() {
        assert!(Config::from_json(r#"{"port":8080,"prot":9090}"#).is_err());
        assert!(Config::from_json(r#"{"port":80.5}"#).is_err());
        assert!(Config::from_json(r#"{"port":-1}"#).is_err());
        assert!(Config::from_json("{}").is_err());
    }

    #[test]
    fn rejected_save_preserves_original_bytes_and_leaves_no_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("settings.json");
        let original = b"{\"port\":8080}\n";
        fs::write(&output, original).unwrap();

        assert!(Config { port: 0 }.save(&output).is_err());
        assert_eq!(fs::read(&output).unwrap(), original);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn valid_save_replaces_the_complete_document() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("settings.json");
        fs::write(&output, b"previous output").unwrap();

        Config { port: 9090 }.save(&output).unwrap();
        assert_eq!(Config::load(&output).unwrap(), Config { port: 9090 });
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_replacement_cleans_up_its_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("settings.json");
        fs::create_dir(&output).unwrap();
        fs::write(output.join("keep.txt"), "existing data").unwrap();

        assert!(Config { port: 9090 }.save(&output).is_err());
        assert_eq!(
            fs::read_to_string(output.join("keep.txt")).unwrap(),
            "existing data"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
