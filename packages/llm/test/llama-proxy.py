#!/usr/bin/env python3
"""
Proxy for llama-server that delays responses with thinking/reasoning prompts.

Normal requests are proxied through immediately.
Requests containing "think" or "reason" in the messages are delayed by 6 minutes
before the first token arrives, simulating a long-thinking LLM.

Usage:
    python3 proxy.py --upstream http://192.168.1.212:8081 --port 8082

    Then point lildax at http://localhost:8082/v1
"""

import argparse
import asyncio
import json
import time
import logging
from aiohttp import web, ClientSession, ClientTimeout

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("proxy")

DELAY_SECONDS = 6 * 60  # 6 minutes

THINK_KEYWORDS = ["think", "reason", "размышлен", "рассужд", "цепочк", "step by step", "let's think"]


def is_thinking_request(body: dict) -> bool:
    """Check if the request likely triggers long thinking."""
    messages = body.get("messages", [])
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            content = " ".join(p.get("text", "") for p in content if isinstance(p, dict))
        if not isinstance(content, str):
            continue
        lower = content.lower()
        for kw in THINK_KEYWORDS:
            if kw in lower:
                return True
    return False


async def proxy_handler(request: web.Request) -> web.StreamResponse:
    upstream = request.app["upstream_url"]
    delay_seconds = request.app["delay_seconds"]
    path = request.path
    url = f"{upstream}{path}"
    if request.query_string:
        url += f"?{request.query_string}"

    body_bytes = await request.read()
    thinking = False

    if request.method == "POST" and body_bytes:
        try:
            body_json = json.loads(body_bytes)
            thinking = is_thinking_request(body_json)
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "transfer-encoding")}

    log.info(f">>> {request.method} {path} thinking={thinking}")

    if thinking:
        log.info(f"    Thinking request detected, will delay response by {delay_seconds}s")

    session: ClientSession = request.app["http_session"]
    started = time.monotonic()

    try:
        timeout = ClientTimeout(total=None, sock_connect=30, sock_read=None)
        async with session.request(
            request.method,
            url,
            headers=headers,
            data=body_bytes,
            timeout=timeout,
        ) as upstream_resp:
            resp_headers = {k: v for k, v in upstream_resp.headers.items() if k.lower() not in ("transfer-encoding", "connection")}

            if thinking and upstream_resp.status == 200:
                content_type = upstream_resp.headers.get("content-type", "")

                if "text/event-stream" in content_type:
                    response = web.StreamResponse(
                        status=upstream_resp.status,
                        headers=resp_headers,
                    )
                    await response.prepare(request)

                    first_chunk = True
                    async for chunk in upstream_resp.content.iter_any():
                        if first_chunk:
                            elapsed = time.monotonic() - started
                            wait_time = max(0, delay_seconds - elapsed)
                            if wait_time > 0:
                                log.info(f"    Waiting {wait_time:.0f}s before sending first chunk...")
                                await asyncio.sleep(wait_time)
                            first_chunk = False
                            log.info(f"    First chunk sent after {time.monotonic() - started:.1f}s")
                        await response.write(chunk)

                    await response.write_eof()
                    return response

                elif "application/json" in content_type:
                    raw = await upstream_resp.read()
                    elapsed = time.monotonic() - started
                    wait_time = max(0, delay_seconds - elapsed)
                    if wait_time > 0:
                        log.info(f"    Waiting {wait_time:.0f}s before returning JSON response...")
                        await asyncio.sleep(wait_time)
                    log.info(f"    Response sent after {time.monotonic() - started:.1f}s")
                    return web.Response(
                        status=upstream_resp.status,
                        headers=resp_headers,
                        body=raw,
                    )

            # Non-thinking or non-200: stream through immediately
            response = web.StreamResponse(
                status=upstream_resp.status,
                headers=resp_headers,
            )
            await response.prepare(request)
            async for chunk in upstream_resp.content.iter_any():
                await response.write(chunk)
            await response.write_eof()
            return response

    except Exception as e:
        elapsed = time.monotonic() - started
        log.error(f"    Proxy error after {elapsed:.1f}s: {e}")
        return web.Response(status=502, text=f"Proxy error: {e}")


async def health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "delay_seconds": DELAY_SECONDS})


async def init_app(upstream_url: str, delay_seconds: int) -> web.Application:
    app = web.Application()
    app["upstream_url"] = upstream_url.rstrip("/")
    app["delay_seconds"] = delay_seconds
    app["http_session"] = ClientSession()
    app.router.add_route("*", "/health", health)
    app.router.add_route("*", "/{path:.*}", proxy_handler)

    async def cleanup(app):
        await app["http_session"].close()

    app.on_cleanup.append(cleanup)
    return app


def main():
    parser = argparse.ArgumentParser(description="llama-server proxy with thinking delay")
    parser.add_argument("--upstream", default="http://localhost:8081", help="Upstream llama-server URL")
    parser.add_argument("--port", type=int, default=8082, help="Local proxy port")
    parser.add_argument("--delay", type=int, default=DELAY_SECONDS, help="Delay in seconds for thinking requests")
    args = parser.parse_args()

    log.info(f"Proxy listening on port {args.port}")
    log.info(f"Upstream: {args.upstream}")
    log.info(f"Thinking delay: {args.delay}s ({args.delay / 60:.0f} min)")

    web.run_app(init_app(args.upstream, args.delay), port=args.port, print=None)


if __name__ == "__main__":
    main()
