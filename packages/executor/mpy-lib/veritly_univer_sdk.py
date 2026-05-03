# MicroPython bundle: import surface compatible with CPython veritly_univer_sdk names.
# Async WebSocket relay client is not implemented on MicroPython yet.


class RangeRect:
    __slots__ = ("startRow", "endRow", "startColumn", "endColumn")

    def __init__(self, startRow=0, endRow=0, startColumn=0, endColumn=0):
        self.startRow = int(startRow)
        self.endRow = int(endRow)
        self.startColumn = int(startColumn)
        self.endColumn = int(endColumn)


class UniverSDK:
    __slots__ = ("_url",)

    def __init__(self, ws_url=None):
        self._url = ws_url

    def __repr__(self):
        return "UniverSDK"
