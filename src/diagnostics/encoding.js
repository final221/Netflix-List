// Reversible storage for already projected JSON facts; no diagnostic selection occurs here.
const FORMAT = 'shared-json-v1';

export function utf8Bytes(text) {
    let bytes = 0;
    for (const char of text) {
        const point = char.codePointAt(0);
        if (point <= 0x7f) bytes += 1;
        else if (point <= 0x7ff) bytes += 2;
        else if (point <= 0xffff) bytes += 3;
        else bytes += 4;
    }
    return bytes;
}

export function encodeDiagnostic(value) {
    const plain = JSON.stringify(value);
    const plainBytes = utf8Bytes(plain);
    const reserved = value?.$diagnostic === FORMAT;
    if (plainBytes < 4096 && !reserved) {
        return { text: plain, plainBytes, bytes: plainBytes, packed: false };
    }

    const stringOccurrences = new Map();
    const schemaTable = [], valueTable = [];
    const schemaIndices = new Map(), valueIndices = new Map();

    function countStrings(item) {
        if (typeof item === 'string') {
            stringOccurrences.set(item, (stringOccurrences.get(item) || 0) + 1);
        } else if (item && typeof item === 'object') {
            Object.values(item).forEach(countStrings);
        }
    }
    countStrings(value);

    // Every encoded array is a reference [index]. Original arrays live in table records.
    function intern(item) {
        const signature = JSON.stringify(item);
        if (!valueIndices.has(signature)) {
            valueIndices.set(signature, valueTable.length);
            valueTable.push(item);
        }
        return [valueIndices.get(signature)];
    }

    function encode(item) {
        if (typeof item === 'string') {
            return item.length >= 4 && stringOccurrences.get(item) > 1 ? intern(item) : item;
        }
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item)) return intern([null, item.map(encode)]);

        const keys = Object.keys(item);
        const signature = JSON.stringify(keys);
        if (!schemaIndices.has(signature)) {
            schemaIndices.set(signature, schemaTable.length);
            schemaTable.push(keys);
        }
        return intern([schemaIndices.get(signature), keys.map(key => encode(item[key]))]);
    }

    const root = encode(value);
    const text = JSON.stringify({ $diagnostic: FORMAT, schemas: schemaTable, values: valueTable, root });
    const bytes = utf8Bytes(text);
    // Marker-like input must be wrapped even when packing would not save space.
    if (reserved || bytes < plainBytes * .9) return { text, plainBytes, bytes, packed: true };
    return { text: plain, plainBytes, bytes: plainBytes, packed: false };
}

// Table entries are strings or [schema, members]; null schema identifies an original array.
export function decodeDiagnostic(value, { maxNodes = 1000000 } = {}) {
    if (!value || value.$diagnostic !== FORMAT) return value;
    const { schemas: schemaTable, values: valueTable, root } = value;
    if (!Array.isArray(schemaTable) || !Array.isArray(valueTable)) {
        throw Error('Invalid diagnostic tables');
    }

    let expandedNodes = 0;
    const expanding = new Set();

    function referenceIndex(reference) {
        const index = reference[0];
        if (reference.length !== 1 || !Number.isSafeInteger(index)) {
            throw Error('Invalid diagnostic reference');
        }
        if (index < 0 || index >= valueTable.length || expanding.has(index)) {
            throw Error('Invalid diagnostic reference');
        }
        return index;
    }

    function objectKeys(schemaIndex, memberCount) {
        const keys = schemaTable[schemaIndex];
        if (!Number.isSafeInteger(schemaIndex) || schemaIndex < 0 || !Array.isArray(keys)) {
            throw Error('Invalid diagnostic schema');
        }
        if (keys.length !== memberCount || keys.some(key => typeof key !== 'string')) {
            throw Error('Invalid diagnostic schema');
        }
        if (new Set(keys).size !== keys.length) throw Error('Invalid diagnostic schema');
        return keys;
    }

    function decode(item, depth = 0) {
        if (++expandedNodes > maxNodes || depth > 100) throw Error('Diagnostic expansion limit exceeded');
        if (!Array.isArray(item)) {
            if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return item;
            throw Error('Invalid diagnostic value');
        }

        const index = referenceIndex(item);
        expanding.add(index);
        try {
            const stored = valueTable[index];
            if (typeof stored === 'string') return stored;
            if (!Array.isArray(stored) || stored.length !== 2 || !Array.isArray(stored[1])) {
                throw Error('Invalid diagnostic record');
            }

            const [schemaIndex, members] = stored;
            const decoded = members.map(member => decode(member, depth + 1));
            if (schemaIndex === null) return decoded;
            const keys = objectKeys(schemaIndex, members.length);
            return Object.fromEntries(keys.map((key, offset) => [key, decoded[offset]]));
        } finally {
            // Reusing a reference is valid; only references on the current path form a cycle.
            expanding.delete(index);
        }
    }
    return decode(root);
}

export const parseDiagnostic = text => decodeDiagnostic(JSON.parse(text));
