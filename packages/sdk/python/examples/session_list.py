from opencode_ai import OpenCodeClient

client = OpenCodeClient()
print([s.id for s in client.list_sessions() or []])
