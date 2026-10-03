// The numbers at the top of the matrix page: how isolated each namespace is,
// how much of the matrix is open, and the findings by tone. No DOM here.

import type { Finding, Tone } from './findings';
import type { Cell, Group } from './groups';
import type { NetworkPolicy, Pod } from './kube';
import type { World } from './policy';
import { matches } from './selector';

/** Isolated: every workload is selected for ingress. Open: no workload is selected for anything. */
export type Posture = 'isolated' | 'partial' | 'open';

export interface NsPosture {
    namespace: string;
    workloads: number;
    /** Workloads some policy selects for ingress. */
    ingress: number;
    /** Workloads some policy selects for egress. */
    egress: number;
    /** NetworkPolicies that live in the namespace. */
    policies: number;
    state: Posture;
}

export function posture(groups: Group[], policies: NetworkPolicy[], world: World): NsPosture[] {
    const byNs = new Map<string, Group[]>();
    for (const g of groups) byNs.set(g.namespace, [...(byNs.get(g.namespace) ?? []), g]);
    const out: NsPosture[] = [];
    for (const [namespace, gs] of byNs) {
        let ingress = 0;
        let egress = 0;
        for (const g of gs) {
            if (world.selecting(g.rep, 'ingress').length) ingress++;
            if (world.selecting(g.rep, 'egress').length) egress++;
        }
        const state: Posture = ingress === gs.length ? 'isolated' : ingress === 0 && egress === 0 ? 'open' : 'partial';
        out.push({ namespace, workloads: gs.length, ingress, egress, policies: policies.filter((p) => (p.metadata.namespace ?? '') === namespace).length, state });
    }
    // Wide open first: that is what needs looking at.
    const rank: Record<Posture, number> = { open: 0, partial: 1, isolated: 2 };
    return out.sort((a, b) => rank[a.state] - rank[b.state] || a.namespace.localeCompare(b.namespace));
}

export function postureCounts(list: NsPosture[]): Record<Posture, number> {
    const out: Record<Posture, number> = { isolated: 0, partial: 0, open: 0 };
    for (const p of list) out[p.state]++;
    return out;
}

export interface Tally {
    all: number;
    some: number;
    none: number;
    total: number;
}

export function tally(cells: Iterable<Cell>): Tally {
    const t: Tally = { all: 0, some: 0, none: 0, total: 0 };
    for (const c of cells) {
        t[c]++;
        t.total++;
    }
    return t;
}

/** A whole-number percentage, 0 when there is nothing to divide by. */
export function percent(n: number, total: number): number {
    return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function toneCounts(list: Finding[]): Record<Tone, number> {
    const out: Record<Tone, number> = { error: 0, warn: 0, info: 0 };
    for (const f of list) out[f.tone]++;
    return out;
}

/** Policies whose podSelector matches no pod in their namespace. */
export function idlePolicies(pods: Pod[], policies: NetworkPolicy[]): NetworkPolicy[] {
    return policies.filter((np) => {
        const ns = np.metadata.namespace ?? '';
        return !pods.some((p) => (p.metadata.namespace ?? '') === ns && matches(np.spec?.podSelector ?? {}, p.metadata.labels));
    });
}

export interface Arc {
    key: Cell;
    /** Start and length as fractions of the circle, 0..1. */
    start: number;
    length: number;
}

/** The slices of a donut for a tally, in the order all, some, none; empty slices left out. */
export function arcs(t: Tally): Arc[] {
    if (!t.total) return [];
    const out: Arc[] = [];
    let at = 0;
    for (const key of ['all', 'some', 'none'] as Cell[]) {
        const length = t[key] / t.total;
        if (length > 0) out.push({ key, start: at, length });
        at += length;
    }
    return out;
}
