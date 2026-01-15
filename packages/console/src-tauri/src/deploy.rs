use std::path::Path;
use std::process::{Command, Stdio};
use std::fs;
use std::io::{Read, Write};
use flate2::{Compression, write::GzEncoder};
use tar::{Builder, Header};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildResult {
    pub dist_path: String,
    pub success: bool,
    pub build_log: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleResult {
    pub bundle_path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OSSUploadCredential {
    pub access_key_id: String,
    pub access_key_secret: String,
    pub security_token: String,
    pub bucket: String,
    pub region: String,
    pub oss_key: String,
    pub public_url: String,
}

#[tauri::command]
pub async fn deploy_build_workspace(
    workspace_id: String,
    root_path: String,
) -> Result<BuildResult, String> {
    let path = Path::new(&root_path);

    // Check if package.json exists
    let package_json_path = path.join("package.json");
    if !package_json_path.exists() {
        return Err("package.json not found in workspace".to_string());
    }

    // Check if node_modules exists
    let node_modules_path = path.join("node_modules");
    if !node_modules_path.exists() {
        return Err("node_modules not found. Please run 'pnpm install' first".to_string());
    }

    // Run pnpm build
    let output = Command::new("pnpm")
        .args(&["run", "build"])
        .current_dir(&root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute pnpm build: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let build_log = format!("{}\n{}", stdout, stderr);

    if !output.status.success() {
        return Ok(BuildResult {
            dist_path: String::new(),
            success: false,
            build_log: Some(build_log.clone()),
            error: Some(format!("Build failed with exit code: {}",
                output.status.code().unwrap_or(-1)
            )),
        });
    }

    // Check if dist directory was created
    let dist_path = path.join("dist");
    if !dist_path.exists() {
        return Ok(BuildResult {
            dist_path: String::new(),
            success: false,
            build_log: Some(build_log),
            error: Some("Build succeeded but dist/ directory was not created".to_string()),
        });
    }

    Ok(BuildResult {
        dist_path: dist_path.to_string_lossy().to_string(),
        success: true,
        build_log: Some(build_log),
        error: None,
    })
}

#[tauri::command]
pub async fn bundle_dist(
    dist_path: String,
    output_name: String,
) -> Result<BundleResult, String> {
    let dist_dir = Path::new(&dist_path);
    if !dist_dir.exists() {
        return Err("Dist directory does not exist".to_string());
    }

    if !dist_dir.is_dir() {
        return Err("Dist path is not a directory".to_string());
    }

    // Create output path in temp directory
    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join(&output_name);

    // Create tar.gz file
    let tar_gz_file = fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create bundle file: {}", e))?;

    let enc = GzEncoder::new(tar_gz_file, Compression::default());
    let mut tar = Builder::new(enc);

    // Add all files in dist directory to tar
    tar.append_dir_all(".", dist_dir)
        .map_err(|e| format!("Failed to create tar archive: {}", e))?;

    // Finalize the archive
    tar.finish()
        .map_err(|e| format!("Failed to finalize tar archive: {}", e))?;

    Ok(BundleResult {
        bundle_path: output_path.to_string_lossy().to_string(),
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn upload_to_oss(
    file_path: String,
    credential: OSSUploadCredential,
) -> Result<String, String> {
    // Read the file to upload
    let mut file = fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut file_content = Vec::new();
    file.read_to_end(&mut file_content)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Create OSS client
    let client = aliyun_oss_client::Client::new(
        credential.access_key_id,
        credential.access_key_secret,
        credential.bucket,
        credential.region,
    );

    // Set STS token if provided
    let client = if !credential.security_token.is_empty() {
        client.with_sts_token(credential.security_token)
    } else {
        client
    };

    // Upload file to OSS
    client
        .put_object(&credential.oss_key, file_content)
        .await
        .map_err(|e| format!("OSS upload failed: {}", e))?;

    Ok(credential.public_url)
}

#[tauri::command]
pub async fn get_bundle_size(bundle_path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&bundle_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    Ok(metadata.len())
}

#[tauri::command]
pub async fn cleanup_bundle(bundle_path: String) -> Result<(), String> {
    fs::remove_file(&bundle_path)
        .map_err(|e| format!("Failed to cleanup bundle file: {}", e))?;

    Ok(())
}