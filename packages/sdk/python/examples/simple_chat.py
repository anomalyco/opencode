from __future__ import annotations

from opencode_sdk import create_opencode


def main() -> None:
    client, server = create_opencode(port=4096)

    try:
        health = client.health()
        print(f"Server: {health}")

        session = client.session_create()
        sid = session["id"]
        print(f"Session: {sid}")

        prompt = "What is the capital of France? Answer in one word."
        client.session_prompt(sid, prompt)
        print(f"Prompt sent: {prompt}")

        messages = client.session_messages(sid)
        for msg in messages:
            role = msg.get("role", "?")
            content = str(msg.get("content", ""))
            print(f"  [{role}]: {content[:200]}")

    finally:
        server.close()
        print("Server stopped")


if __name__ == "__main__":
    main()
