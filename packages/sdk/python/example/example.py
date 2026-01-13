"""Example usage of the OpenCode Python SDK.

This example demonstrates how to use the OpenCode SDK to create sessions
and interact with the OpenCode API.

Best practices aligned with JS SDK documentation:
https://opencode.ai/docs/sdk/
"""

import asyncio
from pathlib import Path

from opencode_sdk import (
    create_opencode,
    create_opencode_async,
    create_opencode_client,
    create_opencode_server,
    suppress_asyncgen_warnings,
)


def sync_example() -> None:
    """Synchronous example of using the OpenCode SDK.

    Demonstrates:
    - Starting a server
    - Creating a client
    - Session management
    - Sending prompts
    """
    # Start a server
    server = create_opencode_server()
    print(f"Server started at {server.url}")

    # Create a client
    client = create_opencode_client(base_url=server.url)

    try:
        # List existing sessions
        sessions = client.session.list()
        if sessions.ok:
            print(f"Found {len(sessions.data or [])} existing sessions")

        # Create a new session
        session = client.session.create(title="Sync Example Session")
        if not session.ok:
            print(f"Failed to create session: {session.error}")
            return

        session_id = session.data["id"]
        print(f"Created session: {session_id}")

        # Send a prompt
        response = client.session.prompt(
            session_id,
            parts=[{"type": "text", "text": "Say hello in one sentence."}],
        )

        if response.ok:
            parts = response.data.get("parts") or []
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
            print(f"Response: {text}")
        else:
            print(f"Failed to send prompt: {response.error}")

    finally:
        client.close()
        server.close()


async def async_example() -> None:
    """Asynchronous example of using the OpenCode SDK.

    Demonstrates:
    - Creating server and client together
    - Async session management
    - Real-time event streaming
    - Sending prompts with model specification
    """
    # Suppress httpx-sse asyncgen warnings on shutdown
    suppress_asyncgen_warnings()

    # Create server and client together (recommended approach)
    opencode = await create_opencode_async()
    print(f"Server started at {opencode.server.url}")

    try:
        # Create a new session
        session = await opencode.client.session.create_async(title="Async Example")
        if not session.ok:
            print(f"Failed to create session: {session.error}")
            return

        session_id = session.data["id"]
        print(f"Created session: {session_id}")

        # Set up event streaming before sending prompt
        collected: list[str] = []
        done = asyncio.Event()

        async def stream_events() -> None:
            """Listen to real-time events from the server."""
            try:
                async for event in opencode.client.event.subscribe_async():
                    payload = event.data
                    if not isinstance(payload, dict):
                        continue

                    event_type = payload.get("type")
                    props = payload.get("properties") or {}

                    # Handle streaming text updates
                    if event_type == "message.part.updated":
                        part = props.get("part") or {}
                        if part.get("sessionID") != session_id:
                            continue
                        delta = props.get("delta")
                        if delta:
                            collected.append(delta)
                            print(delta, end="", flush=True)

                    # Session completed
                    if event_type == "session.idle":
                        if props.get("sessionID") == session_id:
                            print()  # newline after streaming
                            done.set()
                            return
            except asyncio.CancelledError:
                pass

        # Start event listener
        listener = asyncio.create_task(stream_events())

        # Send a prompt (model is optional - uses default if not specified)
        print("Sending prompt...")
        response = await opencode.client.session.prompt_async(
            session_id,
            parts=[{"type": "text", "text": "Hello! What can you help me with today?"}],
        )

        if not response.ok:
            print(f"Failed to send prompt: {response.error}")
            listener.cancel()
            return

        # Check for message-level errors
        info = response.data.get("info") if response.data else None
        if info and info.get("error"):
            print(f"Message error: {info['error']}")
            listener.cancel()
            return

        # Wait for streaming to complete
        try:
            await asyncio.wait_for(done.wait(), timeout=120)
        except asyncio.TimeoutError:
            print("\nStream timeout")
        finally:
            listener.cancel()
            try:
                await listener
            except asyncio.CancelledError:
                pass

        # Show final result
        if collected:
            print(f"\nCollected {len(collected)} stream chunks")

    finally:
        await opencode.aclose()


async def event_subscribe_example() -> None:
    """Example of subscribing to events (matches JS SDK pattern).

    JS SDK equivalent:
        const events = await client.event.subscribe()
        for await (const event of events.stream) {
            console.log("Event:", event.type, event.properties)
        }
    """
    opencode = await create_opencode_async()
    print(f"Server started at {opencode.server.url}")

    try:
        print("Listening for events (press Ctrl+C to stop)...")
        async for event in opencode.client.event.subscribe_async():
            payload = event.data
            if isinstance(payload, dict):
                event_type = payload.get("type", "unknown")
                props = payload.get("properties", {})
                print(f"Event: {event_type}")
                if props:
                    print(f"  Properties: {props}")
    except KeyboardInterrupt:
        print("\nStopped listening")
    finally:
        await opencode.aclose()


async def batch_example() -> None:
    """Example of processing multiple files in parallel.

    Demonstrates:
    - Creating multiple sessions
    - Parallel processing with asyncio.gather
    - File attachments in prompts
    """
    opencode = await create_opencode_async()
    print(f"Server started at {opencode.server.url}")

    try:
        # Find Python files to process
        files = list(Path(".").glob("*.py"))[:3]
        if not files:
            print("No Python files found")
            return

        print(f"Processing {len(files)} files in parallel...")

        async def process_file(file: Path) -> str:
            """Process a single file and return summary."""
            session = await opencode.client.session.create_async(
                title=f"Analyze {file.name}"
            )
            if not session.ok:
                return f"Failed to create session for {file}"

            response = await opencode.client.session.prompt_async(
                session.data["id"],
                parts=[
                    {
                        "type": "file",
                        "mime": "text/plain",
                        "url": f"file://{file.absolute()}",
                    },
                    {"type": "text", "text": "Summarize this file in one sentence."},
                ],
            )

            if response.ok:
                parts = response.data.get("parts") or []
                text = "".join(
                    p.get("text", "") for p in parts if p.get("type") == "text"
                )
                return f"{file.name}: {text}"
            return f"{file.name}: Failed - {response.error}"

        results = await asyncio.gather(*[process_file(f) for f in files])
        for result in results:
            print(result)

    finally:
        await opencode.aclose()


async def client_only_example() -> None:
    """Example of connecting to an existing server.

    JS SDK equivalent:
        const client = createOpencodeClient({
            baseUrl: "http://localhost:4096",
        })

    Use this when you already have a running opencode instance.
    """
    # Connect to existing server (must be running)
    client = create_opencode_client(base_url="http://localhost:4096")

    try:
        # Check server health
        health = client.global_.health()
        if health.ok:
            print(f"Connected to server, version: {health.data.get('version')}")
        else:
            print("Server not available")
            return

        # List sessions
        sessions = client.session.list()
        if sessions.ok:
            print(f"Found {len(sessions.data or [])} sessions")

    finally:
        client.close()


if __name__ == "__main__":
    print("=" * 60)
    print("OpenCode Python SDK Examples")
    print("=" * 60)

    # Run the async example by default
    print("\n--- Async Example ---\n")
    asyncio.run(async_example())

    # Uncomment to run other examples:
    # print("\n--- Sync Example ---\n")
    # sync_example()

    # print("\n--- Batch Example ---\n")
    # asyncio.run(batch_example())

    # print("\n--- Event Subscribe Example ---\n")
    # asyncio.run(event_subscribe_example())

    # print("\n--- Client Only Example ---\n")
    # asyncio.run(client_only_example())
