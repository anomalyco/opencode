// FORK: 本地资源自定义 protocol — 给 .md 内 <img>/<video>/<audio> + HTML 预览 iframe 提供
// 路径校验(canonicalize + starts_with sdk_root)的本地文件读取通道。
// 设计 URL:  localasset://localhost/<base64url-root>/<rel-path>
//   - base64url-root:URL-safe base64(无 padding)编码的 sdk 根目录绝对路径
//   - rel-path:相对于 root 的文件路径(forward slash,标准 URL 风格)
// 单 scheme 服务三类资源:
//   1. .md image renderer 改写 <img src> 为本 protocol(直接 asset 请求)
//   2. .md 音视频同 #1
//   3. HTML 预览 iframe 主页 + 内部相对资源(浏览器自动按 iframe URL 解析相对路径)
// 安全:Rust 端 canonicalize 解 .. + 符号链接 → starts_with(root_canonical) 越权防护;
//      绝对路径 / file:// / 跨盘符引用全部失败(starts_with 不通过)。
// 2026-05-05

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use tauri::http::{Request, Response};
use tauri::{Runtime, UriSchemeContext};

pub const SCHEME: &str = "localasset";

// 单文件 500MB 硬上限(对齐 read_binary_file_base64);HTML 预览侧另设 10MB 渲染阈值(前端)
const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;

// FORK: html-viewer-ux-polish 2026-05-14 — HTML 响应注入 iframe 事件桥接 JS。
// iframe 内事件不冒泡到 parent + WebView2 接管 contextmenu 显原生菜单(返回/刷新/打印),与 .md
// 文件查看器自定义右键菜单 UX 不一致。注入捕获相位 listener:
//   - contextmenu: preventDefault native 菜单 + postMessage(x, y, 选区文本)→ 父弹 mdMenu
//   - mousedown:   postMessage 通知父 → 父收到时若 mdMenu 开着就关掉(对齐 light DOM "点别处关菜单"行为)
// 脚本极小、命名空间 `__deskfox`,与用户页脚本冲突风险低;non-UTF-8 / 无 head 锚点时有兜底,不阻断渲染。
const CONTEXTMENU_BRIDGE_SCRIPT: &str = "<script>(function(){document.addEventListener('contextmenu',function(e){e.preventDefault();var s=window.getSelection();var t=s?s.toString():'';try{window.parent.postMessage({__deskfox:true,type:'contextmenu',x:e.clientX,y:e.clientY,text:t},'*');}catch(err){}},true);document.addEventListener('mousedown',function(e){try{window.parent.postMessage({__deskfox:true,type:'mousedown'},'*');}catch(err){}},true);})();</script>";

fn inject_contextmenu_bridge(html_bytes: &[u8]) -> Vec<u8> {
    // Best-effort UTF-8 decode;非 UTF-8 文件(罕见,HTML5 推 UTF-8 + 我们 Content-Type 也强 charset=utf-8)
    // 原样返回,user 右键回退到 native 菜单(可接受降级)
    let html = match std::str::from_utf8(html_bytes) {
        Ok(s) => s,
        Err(_) => return html_bytes.to_vec(),
    };

    // 锚点优先级:</head> > <body > <BODY (case-insensitive 简化版仅查常见大小写) > 前置
    let pos_opt = html
        .find("</head>")
        .or_else(|| html.find("</HEAD>"))
        .or_else(|| html.find("<body").map(|p| p)) // 在 <body 标签前注,确保 DOM ready 前注册 listener
        .or_else(|| html.find("<BODY"));

    let mut out = String::with_capacity(html.len() + CONTEXTMENU_BRIDGE_SCRIPT.len());
    match pos_opt {
        Some(pos) => {
            out.push_str(&html[..pos]);
            out.push_str(CONTEXTMENU_BRIDGE_SCRIPT);
            out.push_str(&html[pos..]);
        }
        None => {
            // 兜底:html 不含标准 head/body 锚点(片段 / 异常文件),前置注入
            out.push_str(CONTEXTMENU_BRIDGE_SCRIPT);
            out.push_str(html);
        }
    }
    out.into_bytes()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'%' && i + 2 < bytes.len() {
            let h = (bytes[i + 1] as char).to_digit(16);
            let l = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (h, l) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s).ok()
}

fn mime_for(p: &Path) -> &'static str {
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        Some("apng") => "image/apng",
        Some("tiff") | Some("tif") => "image/tiff",
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("ogg") | Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("opus") => "audio/opus",
        Some("oga") => "audio/ogg",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn err_response(status: u16, msg: &str) -> Response<Cow<'static, [u8]>> {
    let body: Cow<'static, [u8]> = Cow::Owned(msg.as_bytes().to_vec());
    match Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
    {
        Ok(r) => r,
        Err(_) => {
            // 极端兜底:builder 失败时返回空 body(理论上不会发生)
            let empty: Cow<'static, [u8]> = Cow::Borrowed(&[]);
            Response::new(empty)
        }
    }
}

/// 处理 localasset:// 请求。
/// URL path 结构:`/<base64url-root>/<rel-path>` — 第一个 `/` 后第一段是 base64url 的 root,
/// 其余是 root 内的相对路径(forward slash)。
/// `range_header`:可选 HTTP Range header 值(形如 "bytes=start-end"),用于视频 seek。
fn handle_inner(uri_path: &str, range_header: Option<&str>) -> Response<Cow<'static, [u8]>> {
    let trimmed = uri_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return err_response(400, "empty path");
    }
    let mut parts = trimmed.splitn(2, '/');
    let root_b64 = parts.next().unwrap_or("");
    let rel_path_encoded = parts.next().unwrap_or("");

    if root_b64.is_empty() {
        return err_response(400, "missing root");
    }
    if rel_path_encoded.is_empty() {
        return err_response(400, "missing path");
    }

    // root 解码
    let root_bytes = match b64url_decode(root_b64) {
        Some(b) => b,
        None => return err_response(400, "root not base64url"),
    };
    let root = match String::from_utf8(root_bytes) {
        Ok(s) => s,
        Err(_) => return err_response(400, "root not utf8"),
    };

    // rel-path 解码(percent-decoded;支持中文文件名等)
    let rel = percent_decode(rel_path_encoded);

    let root_path = PathBuf::from(&root);
    let candidate: PathBuf = root_path.join(&rel);

    // canonicalize(解 .. / 符号链接 / 规范化大小写等;同时验证文件存在)
    let root_canon = match root_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return err_response(403, "invalid root"),
    };
    let abs_canon = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => return err_response(404, "not found"),
    };

    // 越权防护:canonical 路径必须仍在 root 下
    if !abs_canon.starts_with(&root_canon) {
        return err_response(403, "out of scope");
    }

    // 必须是文件,不是目录 / 设备节点等
    let metadata = match std::fs::metadata(&abs_canon) {
        Ok(m) => m,
        Err(_) => return err_response(404, "stat failed"),
    };
    if !metadata.is_file() {
        return err_response(403, "not a file");
    }
    if metadata.len() > MAX_FILE_SIZE {
        return err_response(413, "too large");
    }

    let mime = mime_for(&abs_canon);
    let total = metadata.len();

    // FORK: HTTP Range 支持 — 视频 seek / 大文件分片必须 2026-05-05
    if let Some(range_str) = range_header {
        if let Some(range_val) = range_str.strip_prefix("bytes=") {
            let mut parts = range_val.splitn(2, '-');
            let start_str = parts.next().unwrap_or("");
            let end_str = parts.next().unwrap_or("");
            if let Ok(start) = start_str.parse::<u64>() {
                let end = if end_str.is_empty() {
                    total.saturating_sub(1)
                } else {
                    end_str.parse::<u64>().unwrap_or(total.saturating_sub(1))
                };
                let end = end.min(total.saturating_sub(1));
                if start <= end && start < total {
                    use std::io::{Read, Seek, SeekFrom};
                    let mut file = match std::fs::File::open(&abs_canon) {
                        Ok(f) => f,
                        Err(_) => return err_response(500, "open failed"),
                    };
                    if file.seek(SeekFrom::Start(start)).is_err() {
                        return err_response(500, "seek failed");
                    }
                    let len = (end - start + 1) as usize;
                    let mut buf = vec![0u8; len];
                    if file.read_exact(&mut buf).is_err() {
                        return err_response(500, "read range failed");
                    }
                    let body: Cow<'static, [u8]> = Cow::Owned(buf);
                    return match Response::builder()
                        .status(206)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Accept-Ranges", "bytes")
                        .header("Content-Range", format!("bytes {}-{}/{}", start, end, total))
                        .header("Cache-Control", "no-cache")
                        .body(body)
                    {
                        Ok(r) => r,
                        Err(_) => err_response(500, "build 206 response failed"),
                    };
                }
            }
        }
        // 解析失败的 Range header 走 200 全文(浏览器自己再发 Range)
    }

    let raw_bytes = match std::fs::read(&abs_canon) {
        Ok(b) => b,
        Err(_) => return err_response(500, "read failed"),
    };

    // FORK: html-viewer-ux-polish 2026-05-14 — text/html 响应注入 contextmenu 桥接 JS
    let bytes: Cow<'static, [u8]> = if mime.starts_with("text/html") {
        Cow::Owned(inject_contextmenu_bridge(&raw_bytes))
    } else {
        Cow::Owned(raw_bytes)
    };

    match Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "*")
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-cache")
        .body(bytes)
    {
        Ok(r) => r,
        Err(_) => err_response(500, "build response failed"),
    }
}

/// Tauri Builder.register_uri_scheme_protocol 入口
pub fn handler<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().to_string();
    let range_header = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    handle_inner(&path, range_header.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("foo%20bar"), "foo bar");
        assert_eq!(percent_decode("a%2Fb"), "a/b");
        assert_eq!(percent_decode("x"), "x");
    }

    #[test]
    fn percent_decode_chinese() {
        // 中文 "图.png" UTF-8 percent-encoded
        assert_eq!(percent_decode("%E5%9B%BE.png"), "图.png");
    }

    #[test]
    fn b64url_decode_roundtrip() {
        use base64::Engine;
        let original = "D:/project/notes";
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(original);
        let decoded = b64url_decode(&encoded).unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), original);
    }

    #[test]
    fn mime_image_types() {
        assert_eq!(mime_for(Path::new("a.png")), "image/png");
        assert_eq!(mime_for(Path::new("a.PNG")), "image/png");
        assert_eq!(mime_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a.unknown")), "application/octet-stream");
    }

    #[test]
    fn mime_media_types() {
        assert_eq!(mime_for(Path::new("a.mp4")), "video/mp4");
        assert_eq!(mime_for(Path::new("a.mp3")), "audio/mpeg");
        assert_eq!(mime_for(Path::new("a.html")), "text/html; charset=utf-8");
    }

    #[test]
    fn handle_empty_path_400() {
        let r = handle_inner("", None);
        assert_eq!(r.status(), 400);
    }

    #[test]
    fn handle_missing_rel_path_400() {
        // 只有 root,没有 rel-path
        let r = handle_inner("/aGVsbG8=", None);
        // base64url 没 padding 应该是 "aGVsbG8";这里测格式即可
        assert_eq!(r.status(), 400);
    }

    #[test]
    fn handle_invalid_root_400() {
        let r = handle_inner("/!!!notbase64!!!/file.png", None);
        assert_eq!(r.status(), 400);
    }

    // FORK: html-viewer-ux-polish 2026-05-14 — contextmenu 桥接注入测试
    #[test]
    fn inject_before_close_head() {
        let html = b"<html><head><title>x</title></head><body>hi</body></html>";
        let out = inject_contextmenu_bridge(html);
        let s = String::from_utf8(out).unwrap();
        assert!(s.contains(CONTEXTMENU_BRIDGE_SCRIPT));
        // script 必须在 </head> 之前
        let script_pos = s.find(CONTEXTMENU_BRIDGE_SCRIPT).unwrap();
        let head_close_pos = s.find("</head>").unwrap();
        assert!(script_pos < head_close_pos);
        // 原内容完整保留
        assert!(s.contains("<title>x</title>"));
        assert!(s.contains("<body>hi</body>"));
    }

    #[test]
    fn inject_before_body_when_no_head_close() {
        // 无 </head>(自闭合或异常),回退到 <body 前
        let html = b"<html><body>hi</body></html>";
        let out = inject_contextmenu_bridge(html);
        let s = String::from_utf8(out).unwrap();
        let script_pos = s.find(CONTEXTMENU_BRIDGE_SCRIPT).unwrap();
        let body_pos = s.find("<body").unwrap();
        assert!(script_pos < body_pos);
    }

    #[test]
    fn inject_prepend_fallback_when_no_anchors() {
        // 既无 head 也无 body,前置兜底
        let html = b"<p>just a fragment</p>";
        let out = inject_contextmenu_bridge(html);
        let s = String::from_utf8(out).unwrap();
        assert!(s.starts_with(CONTEXTMENU_BRIDGE_SCRIPT));
        assert!(s.contains("<p>just a fragment</p>"));
    }

    #[test]
    fn inject_passthrough_non_utf8() {
        // 非 UTF-8 字节(罕见,user 用 GBK 等)— 原样返回,不注入,user 右键回退原生菜单
        let html = vec![0xFF, 0xFE, 0xFD, 0xFC];
        let out = inject_contextmenu_bridge(&html);
        assert_eq!(out, html);
    }

    #[test]
    fn inject_uppercase_anchors() {
        let html = b"<HTML><HEAD></HEAD><BODY></BODY></HTML>";
        let out = inject_contextmenu_bridge(html);
        let s = String::from_utf8(out).unwrap();
        assert!(s.contains(CONTEXTMENU_BRIDGE_SCRIPT));
        let script_pos = s.find(CONTEXTMENU_BRIDGE_SCRIPT).unwrap();
        let head_close_pos = s.find("</HEAD>").unwrap();
        assert!(script_pos < head_close_pos);
    }
}
