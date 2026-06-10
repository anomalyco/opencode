import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  "desktop.menu.checkForUpdates": "Kiểm tra cập nhật...",
  "desktop.menu.installCli": "Cài đặt CLI...",
  "desktop.menu.reloadWebview": "Tải lại Webview",
  "desktop.menu.restart": "Khởi động lại",

  "desktop.dialog.chooseFolder": "Chọn thư mục",
  "desktop.dialog.chooseFile": "Chọn tệp",
  "desktop.dialog.saveFile": "Lưu tệp",

  "desktop.updater.checkFailed.title": "Kiểm tra cập nhật thất bại",
  "desktop.updater.checkFailed.message": "Không thể kiểm tra cập nhật",
  "desktop.updater.none.title": "Không có bản cập nhật mới",
  "desktop.updater.none.message": "Bạn đang dùng phiên bản OpenCode mới nhất",
  "desktop.updater.downloadFailed.title": "Cập nhật thất bại",
  "desktop.updater.downloadFailed.message": "Không thể tải bản cập nhật",
  "desktop.updater.downloaded.title": "Đã tải bản cập nhật",
  "desktop.updater.downloaded.prompt":
    "Phiên bản {{version}} của OpenCode đã được tải xuống, bạn có muốn cài đặt và khởi động lại không?",
  "desktop.updater.installFailed.title": "Cập nhật thất bại",
  "desktop.updater.installFailed.message": "Không thể cài đặt bản cập nhật",

  "desktop.cli.installed.title": "Đã cài đặt CLI",
  "desktop.cli.installed.message":
    "CLI đã được cài vào {{path}}\n\nHãy khởi động lại terminal để dùng lệnh 'opencode'.",
  "desktop.cli.failed.title": "Cài đặt thất bại",
  "desktop.cli.failed.message": "Không thể cài CLI: {{error}}",
} satisfies Partial<Record<Keys, string>>
