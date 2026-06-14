#!/usr/bin/env python3
"""
VK File Uploader
Отправляет файл в указанный чат ВК (peer_id)
"""

import argparse
import json
import logging
import time
import urllib.request
import urllib.error
from io import BytesIO
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.parse import urlencode

VK_API_VERSION = "5.200"
BASE_URL = "https://api.vk.com/method/"

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("vk-uploader")


class VKClient:
    def __init__(self, token: str):
        self.token = token

    def _api_request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{BASE_URL}{method}?{urlencode(params)}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "error" in data:
                raise Exception(f"VK API error: {data['error']}")
            return data

    def _upload_file(self, upload_url: str, file_path: str, filename: str) -> Dict[str, Any]:
        with open(file_path, "rb") as f:
            content = f.read()
        
        boundary = "----WebKitFormBoundary" + str(int(time.time() * 1000000))
        body = BytesIO()
        
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
        body.write(b"Content-Type: application/octet-stream\r\n\r\n")
        body.write(content)
        body.write(f"\r\n--{boundary}--\r\n".encode())
        
        req = urllib.request.Request(
            upload_url,
            data=body.getvalue(),
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def send_file(
        self, peer_id: int, file_path: str, filename: str, caption: str = ""
    ) -> int:
        logger.info(f"send_file: file={file_path}, peer_id={peer_id}")
        
        if not Path(file_path).exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # 1. Получаем URL для загрузки
        params = {
            "access_token": self.token,
            "v": VK_API_VERSION,
            "type": "doc",
            "peer_id": peer_id,
        }
        data = self._api_request("docs.getMessagesUploadServer", params)
        upload_url = data["response"]["upload_url"]
        logger.info(f"send_file: upload_url={upload_url}")

        # 2. Загружаем файл
        upload_data = self._upload_file(upload_url, file_path, filename)
        logger.info(f"send_file: upload_data={upload_data}")

        # 3. Сохраняем документ
        save_params = {
            "access_token": self.token,
            "v": VK_API_VERSION,
            **upload_data
        }
        save_data = self._api_request("docs.save", save_params)
        logger.info(f"send_file: save_data={save_data}")
        doc = save_data["response"]["doc"]
        doc_id = doc["id"]
        doc_owner_id = doc["owner_id"]

        # 4. Отправляем документ
        attachment = f"doc{doc_owner_id}_{doc_id}"
        send_params = {
            "access_token": self.token,
            "v": VK_API_VERSION,
            "peer_id": peer_id,
            "attachment": attachment,
            "random_id": int(time.time() * 1000),
        }
        if caption:
            send_params["message"] = caption
        result = self._api_request("messages.send", send_params)
        return result["response"]


def load_config(config_path: str = "config.json") -> dict:
    """Загружает конфигурацию из JSON-файла."""
    default_config = {
        "vk_token": "",
        "vk_api_version": VK_API_VERSION,
    }
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            user_config = json.load(f)
        config = {**default_config, **user_config}
    except FileNotFoundError:
        print(f"Config file {config_path} not found, using defaults.")
        config = default_config
    except json.JSONDecodeError as e:
        print(f"Error parsing config file {config_path}: {e}")
        raise
    return config


def main():
    parser = argparse.ArgumentParser(description="VK File Uploader")
    parser.add_argument("file", type=str, help="Path to file to upload")
    parser.add_argument("--peer-id", type=int, required=True, help="VK peer_id (chat or user ID)")
    parser.add_argument("--caption", type=str, default="", help="Caption for the file")
    parser.add_argument("--filename", type=str, default=None, help="Filename in chat (default: original name)")
    parser.add_argument("--config", type=str, default="config.json", help="Path to config file")
    args = parser.parse_args()

    CONFIG = load_config(args.config)
    VK_TOKEN = CONFIG["vk_token"]

    if not VK_TOKEN:
        raise ValueError("VK_TOKEN is required in config file or environment")

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: File not found: {args.file}")
        return 1

    filename = args.filename or file_path.name
    caption = args.caption

    logger.info(f"Uploading {file_path} to peer_id {args.peer_id}")
    logger.info(f"Filename: {filename}, Caption: {caption}")

    try:
        vk = VKClient(VK_TOKEN)
        message_id = vk.send_file(args.peer_id, str(file_path), filename, caption)
        logger.info(f"File sent successfully! message_id={message_id}")
        return 0
    except Exception as e:
        logger.exception(f"Failed to send file: {e}")
        return 1


if __name__ == "__main__":
    exit(main())
