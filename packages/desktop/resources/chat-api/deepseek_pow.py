"""Run the site's versioned DeepSeekHashV1 module locally."""
import hashlib
import struct
from pathlib import Path

import wasmtime

ASSET = Path(__file__).parent / 'assets' / 'sha3_wasm_bg.7b9ca65ddd.wasm'
DIGEST = 'b3fca8cc072c1defbd60c02266a8e48bd307a1804aaff4314900aea720e72f7d'


def solve(challenge):
    if challenge.get('algorithm') != 'DeepSeekHashV1':
        raise ValueError('Unsupported PoW algorithm')
    binary = ASSET.read_bytes()
    if hashlib.sha256(binary).hexdigest() != DIGEST:
        raise ValueError('PoW WASM checksum mismatch')
    engine = wasmtime.Engine()
    store = wasmtime.Store(engine)
    module = wasmtime.Module(engine, binary)
    exports = wasmtime.Instance(store, module, []).exports(store)
    memory = exports['memory']
    alloc = exports['__wbindgen_export_0']
    def put(value):
        encoded = value.encode('utf-8')
        pointer = alloc(store, len(encoded), 1)
        memory.write(store, encoded, pointer)
        return pointer, len(encoded)
    expire = challenge.get('expire_at', challenge.get('expireAt'))
    if expire is None or int(challenge['difficulty']) <= 0:
        raise ValueError('Invalid PoW challenge')
    prefix = f"{challenge['salt']}_{expire}_"
    target_ptr, target_len = put(challenge['challenge'])
    prefix_ptr, prefix_len = put(prefix)
    result = exports['__wbindgen_add_to_stack_pointer'](store, -16)
    exports['wasm_solve'](store, result, target_ptr, target_len,
                          prefix_ptr, prefix_len, float(challenge['difficulty']))
    data = memory.read(store, result, result + 16)
    if not struct.unpack_from('<i', data)[0]:
        raise ValueError('No PoW solution in challenge range')
    return int(struct.unpack_from('<d', data, 8)[0])
