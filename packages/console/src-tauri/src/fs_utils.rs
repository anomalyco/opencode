use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::api::dir::read_dir;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub children: Option<Vec<FileItem>>,
}

impl FileItem {
    pub fn new(path: PathBuf, include_children: bool) -> Result<Self, String> {
        let metadata = path.metadata().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let is_dir = metadata.is_dir();
        let size = if is_dir { None } else { Some(metadata.len()) };

        let children = if is_dir && include_children {
            match read_directory_shallow(path.to_string_lossy().to_string()) {
                Ok(items) => Some(items),
                Err(_) => Some(vec![]), // Return empty children on error
            }
        } else {
            None
        };

        Ok(FileItem {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
            children,
        })
    }
}

/// Check if a file/directory should be ignored based on common patterns
fn should_ignore(name: &str, is_dir: bool) -> bool {
    // Common ignore patterns
    let ignore_patterns = [
        ".git", ".DS_Store", "node_modules", ".next", "dist", "build",
        "coverage", ".nyc_output", "*.log", "npm-debug.log*", "yarn-debug.log*",
        "yarn-error.log*", ".env", ".env.local", ".env.development.local",
        ".env.test.local", ".env.production.local", "target", ".cargo",
    ];

    // Hidden files/directories starting with .
    if name.starts_with('.') && !matches!(name, ".gitignore" | ".env.example") {
        return true;
    }

    // Check against ignore patterns
    for pattern in &ignore_patterns {
        if pattern.ends_with('*') {
            let prefix = &pattern[..pattern.len() - 1];
            if name.starts_with(prefix) {
                return true;
            }
        } else if name == *pattern {
            return true;
        }
    }

    // Ignore large directories that are typically not edited
    if is_dir && matches!(name, "node_modules" | "target" | ".git" | "dist" | "build") {
        return true;
    }

    false
}

/// Read directory contents without recursion
fn read_directory_shallow(path: String) -> Result<Vec<FileItem>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    if !dir_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let entries = read_dir(&dir_path, false).map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    for entry in entries {
        let path_buf = PathBuf::from(&entry.path);
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip ignored files/directories
        if should_ignore(&name, entry.is_dir) {
            continue;
        }

        // Create FileItem without recursive children
        if let Ok(item) = FileItem::new(path_buf, false) {
            items.push(item);
        }
    }

    // Sort: directories first, then files, both alphabetically
    items.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(items)
}

#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<FileItem>, String> {
    read_directory_shallow(path)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if !file_path.is_file() {
        return Err("Path is not a file".to_string());
    }

    // Check file size to prevent loading very large files
    if let Ok(metadata) = file_path.metadata() {
        const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB limit
        if metadata.len() > MAX_FILE_SIZE {
            return Err("File is too large to edit (>10MB)".to_string());
        }
    }

    std::fs::read_to_string(file_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            "File contains invalid UTF-8 or is a binary file".to_string()
        } else {
            format!("Failed to read file: {}", e)
        }
    })
}

#[tauri::command]
pub async fn write_file_content(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    // Create parent directory if it doesn't exist
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

    std::fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileItem, String> {
    let path_buf = PathBuf::from(&path);
    FileItem::new(path_buf, false)
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    if file_path.exists() {
        return Err("File already exists".to_string());
    }

    // Create parent directory if needed
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

    std::fs::write(file_path, "").map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if file_path.is_dir() {
        std::fs::remove_dir_all(file_path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        std::fs::remove_file(file_path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}