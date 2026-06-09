use crate::modules::workspace::{WorkspaceEnv, resolve_path};
use std::path::Path;

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(from: String, to: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Copies one or more files/directories into an existing destination directory.
/// Existing top-level targets are refused to avoid clobbering user data.
#[tauri::command]
pub fn fs_copy_into(
    sources: Vec<String>,
    destination_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Err("no sources provided".to_string());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let destination = resolve_path(&destination_dir, &workspace);
    if !destination.is_dir() {
        return Err(format!(
            "destination is not a directory: {}",
            destination.display()
        ));
    }

    let mut jobs = Vec::with_capacity(sources.len());
    for source in sources {
        let source_path = Path::new(&source).to_path_buf();
        let name = source_path
            .file_name()
            .ok_or_else(|| format!("source must include a file name: {}", source_path.display()))?;
        let target = destination.join(name);
        if !source_path.exists() {
            return Err(format!("not found: {}", source_path.display()));
        }
        let meta = std::fs::symlink_metadata(&source_path).map_err(|e| {
            log::debug!("fs_copy_into stat({}) failed: {e}", source_path.display());
            e.to_string()
        })?;
        if meta.is_dir() {
            let source_canonical = std::fs::canonicalize(&source_path).map_err(|e| {
                log::debug!(
                    "fs_copy_into canonicalize({}) failed: {e}",
                    source_path.display()
                );
                e.to_string()
            })?;
            let destination_canonical = std::fs::canonicalize(&destination).map_err(|e| {
                log::debug!(
                    "fs_copy_into canonicalize({}) failed: {e}",
                    destination.display()
                );
                e.to_string()
            })?;
            let target_canonical = destination_canonical.join(name);
            if target_canonical.starts_with(&source_canonical) {
                return Err("cannot copy a directory into itself".to_string());
            }
        }
        if target.exists() {
            return Err(format!("already exists: {}", target.display()));
        }
        jobs.push((source_path, target));
    }

    for (source, target) in jobs {
        copy_path(&source, &target)?;
    }
    Ok(())
}

/// Moves one or more files/directories into an existing destination directory.
/// Existing targets are refused; directories cannot be moved into themselves.
#[tauri::command]
pub fn fs_move_into(
    sources: Vec<String>,
    destination_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Err("no sources provided".to_string());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let destination = resolve_path(&destination_dir, &workspace);
    if !destination.is_dir() {
        return Err(format!(
            "destination is not a directory: {}",
            destination.display()
        ));
    }

    let destination_canonical = std::fs::canonicalize(&destination).map_err(|e| {
        log::debug!(
            "fs_move_into canonicalize({}) failed: {e}",
            destination.display()
        );
        e.to_string()
    })?;
    let mut jobs = Vec::with_capacity(sources.len());
    for source in sources {
        let source_path = Path::new(&source).to_path_buf();
        let name = source_path
            .file_name()
            .ok_or_else(|| format!("source must include a file name: {}", source_path.display()))?;
        let target = destination.join(name);
        if !source_path.exists() {
            return Err(format!("not found: {}", source_path.display()));
        }
        if target.exists() {
            return Err(format!("already exists: {}", target.display()));
        }
        let meta = std::fs::symlink_metadata(&source_path).map_err(|e| {
            log::debug!("fs_move_into stat({}) failed: {e}", source_path.display());
            e.to_string()
        })?;
        if meta.is_dir() {
            let source_canonical = std::fs::canonicalize(&source_path).map_err(|e| {
                log::debug!(
                    "fs_move_into canonicalize({}) failed: {e}",
                    source_path.display()
                );
                e.to_string()
            })?;
            if destination_canonical.starts_with(&source_canonical) {
                return Err("cannot move a directory into itself".to_string());
            }
        }
        jobs.push((source_path, target));
    }

    for (source, target) in jobs {
        std::fs::rename(&source, &target).map_err(|e| {
            log::debug!(
                "fs_move_into({} -> {}) failed: {e}",
                source.display(),
                target.display()
            );
            e.to_string()
        })?;
    }
    Ok(())
}

fn copy_path(source: &Path, target: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(source).map_err(|e| {
        log::debug!("fs_copy_into stat({}) failed: {e}", source.display());
        e.to_string()
    })?;
    if meta.is_dir() {
        std::fs::create_dir(target).map_err(|e| {
            log::debug!("fs_copy_into mkdir({}) failed: {e}", target.display());
            e.to_string()
        })?;
        for entry in std::fs::read_dir(source).map_err(|e| {
            log::debug!("fs_copy_into read_dir({}) failed: {e}", source.display());
            e.to_string()
        })? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_path(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }

    std::fs::copy(source, target).map(|_| ()).map_err(|e| {
        log::debug!(
            "fs_copy_into copy({} -> {}) failed: {e}",
            source.display(),
            target.display()
        );
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        fs_create_file(s(f.clone()), None).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file(s(f.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        fs_create_dir(s(nested.clone()), None).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir(s(nested), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename(s(from.clone()), s(to.clone()), None).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err = fs_rename(s(from), s(dir.path().join("c.txt")), None).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err = fs_rename(s(to.clone()), s(occupied.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete(s(f.clone()), None).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete(s(sub.clone()), None).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete(s(dir.path().join("missing")), None).unwrap_err();
        assert!(!err.is_empty());
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        fs_delete(s(link.clone()), None).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn copy_into_copies_files_and_directories_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let source_file = dir.path().join("a.txt");
        std::fs::write(&source_file, b"a").unwrap();
        let source_dir = dir.path().join("folder");
        std::fs::create_dir_all(source_dir.join("nested")).unwrap();
        std::fs::write(source_dir.join("nested/b.txt"), b"b").unwrap();
        let destination = dir.path().join("dest");
        std::fs::create_dir(&destination).unwrap();

        fs_copy_into(
            vec![s(source_file), s(source_dir)],
            s(destination.clone()),
            None,
        )
        .expect("copy");

        assert_eq!(std::fs::read(destination.join("a.txt")).unwrap(), b"a");
        assert_eq!(
            std::fs::read(destination.join("folder/nested/b.txt")).unwrap(),
            b"b"
        );
    }

    #[test]
    fn copy_into_refuses_to_overwrite_existing_top_level_target() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.txt");
        std::fs::write(&source, b"new").unwrap();
        let destination = dir.path().join("dest");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("a.txt"), b"old").unwrap();

        let err = fs_copy_into(vec![s(source)], s(destination.clone()), None).unwrap_err();

        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(destination.join("a.txt")).unwrap(), b"old");
    }

    #[test]
    fn copy_into_refuses_to_copy_directory_into_itself() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("folder");
        let nested_destination = source.join("nested");
        std::fs::create_dir_all(&nested_destination).unwrap();

        let err = fs_copy_into(vec![s(source)], s(nested_destination), None).unwrap_err();

        assert!(
            err.contains("cannot copy a directory into itself"),
            "got: {err}"
        );
    }

    #[test]
    fn move_into_moves_file_and_refuses_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.txt");
        std::fs::write(&source, b"a").unwrap();
        let destination = dir.path().join("dest");
        std::fs::create_dir(&destination).unwrap();

        fs_move_into(vec![s(source.clone())], s(destination.clone()), None).expect("move");

        assert!(!source.exists());
        assert_eq!(std::fs::read(destination.join("a.txt")).unwrap(), b"a");

        let another = dir.path().join("a.txt");
        std::fs::write(&another, b"new").unwrap();
        let err = fs_move_into(vec![s(another)], s(destination.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(destination.join("a.txt")).unwrap(), b"a");
    }

    #[test]
    fn move_into_refuses_to_move_directory_into_itself() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("folder");
        let nested_destination = source.join("nested");
        std::fs::create_dir_all(&nested_destination).unwrap();

        let err = fs_move_into(vec![s(source)], s(nested_destination), None).unwrap_err();

        assert!(
            err.contains("cannot move a directory into itself"),
            "got: {err}"
        );
    }
}
