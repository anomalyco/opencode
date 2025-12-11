"""
Google Gemini CLI provider with OAuth authentication.
Uses Google's Code Assist API (cloudcode-pa.googleapis.com).
Based on KiloCode/Cline implementation.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncGenerator, Optional
import asyncio
import httpx

from .base import LLMProvider, LLMResponse, ProviderConfig, StreamChunk


# Code Assist API Configuration
CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
CODE_ASSIST_API_VERSION = "v1internal"

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

# Gemini models available through Code Assist (matching Gemini CLI)
GEMINI_MODELS = [
    "auto",  # Let Gemini choose the best model
    "gemini-2.5-pro",  # Pro model for complex tasks
    "gemini-2.5-flash",  # Flash model for speed
    "gemini-2.5-flash-lite",  # Flash-Lite for simple tasks
]

GEMINI_DEFAULT_MODEL = "gemini-2.5-flash"


class GeminiProvider(LLMProvider):
    """
    Google Gemini provider using OAuth with Code Assist API.
    
    Reads OAuth credentials from ~/.gemini/oauth_creds.json
    (compatible with Gemini CLI format).
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs: Any
    ) -> None:
        """Initialize Gemini provider."""
        config = self._default_config()
        super().__init__(config)
        
        if model:
            self._model = model
        
        self._project_id: Optional[str] = None
        self._credentials: Optional[dict] = None
        self._oauth_client_id: Optional[str] = None
        self._oauth_client_secret: Optional[str] = None
    
    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            name="Gemini",
            base_url="https://cloudcode-pa.googleapis.com",
            default_model=GEMINI_DEFAULT_MODEL,
            available_models=GEMINI_MODELS,
            max_tokens=1_048_576,  # 1M tokens for most models
            supports_streaming=True,
            supports_functions=True,
            rate_limit_rpm=1500,
            cost_per_1k_input=0.0001,  # $0.10 per 1M = $0.0001 per 1K (Flash/Flash-Lite)
            cost_per_1k_output=0.0004,  # $0.40 per 1M = $0.0004 per 1K
        )
    
    async def _fetch_oauth_config(self) -> None:
        """Fetch OAuth client credentials from stored creds, Gemini CLI, or remote config."""
        if self._oauth_client_id and self._oauth_client_secret:
            return
        
        # First, try to load from stored credentials (from previous successful login/refresh)
        cred_path = Path.home() / ".gemini" / "oauth_creds.json"
        if cred_path.exists():
            try:
                with open(cred_path, 'r') as f:
                    creds = json.load(f)
                    if creds.get("_oauth_client_id") and creds.get("_oauth_client_secret"):
                        self._oauth_client_id = creds["_oauth_client_id"]
                        self._oauth_client_secret = creds["_oauth_client_secret"]
                        return
                    # If file exists with tokens, use Gemini CLI credentials
                    if creds.get("access_token") or creds.get("refresh_token"):
                        self._oauth_client_id = GEMINI_CLI_CLIENT_ID
                        self._oauth_client_secret = GEMINI_CLI_CLIENT_SECRET
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
                    self._oauth_client_id = gemini_config.get("oauthClientId")
                    self._oauth_client_secret = gemini_config.get("oauthClientSecret")
                    if self._oauth_client_id and self._oauth_client_secret:
                        return
            except Exception:
                pass
        
        # Fall back to Gemini CLI's public OAuth credentials
        self._oauth_client_id = GEMINI_CLI_CLIENT_ID
        self._oauth_client_secret = GEMINI_CLI_CLIENT_SECRET
    
    async def _load_oauth_credentials(self) -> dict:
        """Load OAuth credentials from file."""
        cred_path = Path.home() / ".gemini" / "oauth_creds.json"
        if not cred_path.exists():
            raise ValueError(
                "Gemini OAuth credentials not found.\n"
                "Please install Gemini CLI and run: gemini auth login\n"
                "Or copy oauth_creds.json to ~/.gemini/"
            )
        
        with open(cred_path, 'r') as f:
            self._credentials = json.load(f)
        
        # Try to load OAuth client credentials from stored creds first (offline refresh)
        if self._credentials.get("_oauth_client_id") and self._credentials.get("_oauth_client_secret"):
            self._oauth_client_id = self._credentials["_oauth_client_id"]
            self._oauth_client_secret = self._credentials["_oauth_client_secret"]
        else:
            # Fall back to fetching from extension config
            await self._fetch_oauth_config()
        
        return self._credentials
    
    async def _ensure_authenticated(self) -> str:
        """Ensure we have a valid access token, refreshing if needed."""
        if not self._credentials:
            await self._load_oauth_credentials()
        
        # Check if token needs refresh (expiry_date is in milliseconds)
        expiry = self._credentials.get("expiry_date", 0)
        if expiry < time.time() * 1000:
            await self._refresh_token()
        
        return self._credentials["access_token"]
    
    async def _refresh_token(self) -> None:
        """Refresh the OAuth access token."""
        # Try to get OAuth config - first from stored creds, then from Gemini CLI fallback
        if not self._oauth_client_id or not self._oauth_client_secret:
            # Check if stored in credentials file
            if self._credentials and self._credentials.get("_oauth_client_id"):
                self._oauth_client_id = self._credentials["_oauth_client_id"]
                self._oauth_client_secret = self._credentials["_oauth_client_secret"]
            else:
                # Use Gemini CLI credentials as fallback
                await self._fetch_oauth_config()
        
        if not self._credentials.get("refresh_token"):
            raise ValueError(
                "No refresh token available.\n"
                "Please re-login with: /login gemini"
            )
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": self._oauth_client_id,
                    "client_secret": self._oauth_client_secret,
                    "refresh_token": self._credentials["refresh_token"],
                    "grant_type": "refresh_token"
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                self._credentials["access_token"] = data["access_token"]
                self._credentials["expiry_date"] = int(time.time() * 1000 + data.get("expires_in", 3600) * 1000)
                if data.get("refresh_token"):
                    self._credentials["refresh_token"] = data["refresh_token"]
                
                # Store OAuth client credentials for future offline refresh
                if self._oauth_client_id and self._oauth_client_secret:
                    self._credentials["_oauth_client_id"] = self._oauth_client_id
                    self._credentials["_oauth_client_secret"] = self._oauth_client_secret
                
                # Save refreshed credentials
                cred_path = Path.home() / ".gemini" / "oauth_creds.json"
                with open(cred_path, 'w') as f:
                    json.dump(self._credentials, f, indent=2)
            else:
                # Parse error response for better message
                try:
                    error_data = response.json()
                    error_msg = error_data.get("error_description", error_data.get("error", "Unknown error"))
                except Exception:
                    error_msg = f"HTTP {response.status_code}"
                
                raise ValueError(
                    f"Token refresh failed: {error_msg}\n"
                    "Your Gemini session may have expired.\n"
                    "Please re-launch gemini and restart session: gemini auth login, /quit"
                )
    
    async def _call_endpoint(
        self, 
        method: str, 
        body: dict, 
        access_token: str, 
        retry: bool = True,
        max_retries: int = 3
    ) -> dict:
        """Call a Code Assist API endpoint with retry logic for rate limiting."""
        url = f"{CODE_ASSIST_ENDPOINT}/{CODE_ASSIST_API_VERSION}:{method}"
        
        for attempt in range(max_retries + 1):
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.post(
                        url,
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json"
                        },
                        json=body,
                        timeout=60.0
                    )
                    
                    if response.status_code == 401 and retry:
                        await self._refresh_token()
                        return await self._call_endpoint(
                            method, body, self._credentials["access_token"], 
                            retry=False, max_retries=max_retries
                        )
                    
                    # Handle rate limiting with exponential backoff
                    if response.status_code == 429:
                        if attempt < max_retries:
                            wait_time = (2 ** attempt) + 1  # 2, 3, 5 seconds
                            print(f"[Gemini] Rate limited, waiting {wait_time}s before retry...")
                            await asyncio.sleep(wait_time)
                            continue
                        else:
                            raise httpx.HTTPStatusError(
                                f"Rate limited after {max_retries} retries",
                                request=response.request,
                                response=response
                            )
                    
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as e:
                    # Don't retry on non-429 errors
                    if response.status_code != 429:
                        print(f"[GeminiCLI] Error calling {method}: {e}")
                        raise
                except httpx.ConnectError as e:
                    # Retry on connection errors
                    if attempt < max_retries:
                        wait_time = (2 ** attempt) + 1
                        print(f"[Gemini] Connection error, waiting {wait_time}s before retry...")
                        await asyncio.sleep(wait_time)
                        continue
                    raise
        
        raise ValueError(f"Failed to call {method} after {max_retries} retries")
    
    async def _discover_project_id(self, access_token: str) -> str:
        """Discover or retrieve the project ID."""
        if self._project_id:
            return self._project_id
        
        # Check environment variable
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        
        # Check .gemini/.env file
        env_path = Path.home() / ".gemini" / ".env"
        if env_path.exists():
            try:
                with open(env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GOOGLE_CLOUD_PROJECT="):
                            project_id = line.split("=", 1)[1].strip()
                            break
            except IOError:
                pass
        
        # Prepare client metadata
        client_metadata = {
            "ideType": "IDE_UNSPECIFIED",
            "platform": "PLATFORM_UNSPECIFIED",
            "pluginType": "GEMINI",
            "duetProject": project_id
        }
        
        try:
            # Call loadCodeAssist to discover project ID
            load_request = {
                "cloudaicompanionProject": project_id,
                "metadata": client_metadata
            }
            
            load_response = await self._call_endpoint("loadCodeAssist", load_request, access_token)
            
            if load_response.get("cloudaicompanionProject"):
                self._project_id = load_response["cloudaicompanionProject"]
                return self._project_id
            
            # If no existing project, onboard
            default_tier = None
            for tier in load_response.get("allowedTiers", []):
                if tier.get("isDefault"):
                    default_tier = tier
                    break
            
            tier_id = default_tier.get("id", "free-tier") if default_tier else "free-tier"
            
            onboard_request = {
                "tierId": tier_id,
                "cloudaicompanionProject": project_id,
                "metadata": client_metadata
            }
            
            # Poll for onboarding completion
            max_retries = 30
            for _ in range(max_retries):
                lro_response = await self._call_endpoint("onboardUser", onboard_request, access_token)
                if lro_response.get("done"):
                    self._project_id = lro_response.get("response", {}).get("cloudaicompanionProject", {}).get("id", project_id) or project_id
                    return self._project_id
                await asyncio.sleep(2)
            
            # Fallback
            self._project_id = project_id or "default-project"
            return self._project_id
            
        except Exception as e:
            print(f"[GeminiCLI] Project discovery failed: {e}")
            self._project_id = project_id or "default-project"
            return self._project_id
    
    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any
    ) -> LLMResponse:
        """Send a chat completion request to Gemini via Code Assist API."""
        access_token = await self._ensure_authenticated()
        project_id = await self._discover_project_id(access_token)
        
        model = model or self._model
        temperature = temperature if temperature is not None else self._config.temperature
        max_tokens = max_tokens or self._config.max_tokens
        
        # Convert messages to Gemini format
        contents = self._convert_messages(messages)
        
        request_body = {
            "model": model,
            "project": project_id,
            "request": {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens
                }
            }
        }
        
        # Add tools if provided
        tools = kwargs.get("tools")
        if tools:
            request_body["request"]["tools"] = self._convert_tools(tools)
        
        url = f"{CODE_ASSIST_ENDPOINT}/{CODE_ASSIST_API_VERSION}:generateContent"
        
        start_time = time.perf_counter()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                json=request_body,
                timeout=120.0
            )
            
            if response.status_code == 401:
                await self._refresh_token()
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self._credentials['access_token']}",
                        "Content-Type": "application/json"
                    },
                    json=request_body,
                    timeout=120.0
                )
            
            response.raise_for_status()
            data = response.json()
        
        latency_ms = (time.perf_counter() - start_time) * 1000
        
        # Extract response
        response_data = data.get("response", data)
        content = ""
        tool_calls = []
        
        if response_data.get("candidates"):
            candidate = response_data["candidates"][0]
            for part in candidate.get("content", {}).get("parts", []):
                if part.get("text") and not part.get("thought"):
                    content += part["text"]
                elif part.get("functionCall"):
                    fc = part["functionCall"]
                    # Create OpenAI-style tool call
                    import uuid
                    tool_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "type": "function",
                        "function": {
                            "name": fc.get("name"),
                            "arguments": json.dumps(fc.get("args", {}))
                        }
                    })
        
        # Inject tool_calls into raw_response for CLI to find
        if tool_calls:
            # Construct a fake OpenAI response structure inside the raw data
            # because CLI looks at raw_response['choices'][0]['message']['tool_calls']
            if "choices" not in data:
                data["choices"] = [{"message": {}}]
            
            data["choices"][0]["message"]["role"] = "assistant"
            data["choices"][0]["message"]["tool_calls"] = tool_calls
            data["choices"][0]["message"]["content"] = content
        
        usage = response_data.get("usageMetadata", {})
        input_tokens = usage.get("promptTokenCount", 0)
        output_tokens = usage.get("candidatesTokenCount", 0)
        
        return LLMResponse(
            content=content,
            model=model,
            provider=self.name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=0.0,
            finish_reason="tool_calls" if tool_calls else "stop",
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
        """Send a streaming chat completion request."""
        access_token = await self._ensure_authenticated()
        project_id = await self._discover_project_id(access_token)
        
        model = model or self._model
        temperature = temperature if temperature is not None else self._config.temperature
        max_tokens = max_tokens or self._config.max_tokens
        
        contents = self._convert_messages(messages)
        
        request_body = {
            "model": model,
            "project": project_id,
            "request": {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens
                }
            }
        }
        
        url = f"{CODE_ASSIST_ENDPOINT}/{CODE_ASSIST_API_VERSION}:streamGenerateContent"
        max_retries = 3
        
        for attempt in range(max_retries + 1):
            async with httpx.AsyncClient() as client:
                try:
                    async with client.stream(
                        "POST",
                        url,
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json"
                        },
                        params={"alt": "sse"},
                        json=request_body,
                        timeout=180.0
                    ) as response:
                        # Handle rate limiting with retry
                        if response.status_code == 429:
                            if attempt < max_retries:
                                wait_time = (2 ** attempt) + 1
                                print(f"[Gemini] Rate limited, waiting {wait_time}s before retry...")
                                await asyncio.sleep(wait_time)
                                continue
                            else:
                                raise ValueError(f"Gemini API rate limited after {max_retries} retries")
                        
                        if not response.is_success:
                            error_body = ""
                            async for chunk in response.aiter_bytes():
                                error_body += chunk.decode("utf-8", errors="ignore")
                            raise ValueError(f"Gemini API error ({response.status_code}): {error_body[:500]}")
                        
                        buffer = ""
                        async for chunk in response.aiter_text():
                            buffer += chunk
                            
                            while "\n" in buffer:
                                line, buffer = buffer.split("\n", 1)
                                line = line.strip()
                                
                                if not line or not line.startswith("data: "):
                                    continue
                                
                                data_str = line[6:]
                                if data_str == "[DONE]":
                                    return
                                
                                try:
                                    data = json.loads(data_str)
                                    response_data = data.get("response", data)
                                    
                                    if response_data.get("candidates"):
                                        candidate = response_data["candidates"][0]
                                        for part in candidate.get("content", {}).get("parts", []):
                                            text = part.get("text", "")
                                            if text and not part.get("thought"):
                                                yield StreamChunk(
                                                    content=text,
                                                    finish_reason=candidate.get("finishReason"),
                                                    model=model
                                                )
                                        
                                        if candidate.get("finishReason"):
                                            return
                                except json.JSONDecodeError:
                                    continue
                        # Stream completed successfully, exit retry loop
                        return
                except httpx.HTTPStatusError as e:
                    raise ValueError(f"Gemini API HTTP error ({e.response.status_code}): {e}")
                except httpx.ConnectError as e:
                    # Retry on connection errors
                    if attempt < max_retries:
                        wait_time = (2 ** attempt) + 1
                        print(f"[Gemini] Connection error, waiting {wait_time}s before retry...")
                        await asyncio.sleep(wait_time)
                        continue
                    error_detail = str(e) if str(e) else repr(e)
                    raise ValueError(f"Gemini API connection error: {error_detail}")
                except httpx.RequestError as e:
                    error_detail = str(e) if str(e) else repr(e)
                    raise ValueError(f"Gemini API request error: {error_detail}")
                except Exception as e:
                    error_detail = str(e) if str(e) else f"{type(e).__name__}: {repr(e)}"
                    raise ValueError(f"Gemini streaming error: {error_detail}")
        
        # Should not reach here, but just in case
        raise ValueError(f"Gemini streaming failed after {max_retries} retries")
    
    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """Convert OpenAI tools to Gemini format."""
        if not tools:
            return []
            
        gemini_tools = []
        for tool in tools:
            if tool.get("type") == "function":
                func = tool.get("function", {})
                gemini_tools.append({
                    "name": func.get("name"),
                    "description": func.get("description"),
                    "parameters": func.get("parameters")
                })
        
        return [{"function_declarations": gemini_tools}]

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Convert OpenAI-style messages to Gemini format."""
        contents = []
        
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            tool_calls = msg.get("tool_calls")
            tool_call_id = msg.get("tool_call_id")
            
            parts = []
            
            # Handle text content
            if content:
                if isinstance(content, str):
                    parts.append({"text": content})
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, str):
                            parts.append({"text": item})
                        elif isinstance(item, dict) and item.get("type") == "text":
                            parts.append({"text": item.get("text", "")})
            
            # Handle tool calls (Assistant -> Model)
            if role == "assistant" and tool_calls:
                gemini_role = "model"
                for tool_call in tool_calls:
                    func = tool_call.get("function", {})
                    try:
                        args = json.loads(func.get("arguments", "{}"))
                    except json.JSONDecodeError:
                        args = {}
                    
                    parts.append({
                        "functionCall": {
                            "name": func.get("name"),
                            "args": args
                        }
                    })
            
            # Handle tool results (Tool -> Function)
            elif role == "tool":
                gemini_role = "function"
                # We need to find the function name. OpenAI sends ID, Gemini needs Name.
                # In a real implementation we'd track IDs, but for now we'll try to infer 
                # or just use a placeholder if we can't find it in context.
                # However, Gemini is strict. 
                # Strategy: Look back at previous assistant message to find name for this ID?
                # Since we process sequentially, we can't easily look back here without passing context.
                # BUT, usually the tool result comes right after the call.
                # For this implementation, we'll try to extract name if it was preserved, 
                # or rely on the fact that we might need to store a mapping.
                # Let's assume the CLI might pass 'name' in the tool message if we modified it,
                # but standard OpenAI doesn't.
                
                # Hack: We'll search backwards in 'messages' to find the tool call with this ID
                # This is inefficient but necessary without state
                func_name = "unknown_tool"
                for prev_msg in reversed(messages):
                    if prev_msg.get("role") == "assistant" and prev_msg.get("tool_calls"):
                        for tc in prev_msg["tool_calls"]:
                            if tc.get("id") == tool_call_id:
                                func_name = tc["function"]["name"]
                                break
                        if func_name != "unknown_tool":
                            break
                
                # Gemini expects 'response' object
                parts.append({
                    "functionResponse": {
                        "name": func_name,
                        "response": {"result": content}
                    }
                })
            
            # Regular roles
            elif role == "assistant":
                gemini_role = "model"
            else:
                gemini_role = "user"
            
            if parts:
                contents.append({"role": gemini_role, "parts": parts})
        
        return contents
    
    async def list_models(self) -> list[str]:
        """List available Gemini models."""
        return GEMINI_MODELS

