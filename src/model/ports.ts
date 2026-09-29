// Sets of ports, per protocol, as ranges. "Any port" is every port of every
// protocol; nothing is the empty set.

export type Protocol = 'TCP' | 'UDP' | 'SCTP';
export const PROTOCOLS: Protocol[] = ['TCP', 'UDP', 'SCTP'];

export interface Range {
    protocol: Protocol;
    from: number;
    to: number;
}

export type PortSet = Range[];

export const ALL: PortSet = PROTOCOLS.map((protocol) => ({ protocol, from: 1, to: 65535 }));
export const NONE: PortSet = [];

export function protocolOf(text: string | undefined): Protocol {
    const up = (text ?? 'TCP').toUpperCase();
    return up === 'UDP' || up === 'SCTP' ? up : 'TCP';
}

/** Sorted by protocol and start, with overlapping and touching ranges merged. */
export function normalize(set: PortSet): PortSet {
    const out: Range[] = [];
    const sorted = [...set]
        .filter((r) => r.from <= r.to)
        .sort((a, b) => PROTOCOLS.indexOf(a.protocol) - PROTOCOLS.indexOf(b.protocol) || a.from - b.from);
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && last.protocol === r.protocol && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
        else out.push({ ...r });
    }
    return out;
}

export function union(a: PortSet, b: PortSet): PortSet {
    return normalize([...a, ...b]);
}

export function intersect(a: PortSet, b: PortSet): PortSet {
    const out: Range[] = [];
    for (const x of a) {
        for (const y of b) {
            if (x.protocol !== y.protocol) continue;
            const from = Math.max(x.from, y.from);
            const to = Math.min(x.to, y.to);
            if (from <= to) out.push({ protocol: x.protocol, from, to });
        }
    }
    return normalize(out);
}

export function isAll(set: PortSet): boolean {
    const n = normalize(set);
    return PROTOCOLS.every((p) => n.some((r) => r.protocol === p && r.from <= 1 && r.to >= 65535));
}

export function isEmpty(set: PortSet): boolean {
    return set.length === 0;
}

export function contains(set: PortSet, protocol: Protocol, port: number): boolean {
    return set.some((r) => r.protocol === protocol && r.from <= port && port <= r.to);
}

/** "any port", "nothing", or "TCP 80, 443, 8000–8100 · UDP 53". */
export function describe(set: PortSet): string {
    if (isEmpty(set)) return 'nothing';
    if (isAll(set)) return 'any port';
    const parts: string[] = [];
    for (const p of PROTOCOLS) {
        const ranges = set.filter((r) => r.protocol === p);
        if (!ranges.length) continue;
        if (ranges.length === 1 && ranges[0]!.from <= 1 && ranges[0]!.to >= 65535) {
            parts.push(`any ${p} port`);
            continue;
        }
        parts.push(`${p} ${ranges.map((r) => (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`)).join(', ')}`);
    }
    return parts.join(' · ');
}
