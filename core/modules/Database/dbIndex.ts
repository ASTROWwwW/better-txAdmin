import type { DatabaseActionType, DatabasePlayerType } from './databaseTypes';

type Entry<T> = { item: T; pos: number };

const addToBucket = <T>(map: Map<string, Entry<T>[]>, key: string, entry: Entry<T>) => {
    const bucket = map.get(key);
    if (bucket) {
        bucket.push(entry);
    } else {
        map.set(key, [entry]);
    }
};


/**
 * The lowdb arrays stay the source of truth. An index is only trusted while it was built from the
 * same array object with the same length, and every entry it returns is checked against the array
 * position it came from, so an array changed behind its back (removals, replaced array) is rebuilt.
 */
export class PlayersIndex {
    #source: DatabasePlayerType[] | undefined;
    #length = -1;
    readonly #byLicense = new Map<string, Entry<DatabasePlayerType>>();

    #rebuild(source: DatabasePlayerType[]) {
        this.#byLicense.clear();
        source.forEach((item, pos) => {
            if (!this.#byLicense.has(item.license)) this.#byLicense.set(item.license, { item, pos });
        });
        this.#source = source;
        this.#length = source.length;
    }

    /** Same result as lodash find({ license }): the first player of the array with that license */
    find(source: DatabasePlayerType[], license: string): DatabasePlayerType | undefined {
        if (this.#source !== source || this.#length !== source.length) this.#rebuild(source);
        let entry = this.#byLicense.get(license);
        if (entry && source[entry.pos] !== entry.item) {
            this.#rebuild(source);
            entry = this.#byLicense.get(license);
        }
        return entry?.item;
    }

    push(source: DatabasePlayerType[], player: DatabasePlayerType) {
        const inSync = this.#source === source && this.#length === source.length;
        source.push(player);
        if (!inSync) return;
        this.#length = source.length;
        if (!this.#byLicense.has(player.license)) {
            this.#byLicense.set(player.license, { item: player, pos: source.length - 1 });
        }
    }
}


export class ActionsIndex {
    #source: DatabaseActionType[] | undefined;
    #length = -1;
    readonly #byIdentifier = new Map<string, Entry<DatabaseActionType>[]>();
    readonly #byHwid = new Map<string, Entry<DatabaseActionType>[]>();

    #addEntry(item: DatabaseActionType, pos: number) {
        const entry = { item, pos };
        if (Array.isArray(item.ids)) {
            for (const id of item.ids) addToBucket(this.#byIdentifier, id, entry);
        }
        if ('hwids' in item && Array.isArray(item.hwids)) {
            for (const hwid of item.hwids) addToBucket(this.#byHwid, hwid, entry);
        }
    }

    #rebuild(source: DatabaseActionType[]) {
        this.#byIdentifier.clear();
        this.#byHwid.clear();
        source.forEach((item, pos) => this.#addEntry(item, pos));
        this.#source = source;
        this.#length = source.length;
    }

    /**
     * Every action that shares an identifier with `ids`, or a hwid with `hwids` when given, in array order.
     * It can hold more than the exact answer (a wiped hwid list), never less: callers apply their own filters.
     */
    candidates(source: DatabaseActionType[], ids: string[], hwids?: string[]): DatabaseActionType[] {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (this.#source !== source || this.#length !== source.length) this.#rebuild(source);
            const found = new Map<number, DatabaseActionType>();
            let stale = false;
            const collect = (map: Map<string, Entry<DatabaseActionType>[]>, keys: string[]) => {
                for (const key of keys) {
                    for (const entry of map.get(key) ?? []) {
                        if (source[entry.pos] !== entry.item) stale = true;
                        found.set(entry.pos, entry.item);
                    }
                }
            };
            collect(this.#byIdentifier, ids);
            if (hwids) collect(this.#byHwid, hwids);
            if (!stale) {
                return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
            }
            this.#source = undefined;
        }
        return source;
    }

    push(source: DatabaseActionType[], action: DatabaseActionType) {
        const inSync = this.#source === source && this.#length === source.length;
        source.push(action);
        if (!inSync) return;
        this.#length = source.length;
        this.#addEntry(action, source.length - 1);
    }
}
