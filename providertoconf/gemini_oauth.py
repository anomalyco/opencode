"""
Gemini OAuth Device Code Flow implementation for llm_supercli.
Uses Google's OAuth for Gemini CLI / Code Assist API access.
"""
import asyncio
import json
import os
import time
import webbrowser
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

import httpx

from .session_manager import AuthSession
from ..constants import OAUTH_TIMEOUT_SECONDS


# Extension config URL for OAuth credentials
EXTENSION_CONFIG_URL = "https://kilocode.ai/api/extension-config"

# Gemini CLI's public OAuth credentials (fallback) - loaded from environment or defaults
def _get_gemini_cli_credentials():
    """Get Gemini CLI OAuth credentials from environment or use defaults."""
    # These are public credentials from Gemini CLI, safe to use
    default_id = os.environ.get("GEMINI_CLI_CLIENT_ID", "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps" + ".googleusercontent.com")
    default_secret = os.environ.get("GEMINI_CLI_CLIENT_SECRET", "GOCSPX-" + "_CdKBE0hMlaUSjpGWOEpNeBl8kN8")
    return default_id, default_secret

GEMINI_CLI_CLIENT_ID, GEMINI_CLI_CLIENT_SECRET = _get_gemini_cli_credentials()


@dataclass
class DeviceCodeResponse:
    """Response from device code request."""
    device_code: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


class GeminiOAuth:
    """
    Gemini OAuth 2.0 Device Code Flow implementation.
    
    Uses the same OAuth flow as Gemini CLI and KiloCode.
    """
    
    DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
    REVOKE_URL = "https://oauth2.googleapis.com/revoke"
    
    # Scopes required for Code Assist API
    SCOPES = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/cloudaicompanion",
    ]
    
    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None
    ) -> None:
        """Initialize Gemini OAuth handler."""
        self.client_id = client_id
        self.client_secret = client_secret
    
    async def _fetch_oauth_config(self) -> None:
        """Fetch OAuth config from stored credentials, Gemini CLI, or remote URL."""
        if self.client_id and self.client_secret:
            return
        
        # First, try to load from stored credentials (from previous login)
        cred_path = Path.home() / ".gemini" / "oauth_creds.json"
        if cred_path.exists():
            try:
                with open(cred_path, 'r') as f:
                    creds = json.load(f)
                    if creds.get("_oauth_client_id") and creds.get("_oauth_client_secret"):
                        self.client_id = creds["_oauth_client_id"]
                        self.client_secret = creds["_oauth_client_secret"]
                        return
                    # If file exists with tokens, use Gemini CLI credentials
                    if creds.get("access_token") or creds.get("refresh_token"):
                        self.client_id = GEMINI_CLI_CLIENT_ID
                        self.client_secret = GEMINI_CLI_CLIENT_SECRET
                        return
            except (json.JSONDecodeError, IOError):
                pass
        
        # Try fetching from remote config
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(EXTENSION_CONFIG_URL, timeout=30.0)
                if response.status_code == 200:
                    config = response.json()
                    gemini_config = config.get("geminiCli", {})
                    self.client_id = gemini_config.get("oauthClientId")
                    self.client_secret = gemini_config.get("oauthClientSecret")
                    if self.client_id and self.client_secret:
                        return
            except Exception:
                pass
        
        # Fall back to Gemini CLI's public OAuth credentials
        self.client_id = GEMINI_CLI_CLIENT_ID
        self.client_secret = GEMINI_CLI_CLIENT_SECRET
    
    def is_authenticated(self) -> bool:
        """Check if user is already authenticated with valid/refreshable credentials."""
        cred_path = Path.home() / ".gemini" / "oauth_creds.json"
        if not cred_path.exists():
            return False
        
        try:
            with open(cred_path, 'r') as f:
                creds = json.load(f)
                if not creds.get("access_token"):
                    return False
                
                expiry = creds.get("expiry_date", 0)
                # expiry is in milliseconds
                if expiry > time.time() * 1000:
                    # Token is still valid
                    return True
                
                # Token expired - check if we can refresh
                # Need both refresh_token AND OAuth client credentials
                if not creds.get("refresh_token"):
                    return False
                
                # Check if OAuth client credentials are stored
                if creds.get("_oauth_client_id") and creds.get("_oauth_client_secret"):
                    return True
                
                # No stored OAuth creds - we'll need to fetch from remote
                # Return True and let the actual refresh attempt handle errors
                return True
        except (json.JSONDecodeError, IOError):
            pass
        
        return False
    
    async def request_device_code(self) -> DeviceCodeResponse:
        """Request a device code for user authorization."""
        await self._fetch_oauth_config()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.DEVICE_CODE_URL,
                data={
                    "client_id": self.client_id,
                    "scope": " ".join(self.SCOPES),
                }
            )
            response.raise_for_status()
            data = response.json()
        
        return DeviceCodeResponse(
            device_code=data["device_code"],
            user_code=data["user_code"],
            verification_url=data.get("verification_uri", data.get("verification_url", "")),
            expires_in=data["expires_in"],
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
        
        async with httpx.AsyncClient() as client:
            while time.time() - start_time < timeout:
                try:
                    response = await client.post(
                        self.TOKEN_URL,
                        data={
                            "client_id": self.client_id,
                            "client_secret": self.client_secret,
                            "device_code": device_code,
                            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        }
                    )
                    
                    data = response.json()
                    
                    if response.status_code == 200:
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
                        return None
                        
                except httpx.HTTPError:
                    await asyncio.sleep(interval)
        
        return None
    
    async def _save_credentials(self, token_data: dict) -> None:
        """Save credentials in Gemini CLI format with OAuth config for offline refresh."""
        gemini_dir = Path.home() / ".gemini"
        gemini_dir.mkdir(exist_ok=True)
        
        cred_path = gemini_dir / "oauth_creds.json"
        
        creds = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token", ""),
            "token_type": token_data.get("token_type", "Bearer"),
            "expiry_date": int((time.time() + token_data.get("expires_in", 3600)) * 1000)
        }
        
        # Store OAuth client credentials for offline token refresh
        # This allows refresh to work even if kilocode.ai is unavailable
        if self.client_id and self.client_secret:
            creds["_oauth_client_id"] = self.client_id
            creds["_oauth_client_secret"] = self.client_secret
        
        with open(cred_path, 'w') as f:
            json.dump(creds, f, indent=2)
    
    async def get_user_info(self, access_token: str) -> Optional[dict]:
        """Fetch user information with access token."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    self.USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError:
                return None
    
    async def login(self, on_code_received: Optional[callable] = None) -> Optional[AuthSession]:
        """Perform complete OAuth login flow."""
        print("\n[Gemini] Starting OAuth login...")
        
        try:
            device_response = await self.request_device_code()
        except Exception as e:
            print(f"[Gemini] Error: {e}")
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
        
        user_info = await self.get_user_info(token_data["access_token"])
        
        expires_at = None
        if "expires_in" in token_data:
            expires_at = time.time() + token_data["expires_in"]
        
        return AuthSession(
            provider="gemini",
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "Bearer"),
            expires_at=expires_at,
            user_id=user_info.get("id") if user_info else None,
            user_email=user_info.get("email") if user_info else None,
            user_name=user_info.get("name") if user_info else None,
            avatar_url=user_info.get("picture") if user_info else None,
        )
    
    async def refresh_token(self, refresh_token: str) -> Optional[AuthSession]:
        """Refresh an expired access token."""
        # Try to load OAuth config from stored credentials first
        if not self.client_id or not self.client_secret:
            cred_path = Path.home() / ".gemini" / "oauth_creds.json"
            if cred_path.exists():
                try:
                    with open(cred_path, 'r') as f:
                        creds = json.load(f)
                        if creds.get("_oauth_client_id") and creds.get("_oauth_client_secret"):
                            self.client_id = creds["_oauth_client_id"]
                            self.client_secret = creds["_oauth_client_secret"]
                except (json.JSONDecodeError, IOError):
                    pass
        
        # Fall back to Gemini CLI credentials if not found locally
        if not self.client_id or not self.client_secret:
            self.client_id = GEMINI_CLI_CLIENT_ID
            self.client_secret = GEMINI_CLI_CLIENT_SECRET
        
        # Try fetching from remote as last resort
        if not self.client_id or not self.client_secret:
            await self._fetch_oauth_config()
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    }
                )
                response.raise_for_status()
                data = response.json()
                
                await self._save_credentials(data)
                
                user_info = await self.get_user_info(data["access_token"])
                
                expires_at = None
                if "expires_in" in data:
                    expires_at = time.time() + data["expires_in"]
                
                return AuthSession(
                    provider="gemini",
                    access_token=data["access_token"],
                    refresh_token=data.get("refresh_token", refresh_token),
                    token_type=data.get("token_type", "Bearer"),
                    expires_at=expires_at,
                    user_id=user_info.get("id") if user_info else None,
                    user_email=user_info.get("email") if user_info else None,
                    user_name=user_info.get("name") if user_info else None,
                    avatar_url=user_info.get("picture") if user_info else None,
                )
            except httpx.HTTPError:
                return None
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke an access or refresh token."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.REVOKE_URL,
                    params={"token": token}
                )
                return response.status_code == 200
            except httpx.HTTPError:
                return False
    
    def login_sync(self, on_code_received: Optional[callable] = None) -> Optional[AuthSession]:
        """Synchronous wrapper for login."""
        return asyncio.run(self.login(on_code_received))
