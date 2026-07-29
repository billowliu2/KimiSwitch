//! Configuration file I/O utilities for KimiSwitch.
//! Reads and writes the global config file and profile files.

use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use chrono::{Duration, Local};

/// Creates a backup of `path` inside a `backups/` subdirectory next to the
/// original file, then removes backup files older than `retention_days`.
pub fn backup_file(path: &Path, retention_days: i64) -> Result<PathBuf> {
    if !path.exists() {
        return Ok(PathBuf::new());
    }

    let parent = path.parent().context("path has no parent directory")?;
    let backups_dir = parent.join("backups");
    std::fs::create_dir_all(&backups_dir)
        .with_context(|| format!("failed to create backups directory {}", backups_dir.display()))?;

    let file_name = path.file_name().context("path has no file name")?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%.3f").to_string();
    let backup_name = format!("{}.bak.{}", file_name.to_string_lossy(), timestamp);
    let mut backup_path = backups_dir.join(&backup_name);

    if backup_path.exists() {
        for n in 1..1000 {
            let candidate = backups_dir.join(format!(
                "{}.bak.{}.{:03}",
                file_name.to_string_lossy(),
                timestamp,
                n
            ));
            if !candidate.exists() {
                backup_path = candidate;
                break;
            }
        }
    }

    std::fs::copy(path, &backup_path).with_context(|| {
        format!(
            "failed to back up {} to {}",
            path.display(),
            backup_path.display()
        )
    })?;

    cleanup_old_backups(&backups_dir, retention_days)?;

    Ok(backup_path)
}

/// Removes backup files in `dir` older than `retention_days`, based on file
/// modification time. Only files whose names contain `.bak.` are deleted.
fn cleanup_old_backups(dir: &Path, retention_days: i64) -> Result<()> {
    let cutoff = Local::now() - Duration::days(retention_days);
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("failed to read backups directory {}", dir.display()))?;

    for entry in entries {
        let entry = entry.context("failed to read directory entry")?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.contains(".bak.") {
            continue;
        }
        let metadata = entry
            .metadata()
            .with_context(|| format!("failed to read metadata for {}", path.display()))?;
        let modified = metadata
            .modified()
            .with_context(|| format!("failed to read modified time for {}", path.display()))?;
        let modified: chrono::DateTime<Local> = modified.into();
        if modified < cutoff {
            std::fs::remove_file(&path)
                .with_context(|| format!("failed to remove old backup {}", path.display()))?;
        }
    }

    Ok(())
}
