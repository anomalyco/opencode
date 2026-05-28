from __future__ import annotations


class OpencodeError(Exception):
    def __init__(self, message: str, *, status: int | None = None, body: object = None):
        self.status = status
        self.body = body
        super().__init__(message)
