# vi Glossary

## Sources

- PR #55925: https://github.com/anomalyco/opencode/pull/55925 (terminology fixes in this file)
- PR #55922: https://github.com/anomalyco/opencode/pull/55922 (Vietnamese Console locale)
- Existing Vietnamese copy on dev: `packages/app/src/runtime/i18n/vi.ts`, `packages/ui/src/i18n/vi.ts`, `README.vi.md`

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `Zen`, `Go`, `Go Plus`, `Black`, `Enterprise`, `Models.dev`
- `TUI`, `LSP`, `LLM`, `API`, `CLI`, `MCP`, `SSO`, `SDK`, `IDE`, `SSE`, `ZDR`, `MIT License`
- `terminal`, `desktop`, `web`, `shell`
- Plan names such as `Black 20`, `Black 100`, `Black 200`
- Commands, flags, file paths, and code literals (keep exactly as written)

## Preferred Terms

| English                    | Preferred             | Notes                                                    |
| -------------------------- | --------------------- | -------------------------------------------------------- |
| coding agent (the product) | `trợ lý lập trình AI` | Matches the tagline already used in `README.vi.md`       |
| agent (an instance)        | `tác nhân`            | Used in app UI copy; keep consistent with `packages/app` |
| session                    | `phiên`               | Matches `packages/app/src/runtime/i18n/vi.ts`            |
| file                       | `tệp`                 | `tệp đính kèm` for attachment                            |
| provider                   | `nhà cung cấp`        |                                                          |
| model                      | `mô hình`             |                                                          |
| docs                       | `tài liệu`            |                                                          |
| download                   | `tải về`              |                                                          |
| sign in / log in           | `đăng nhập`           |                                                          |
| sign up                    | `đăng ký`             |                                                          |
| subscribe                  | `đăng ký`             | Prefer `đăng ký gói ...` for plans                       |
| cancel                     | `hủy`                 |                                                          |
| privacy                    | `quyền riêng tư`      |                                                          |
| settings                   | `cài đặt`             |                                                          |
| usage limits               | `hạn mức sử dụng`     |                                                          |
| top up (balance/credit)    | `nạp thêm`            | `nạp thêm số dư` / `nạp thêm tín dụng`                   |
| refund                     | `hoàn tiền`           |                                                          |
| waitlist                   | `danh sách chờ`       |                                                          |
| server                     | `máy chủ`             |                                                          |
| workspace                  | `không gian làm việc` |                                                          |
| brand                      | `thương hiệu`         |                                                          |
| changelog                  | `nhật ký thay đổi`    |                                                          |
| local models               | `mô hình chạy cục bộ` |                                                          |
| prompt                     | `lời nhắc`            |                                                          |
| token                      | `token`               | Keep in English; do not use `mã thông báo`               |
| skill                      | `kỹ năng`             | Matches the app UI label for the skills tab              |
| plugin                     | `tiện ích mở rộng`    | Matches the app UI label for extensions                  |
| command                    | `lệnh`                |                                                          |
| theme                      | `giao diện`           |                                                          |
| formatter                  | `trình định dạng`     |                                                          |
| compaction                 | `nén`                 |                                                          |
| attachment                 | `tệp đính kèm`        |                                                          |
| data                       | `dữ liệu`             |                                                          |

## Guidance

- Prefer natural Vietnamese phrasing over literal translation; short labels stay short
- Keep language names static/native in language pickers: always `Tiếng Việt`, never a translated form
- Keep `$` amounts in the original currency notation and numbers, e.g. `$10/month`
- Vietnamese has no grammatical plural, so `*_one` and `*_other` strings may be identical
- Write dates and numbers with the Latin digits used elsewhere in the UI

## Avoid

- Avoid translating language names differently per current locale in language lists
- Avoid `mã nguồn` for `token` and `token` for `source code`
- Avoid Sino-Vietnamese calques such as `chủ đề` for `topic` when `chủ đề` already means theme
- Avoid translating `Zen`, `Go`, and `Black` as generic words like `đỉnh cao` or `đi`
