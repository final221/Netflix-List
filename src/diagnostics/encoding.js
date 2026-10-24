// Reversible storage for already projected JSON facts; no diagnostic selection occurs here.
const FORMAT = 'shared-json-v1';
export function utf8Bytes(text) {
    let bytes = 0;
    for (const char of text) {
        const point = char.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}

export function encodeDiagnostic(value) {
    const plain = JSON.stringify(value), plainBytes = utf8Bytes(plain);
    const reserved = value?.$diagnostic === FORMAT;
    if (plainBytes < 4096 && !reserved) return { text: plain, plainBytes, bytes: plainBytes, packed: false };
    const strings = new Map(), schemas = [], values = [], schemaIds = new Map(), valueIds = new Map();
    function count(item) {
        if (typeof item === 'string') strings.set(item, (strings.get(item) || 0) + 1);
        else if (item && typeof item === 'object') Object.values(item).forEach(count);
    }
    count(value);
    function intern(item) {
        const signature = JSON.stringify(item);
        if (!valueIds.has(signature)) { valueIds.set(signature, values.length); values.push(item); }
        return [valueIds.get(signature)];
    }
    function encode(item) {
        if (typeof item === 'string') return item.length >= 4 && strings.get(item) > 1 ? intern(item) : item;
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item)) return intern([null, item.map(encode)]);
        const keys = Object.keys(item), signature = JSON.stringify(keys);
        if (!schemaIds.has(signature)) { schemaIds.set(signature, schemas.length); schemas.push(keys); }
        return intern([schemaIds.get(signature), keys.map(key => encode(item[key]))]);
    }
    const root = encode(value), text = JSON.stringify({ $diagnostic: FORMAT, schemas, values, root });
    const bytes = utf8Bytes(text);
    return reserved || bytes < plainBytes * .9 ? { text, plainBytes, bytes, packed: true }
        : { text: plain, plainBytes, bytes: plainBytes, packed: false };
}

// References are [index]; values contain strings or [schema, members], with null schema for arrays.
export function decodeDiagnostic(value, { maxNodes = 1000000 } = {}) {
    if (!value || value.$diagnostic !== FORMAT) return value;
    const { schemas, values, root } = value;
    if (!Array.isArray(schemas) || !Array.isArray(values)) throw Error('Invalid diagnostic tables');
    let nodes = 0;
    const active = new Set();
    function decode(item, depth = 0) {
        if (++nodes > maxNodes || depth > 100) throw Error('Diagnostic expansion limit exceeded');
        if (!Array.isArray(item)) {
            if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return item;
            throw Error('Invalid diagnostic value');
        }
        const index = item[0];
        if (item.length !== 1 || !Number.isSafeInteger(index) || index < 0 || index >= values.length || active.has(index)) throw Error('Invalid diagnostic reference');
        active.add(index);
        try {
            const stored = values[index];
            if (typeof stored === 'string') return stored;
            if (!Array.isArray(stored) || stored.length !== 2 || !Array.isArray(stored[1])) throw Error('Invalid diagnostic record');
            const [schema, members] = stored;
            const decoded = members.map(member => decode(member, depth + 1));
            if (schema === null) return decoded;
            const keys = schemas[schema];
            if (!Number.isSafeInteger(schema) || schema < 0 || !Array.isArray(keys) || keys.length !== members.length ||
                keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) throw Error('Invalid diagnostic schema');
            return Object.fromEntries(keys.map((key, offset) => [key, decoded[offset]]));
        } finally { active.delete(index); }
    }
    return decode(root);
}

export const parseDiagnostic = text => decodeDiagnostic(JSON.parse(text));
