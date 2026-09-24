// PNG iTXt container for this extension's portable persona/AU data.
const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const KEYWORD = new TextEncoder().encode('st-persona-au-manager');
const TYPE = new TextEncoder().encode('iTXt');
const MAX_METADATA = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
});

function u32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function put32(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value);
}

function validSignature(bytes) {
    return bytes.length >= 8 && SIGNATURE.every((value, i) => bytes[i] === value);
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
}

function* chunks(bytes) {
    if (!validSignature(bytes)) throw new Error('PNG signature missing');
    for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = u32(bytes, offset);
        const end = offset + 12 + length;
        if (end > bytes.length) throw new Error('Truncated PNG chunk');
        const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
        yield { offset, end, length, type, data: bytes.subarray(offset + 8, offset + 8 + length) };
        offset = end;
        if (type === 'IEND') return;
    }
    throw new Error('PNG end chunk missing');
}

export function embedPersonaData(png, payload) {
    if (!(png instanceof Uint8Array)) throw new TypeError('PNG bytes required');
    const list = [...chunks(png)];
    if (list[0]?.type !== 'IHDR' || list.at(-1)?.type !== 'IEND') throw new Error('Invalid PNG structure');
    const json = encoder.encode(JSON.stringify(payload));
    if (json.length > MAX_METADATA) throw new Error('AU data exceeds the 16MB PNG metadata limit');
    // iTXt: keyword NUL, compression flag 0, method 0, language NUL, translated keyword NUL, UTF-8 text.
    const data = new Uint8Array(KEYWORD.length + 5 + json.length);
    data.set(KEYWORD);
    data.set(json, KEYWORD.length + 5);
    const chunk = new Uint8Array(data.length + 12);
    put32(chunk, 0, data.length);
    chunk.set(TYPE, 4);
    chunk.set(data, 8);
    put32(chunk, chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
    const insertAt = list.at(-1).offset;
    const result = new Uint8Array(png.length + chunk.length);
    result.set(png.subarray(0, insertAt));
    result.set(chunk, insertAt);
    result.set(png.subarray(insertAt), insertAt + chunk.length);
    return result;
}

export function readPersonaData(png) {
    if (!(png instanceof Uint8Array)) throw new TypeError('PNG bytes required');
    for (const chunk of chunks(png)) {
        if (chunk.type !== 'iTXt' || chunk.length > MAX_METADATA + KEYWORD.length + 5) continue;
        const data = chunk.data;
        if (!KEYWORD.every((value, index) => data[index] === value) || data[KEYWORD.length] !== 0) continue;
        if (data[KEYWORD.length + 1] !== 0 || data[KEYWORD.length + 2] !== 0 || data[KEYWORD.length + 3] !== 0 || data[KEYWORD.length + 4] !== 0) throw new Error('Unsupported PNG metadata encoding');
        if (crc32(png.subarray(chunk.offset + 4, chunk.end - 4)) !== u32(png, chunk.end - 4)) throw new Error('Damaged PNG metadata');
        const parsed = JSON.parse(decoder.decode(data.subarray(KEYWORD.length + 5)));
        if (parsed?.format !== 'st-persona-au-manager' || parsed?.version !== 1 || !Array.isArray(parsed?.versions)) throw new Error('Unsupported AU PNG format');
        return parsed;
    }
    throw new Error('AU metadata not found');
}
