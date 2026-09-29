// IPv4 and IPv6 addresses and CIDR blocks, for ipBlock peers.

interface Addr {
    v: 4 | 6;
    n: bigint;
}

export function parseIP(text: string): Addr | null {
    const s = text.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
        const parts = s.split('.').map(Number);
        if (parts.some((p) => p > 255)) return null;
        return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
    }
    if (!s.includes(':')) return null;
    // IPv6, with :: and an optional dotted IPv4 tail (::ffff:10.0.0.1).
    let head = s;
    const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        const v4 = parseIP(dotted[2]!);
        if (!v4) return null;
        head = dotted[1]! + (v4.n >> 16n).toString(16) + ':' + (v4.n & 0xffffn).toString(16);
    }
    const halves = head.split('::');
    if (halves.length > 2) return null;
    const words = (part: string): number[] | null => {
        if (!part) return [];
        const out: number[] = [];
        for (const w of part.split(':')) {
            if (!/^[0-9a-fA-F]{1,4}$/.test(w)) return null;
            out.push(parseInt(w, 16));
        }
        return out;
    };
    const left = words(halves[0] ?? '');
    const right = halves.length === 2 ? words(halves[1] ?? '') : [];
    if (!left || !right) return null;
    const known = left.length + right.length;
    if (halves.length === 1 && known !== 8) return null;
    if (known > 8) return null;
    const all = [...left, ...Array(8 - known).fill(0), ...right] as number[];
    return { v: 6, n: all.reduce((acc, w) => (acc << 16n) + BigInt(w), 0n) };
}

/** Whether `ip` is inside `cidr`. A malformed block contains nothing. */
export function inCidr(ip: string, cidr: string): boolean {
    const [base, bitsText] = cidr.split('/');
    const addr = parseIP(ip);
    const net = parseIP(base ?? '');
    if (!addr || !net || addr.v !== net.v) return false;
    const width = addr.v === 4 ? 32 : 128;
    const bits = bitsText === undefined ? width : Number(bitsText);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
    const shift = BigInt(width - bits);
    return addr.n >> shift === net.n >> shift;
}

export function validIP(text: string): boolean {
    return parseIP(text) !== null;
}
