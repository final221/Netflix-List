import { createList } from '../../src/list/list.js';

// Owner fixtures retain their supplied record identities. Material follows the
// real public transfer; application tests separately exercise frozen membership.
export function publishGrid(grid, options) {
    if (options.readMaterial) return grid.publish(options);
    const transfer = createList({}).prepareRecords(options.items);
    return grid.publish({ ...options,
        readMaterial: (_item, index) => transfer.readMaterial(transfer.records[index]),
        releaseMaterial: transfer.release });
}
export function insertGrid(grid, item, options = {}) {
    if (options.material || options.releaseMaterial) return grid.insertCard(item, options);
    const transfer = createList({}).prepareRecords([item]);
    return grid.insertCard(item, { ...options, material: transfer.readMaterial(transfer.records[0]),
        releaseMaterial: transfer.release });
}
