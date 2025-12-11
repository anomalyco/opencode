"""
Qwen OAuth implementation for llm_supercli.
Uses OAuth device code flow with chat.qwen.ai.
Based on KiloCode implementation.
"""
import asyncio
import base64
import hashlib
import json
import os
import secrets
import time
import webbrowser
from pathlib import Path
from typing import Optional
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from .session_manager import AuthSession
from ..constants import OAUTH_TIMEOUT_SECONDS


# Qwen OAuth Configuration
QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
QWEN_OAUTH_DEVICE_CODE_ENDPOINT = f"{QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code"
QWEN_OAUTH_TOKEN_ENDPOINT = f"{QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token"
QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"


@dataclass
class QwenDeviceCodeResponse:
    """Response from Qwen device code request."""
    device_code: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


def _generate_code_verifier() -> str:
    """Generate a PKCE code verifier (43-128 chars, URL-safe)."""
    return secrets.token_urlsafe(32)


def _generate_code_challenge(verifier: str) -> str:
    """Generate a PKCE code challenge from verifier using S256 method."""
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')


class QwenOAuth:
    """
    Qwen OAuth Device Code Flow implementation with PKCE support.
    
    Uses chat.qwen.ai OAuth for free tier access.
    """
    
    def __init__(self) -> None:
        """Initialize Qwen OAuth handler."""
        self.client_id = QWEN_OAUTH_CLIENT_ID
        self._code_verifier: Optional[str] = None
    
    def _get_credentials_path(self) -> Path:
        """Get path to credentials file."""
        return Path.home() / ".qwen" / "oauth_creds.json"
    
    def is_authenticated(self) -> bool:
        """Check if user is already authenticated."""
        cred_path = self._get_credentials_path()
        if not cred_path.exists():
            return False
        
        try:
            with open(cred_path, 'r') as f:
                creds = json.load(f)
                if creds.get("access_token"):
                    expiry = creds.get("expiry_date", 0)
                    # 30 second buffer
                    if time.time() * 1000 < expiry - 30000:
                        return True
        except (json.JSONDecodeError, IOError):
            pass
        
        return False
    
    async def request_device_code(self) -> QwenDeviceCodeResponse:
        """Request a device code for user authorization."""
        # Generate PKCE code verifier and challenge
        self._code_verifier = _generate_code_verifier()
        code_challenge = _generate_code_challenge(self._code_verifier)
        
        # Browser-like headers to avoid WAF blocking
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": QWEN_OAUTH_BASE_URL,
            "Referer": f"{QWEN_OAUTH_BASE_URL}/",
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
                headers=headers,
                content=urlencode({
                    "client_id": self.client_id,
                    "code_challenge": code_challenge,
                    "code_challenge_method": "S256",
                }),
                timeout=30.0
            )
            
            # Debug: print response details
            if response.status_code != 200:
                print(f"[Qwen] Device code request failed: {response.status_code}")
                print(f"[Qwen] Response: {response.text[:500]}")
                response.raise_for_status()
            
            try:
                data = response.json()
            except json.JSONDecodeError as e:
                print(f"[Qwen] Failed to parse JSON response")
                print(f"[Qwen] Response text: {response.text[:500]}")
                raise ValueError(f"Invalid JSON response from Qwen OAuth: {e}")
        
        # Build verification URL with user_code and client as query params
        user_code = data["user_code"]
        base_verification_url = data.get("verification_uri", data.get("verification_url", f"{QWEN_OAUTH_BASE_URL}/authorize"))
        # Qwen expects 'client' not 'client_id' in the URL
        verification_url = f"{base_verification_url}?user_code={user_code}&client={self.client_id}"
        
        return QwenDeviceCodeResponse(
            device_code=data["device_code"],
            user_code=user_code,
            verification_url=verification_url,
            expires_in=data.get("expires_in", 600),
            interval=data.get("interval", 5)
        )
    
    async def poll_for_token(
        self,
        device_code: str,
        interval: int = 5,
        timeout: int = OAUTH_TIMEOUT_SECONDS
    ) -> Optional[dict]:
        """Poll for access token after user authorizes."""
        start_time = time.time()
        
        # Browser-like headers to avoid WAF blocking
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": QWEN_OAUTH_BASE_URL,
            "Referer": f"{QWEN_OAUTH_BASE_URL}/",
        }
        
        async with httpx.AsyncClient() as client:
            while time.time() - start_time < timeout:
                try:
                    # Include code_verifier for PKCE
                    token_params = {
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "device_code": device_code,
                        "client_id": self.client_id,
                    }
                    if self._code_verifier:
                        token_params["code_verifier"] = self._code_verifier
                    
                    response = await client.post(
                        QWEN_OAUTH_TOKEN_ENDPOINT,
                        headers=headers,
                        content=urlencode(token_params),
                        timeout=30.0
                    )
                    
                    data = response.json()
                    
                    if response.status_code == 200 and data.get("access_token"):
                        await self._save_credentials(data)
                        return data
                    
                    error = data.get("error")
                    
                    if error == "authorization_pending":
                        await asyncio.sleep(interval)
                        continue
                    elif error == "slow_down":
                        interval += 1
                        await asyncio.sleep(interval)
                        continue
                    elif error in ("access_denied", "expired_token"):
                        return None
                    else:
                        await asyncio.sleep(interval)
                        continue
                        
                except httpx.HTTPError as e:
                    print(f"[Qwen] HTTP error: {e}")
                    await asyncio.sleep(interval)
        
        return None
    
    async def _save_credentials(self, token_data: dict) -> None:
        """Save credentials to file."""
        qwen_dir = Path.home() / ".qwen"
        qwen_dir.mkdir(exist_ok=True)
        
        cred_path = qwen_dir / "oauth_creds.json"
        
        creds = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token", ""),
            "token_type": token_data.get("token_type", "Bearer"),
            "expiry_date": int(time.time() * 1000 + token_data.get("expires_in", 3600) * 1000),
            "resource_url": token_data.get("resource_url", "")
        }
        
        with open(cred_path, 'w') as f:
            json.dump(creds, f, indent=2)
    
    async def login(self, on_code_received: Optional[callable] = None) -> Optional[AuthSession]:
        """Perform complete OAuth login flow."""
        print("\n[Qwen] Starting OAuth login...")
        
        try:
            device_response = await self.request_device_code()
        except Exception as e:
            print(f"[Qwen] Error getting device code: {e}")
            print(f"\n[Qwen] OAuth login is currently unavailable.")
            print(f"[Qwen] Alternative: Use API key authentication instead:")
            print(f"[Qwen]   1. Get an API key from https://dashscope.console.aliyun.com/")
            print(f"[Qwen]   2. Set environment variable: DASHSCOPE_API_KEY=your-api-key")
            print(f"[Qwen]   3. Or use /settings to configure the API key")
            return None
        
        # Show user code and URL
        print(f"\n  Please visit: {device_response.verification_url}")
        print(f"  Enter code: {device_response.user_code}\n")
        
        if on_code_received:
            on_code_received(
                device_response.user_code,
                device_response.verification_url
            )
        
        # Try to open browser
        try:
            webbrowser.open(device_response.verification_url)
        except Exception:
            pass
        
        print("  Waiting for authorization...")
        
        token_data = await self.poll_for_token(
            device_response.device_code,
            device_response.interval
        )
        
        if not token_data:
            return None
        
        expires_at = None
        if "expires_in" in token_data:
            expires_at = time.time() + token_data["expires_in"]
        
        return AuthSession(
            provider="qwen",
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "Bearer"),
            expires_at=expires_at,
            user_id=None,
            user_email=None,
            user_name="Qwen User",
            avatar_url=None,
        )
    
    async def refresh_token(self, refresh_token: str) -> Optional[AuthSession]:
        """Refresh an expired access token."""
        # Browser-like headers to avoid WAF blocking
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": QWEN_OAUTH_BASE_URL,
            "Referer": f"{QWEN_OAUTH_BASE_URL}/",
        }
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    QWEN_OAUTH_TOKEN_ENDPOINT,
                    headers=headers,
                    content=urlencode({
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                        "client_id": self.client_id,
                    }),
                    timeout=30.0
                )
                
                if not response.is_success:
                    return None
                
                data = response.json()
                
                if data.get("error"):
                    return None
                
                await self._save_credentials(data)
                
                expires_at = None
                if "expires_in" in data:
                    expires_at = time.time() + data["expires_in"]
                
                return AuthSession(
                    provider="qwen",
                    access_token=data["access_token"],
                    refresh_token=data.get("refresh_token", refresh_token),
                    token_type=data.get("token_type", "Bearer"),
                    expires_at=expires_at,
                    user_id=None,
                    user_email=None,
                    user_name="Qwen User",
                    avatar_url=None,
                )
            except httpx.HTTPError:
                return None
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke token - clear local credentials."""
        cred_path = self._get_credentials_path()
        try:
            if cred_path.exists():
                cred_path.unlink()
            return True
        except IOError:
            return False
    
    def login_sync(self, on_code_received: Optional[callable] = None) -> Optional[AuthSession]:
        """Synchronous wrapper for login."""
        return asyncio.run(self.login(on_code_received))
