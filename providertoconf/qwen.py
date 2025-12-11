"""
Qwen Code provider with OAuth authentication.
Uses Qwen's OAuth for free tier access via chat.qwen.ai.
Based on KiloCode implementation.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncGenerator, Optional
from urllib.parse import urlencode

import httpx

from .base import LLMProvider, LLMResponse, ProviderConfig, StreamChunk


# Qwen OAuth Configuration
QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
QWEN_OAUTH_TOKEN_ENDPOINT = f"{QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token"
QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"

# Default API endpoint
QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

# Qwen models (matching Qwen Code CLI)
QWEN_MODELS = [
    "coder-model",  # Latest Qwen Coder model (qwen3-coder-plus)
    "vision-model",  # Latest Qwen Vision model (qwen3-vl-plus)
]

QWEN_DEFAULT_MODEL = "coder-model"


class QwenProvider(LLMProvider):
    """
    Qwen provider with OAuth support.
    
    Reads OAuth credentials from ~/.qwen/oauth_creds.json
    Uses the OpenAI-compatible API at dashscope.aliyuncs.com.
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs: Any
    ) -> None:
        """Initialize Qwen provider."""
        config = self._default_config()
        if api_key:
            config.api_key = api_key
        super().__init__(config)
        
        if model:
            self._model = model
        
        self._credentials: Optional[dict] = None
        self._refresh_promise: Optional[Any] = None
    
    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            name="Qwen",
            base_url=QWEN_DEFAULT_BASE_URL,
            default_model=QWEN_DEFAULT_MODEL,
            available_models=QWEN_MODELS,
            max_tokens=128_000,  # 128K tokens for coder-model
            supports_streaming=True,
            supports_functions=True,
            rate_limit_rpm=60,  # Free tier: 60 requests/minute
            cost_per_1k_input=0.0,  # Free tier via OAuth
            cost_per_1k_output=0.0,  # Free tier via OAuth
        )
    
    def _get_credentials_path(self) -> Path:
        """Get path to credentials file."""
        return Path.home() / ".qwen" / "oauth_creds.json"
    
    async def _load_credentials(self) -> dict:
        """Load OAuth credentials from file."""
        cred_path = self._get_credentials_path()
        
        if not cred_path.exists():
            raise ValueError(
                "Qwen OAuth credentials not found.\n"
                "Please login with: /login qwen\n"
                "Or copy oauth_creds.json to ~/.qwen/"
            )
        
        try:
            with open(cred_path, 'r') as f:
                self._credentials = json.load(f)
            return self._credentials
        except (json.JSONDecodeError, IOError) as e:
            raise ValueError(f"Failed to load Qwen credentials: {e}")
    
    def _is_token_valid(self) -> bool:
        """Check if current token is valid."""
        if not self._credentials:
            return False
        
        expiry = self._credentials.get("expiry_date", 0)
        # 30 second buffer
        return time.time() * 1000 < expiry - 30000
    
    async def _refresh_access_token(self) -> dict:
        """Refresh the OAuth access token."""
        if not self._credentials or not self._credentials.get("refresh_token"):
            raise ValueError("No refresh token available")
        
        body_data = {
            "grant_type": "refresh_token",
            "refresh_token": self._credentials["refresh_token"],
            "client_id": QWEN_OAUTH_CLIENT_ID
        }
        
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
                QWEN_OAUTH_TOKEN_ENDPOINT,
                headers=headers,
                content=urlencode(body_data),
                timeout=30.0
            )
            
            if not response.is_success:
                raise ValueError(f"Token refresh failed: {response.status_code} {response.text}")
            
            token_data = response.json()
            
            if token_data.get("error"):
                raise ValueError(f"Token refresh failed: {token_data['error']}")
            
            # Update credentials
            self._credentials["access_token"] = token_data["access_token"]
            self._credentials["token_type"] = token_data.get("token_type", "Bearer")
            if token_data.get("refresh_token"):
                self._credentials["refresh_token"] = token_data["refresh_token"]
            self._credentials["expiry_date"] = int(time.time() * 1000 + token_data.get("expires_in", 3600) * 1000)
            
            # Save to file
            cred_path = self._get_credentials_path()
            try:
                cred_path.parent.mkdir(parents=True, exist_ok=True)
                with open(cred_path, 'w') as f:
                    json.dump(self._credentials, f, indent=2)
            except IOError as e:
                print(f"[Qwen] Failed to save credentials: {e}")
            
            return self._credentials
    
    async def _ensure_authenticated(self) -> str:
        """Ensure we have a valid OAuth access token."""
        # OAuth-only authentication (like Qwen Code CLI)
        if not self._credentials:
            await self._load_credentials()
        
        if not self._is_token_valid():
            try:
                await self._refresh_access_token()
            except Exception as e:
                raise ValueError(f"Failed to refresh Qwen token: {e}. Try running '/login qwen' or the official 'qwen' CLI to refresh.")
        
        return self._credentials["access_token"]
    
    def _get_base_url(self) -> str:
        """Get the API base URL."""
        if not self._credentials:
            return QWEN_DEFAULT_BASE_URL
        
        base_url = self._credentials.get("resource_url", "")
        if not base_url:
            return QWEN_DEFAULT_BASE_URL
        
        if not base_url.startswith("http://") and not base_url.startswith("https://"):
            base_url = f"https://{base_url}"
        
        return base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    
    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any
    ) -> LLMResponse:
        """Send a chat completion request to Qwen."""
        access_token = await self._ensure_authenticated()
        base_url = self._get_base_url()
        
        model = model or self._model
        temperature = temperature if temperature is not None else 0
        max_tokens = max_tokens or self._config.max_tokens
        
        # Filter out unsupported params (tools not supported by Qwen OAuth API)
        kwargs.pop("tools", None)
        kwargs.pop("tool_choice", None)
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_completion_tokens": max_tokens,
            "repetition_penalty": 1.1,  # Discourage repetitive output
            **kwargs
        }
        
        start_time = time.perf_counter()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Origin": "https://chat.qwen.ai",
                    "Referer": "https://chat.qwen.ai/"
                },
                json=payload,
                timeout=120.0
            )
            
            # Retry on 401
            if response.status_code == 401:
                await self._refresh_access_token()
                response = await client.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._credentials['access_token']}",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Origin": "https://chat.qwen.ai",
                        "Referer": "https://chat.qwen.ai/"
                    },
                    json=payload,
                    timeout=120.0
                )
            
            # Handle errors before raise_for_status
            if not response.is_success:
                text = response.text.strip()
                raise ValueError(f"Qwen API error ({response.status_code}): {text[:500]}")
            
            # Handle empty response
            text = response.text.strip()
            if not text:
                raise ValueError("Empty response from Qwen API")
            
            try:
                data = response.json()
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON from Qwen API: {text[:200]}")
            
            if "error" in data:
                raise ValueError(f"Qwen API error: {data['error']}")
        
        latency_ms = (time.perf_counter() - start_time) * 1000
        
        if not data.get("choices"):
            raise ValueError(f"No choices in Qwen response: {data}")
        
        message = data["choices"][0].get("message", {})
        content = message.get("content") or ""
        usage = data.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)
        
        return LLMResponse(
            content=content,
            model=data.get("model", model),
            provider=self.name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=0.0,
            finish_reason=data["choices"][0].get("finish_reason", "stop"),
            latency_ms=latency_ms,
            raw_response=data
        )
    
    async def chat_stream(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any
    ) -> AsyncGenerator[StreamChunk, None]:
        """Send a streaming chat completion request to Qwen."""
        # Reset reasoning state for new stream
        self._in_reasoning = False
        
        access_token = await self._ensure_authenticated()
        base_url = self._get_base_url()
        
        model = model or self._model
        temperature = temperature if temperature is not None else 0
        max_tokens = max_tokens or self._config.max_tokens
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_completion_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
            "repetition_penalty": 1.1,  # Discourage repetitive output
            **kwargs
        }
        
        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "POST",
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Origin": "https://chat.qwen.ai",
                        "Referer": "https://chat.qwen.ai/"
                    },
                    json=payload,
                    timeout=180.0
                ) as response:
                    if not response.is_success:
                        # Try to read error body
                        error_body = ""
                        async for chunk in response.aiter_bytes():
                            error_body += chunk.decode("utf-8", errors="ignore")
                        raise ValueError(f"Qwen API error ({response.status_code}): {error_body[:500]}")
                    
                    full_content = ""
                    has_content = False
                    
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        # Handle SSE format
                        if not line.startswith("data: "):
                            # Check for error responses
                            if line.startswith("{"):
                                try:
                                    error_data = json.loads(line)
                                    if "error" in error_data:
                                        raise ValueError(f"Qwen API error: {error_data['error']}")
                                except json.JSONDecodeError:
                                    pass
                            continue
                        
                        data_str = line[6:].strip()
                        if not data_str or data_str == "[DONE]":
                            break
                        
                        try:
                            data = json.loads(data_str)
                            
                            if "choices" in data and data["choices"]:
                                choice = data["choices"][0]
                                delta = choice.get("delta", {})
                                content = delta.get("content", "")
                                
                                if content:
                                    # Handle incremental vs full content
                                    # Qwen may send full accumulated content or just deltas
                                    new_text = content
                                    
                                    # If content starts with what we've seen, extract only the new part
                                    if full_content and content.startswith(full_content):
                                        new_text = content[len(full_content):]
                                    # If content is completely different and longer, it might be full content
                                    elif full_content and len(content) > len(full_content) and full_content in content:
                                        # Find where the new content starts
                                        idx = content.find(full_content)
                                        if idx == 0:
                                            new_text = content[len(full_content):]
                                    
                                    full_content = content
                                    
                                    if new_text:
                                        has_content = True
                                        # Check for thinking blocks
                                        if "<think>" in new_text or "</think>" in new_text:
                                            # Parse thinking blocks
                                            import re
                                            parts = re.split(r'</?think>', new_text)
                                            for i, part in enumerate(parts):
                                                if part:
                                                    yield StreamChunk(
                                                        content=part,
                                                        finish_reason=choice.get("finish_reason"),
                                                        model=data.get("model", model)
                                                    )
                                        else:
                                            yield StreamChunk(
                                                content=new_text,
                                                finish_reason=choice.get("finish_reason"),
                                                model=data.get("model", model)
                                            )
                                
                                # Handle reasoning_content - yield with think tags
                                # Note: We yield opening/closing tags separately to work with
                                # the renderer's character-by-character state machine
                                if delta.get("reasoning_content"):
                                    has_content = True
                                    reasoning = delta["reasoning_content"]
                                    # Only add opening tag if not already in thinking mode
                                    if not getattr(self, '_in_reasoning', False):
                                        yield StreamChunk(content="<think>", finish_reason=None, model=data.get("model", model))
                                        self._in_reasoning = True
                                    yield StreamChunk(
                                        content=reasoning,
                                        finish_reason=choice.get("finish_reason"),
                                        model=data.get("model", model)
                                    )
                                elif getattr(self, '_in_reasoning', False):
                                    # Close thinking block when we get non-reasoning content
                                    yield StreamChunk(content="</think>", finish_reason=None, model=data.get("model", model))
                                    self._in_reasoning = False
                        except json.JSONDecodeError:
                            continue
                    
                    # Close any open thinking block at end of stream
                    if getattr(self, '_in_reasoning', False):
                        yield StreamChunk(content="</think>", finish_reason=None, model=model)
                        self._in_reasoning = False
                    
                    # If no content was received, yield empty to avoid hanging
                    if not has_content:
                        yield StreamChunk(content="", finish_reason="stop", model=model)
            except httpx.HTTPStatusError as e:
                raise ValueError(f"Qwen API HTTP error: {e.response.status_code}")
            except httpx.RequestError as e:
                raise ValueError(f"Qwen API request error: {e}")
    
    async def list_models(self) -> list[str]:
        """List available Qwen models."""
        return QWEN_MODELS
