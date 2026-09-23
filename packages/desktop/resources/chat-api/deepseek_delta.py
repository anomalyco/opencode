"""Apply the web stream's SET/APPEND/BATCH patches and emit answer text."""
import copy


class DeltaDecoder:
    def __init__(self):
        self.state = {}
        self.path = ''
        self.operation = 'SET'
        self.emitted = ''

    def _apply(self, path, op, value):
        if op == 'BATCH':
            for patch in value:
                child = '/'.join(p for p in (path, patch.get('p', '')) if p)
                self._apply(child, patch.get('o', 'SET'), patch.get('v'))
            return
        if not path:
            if isinstance(value, dict):
                self.state = copy.deepcopy(value)
            return
        keys = path.strip('/').split('/')
        node = self.state
        for part in keys[:-1]:
            node = node[int(part)] if isinstance(node, list) else node.setdefault(part, {})
        key = int(keys[-1]) if isinstance(node, list) else keys[-1]
        if op == 'APPEND':
            previous = node[key] if isinstance(node, list) else node.get(key)
            node[key] = (previous or type(value)()) + copy.deepcopy(value)
        else:
            node[key] = copy.deepcopy(value)

    def feed(self, patch):
        if not isinstance(patch, dict):
            return ''
        self.path = patch.get('p', self.path)
        self.operation = patch.get('o', self.operation)
        self._apply(self.path, self.operation, patch.get('v'))
        text = self.snapshot()
        delta = text[len(self.emitted):] if text.startswith(self.emitted) else ''
        self.emitted = text
        return delta

    def snapshot(self):
        response = self.state.get('response', {})
        if isinstance(response, str):
            return response
        return ''.join(f.get('content', '') for f in response.get('fragments', [])
                       if f.get('type') == 'RESPONSE')
