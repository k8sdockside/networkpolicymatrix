// Pods grouped by the workload that runs them, and the matrix between groups.
//
// The matrix is worked out from one pod of each workload -- its first
// running one. Pods of one workload share their labels and ports, which is
// all a policy looks at, so the answer is the same for all of them; only an
// ipBlock that picks some of a workload's pod IPs and not others would tell
// them apart.

import { APP_KIND, live, type Obj, type Pod, type Ref } from './kube';
import { ALL, NONE, isAll, isEmpty, type PortSet } from './ports';
import { evaluate, type Endpoint, type World } from './policy';

export interface Group {
    id: string;
    namespace: string;
    name: string;
    /** The app kind, `deployments`, or `pods` for a bare pod. */
    kind: string;
    pods: Pod[];
    rep: Pod;
}

export function groupPods(pods: Pod[], replicasets: Obj[], jobs: Obj[] = []): Group[] {
    const rsOwner = new Map<string, { kind: string; name: string }>();
    for (const rs of replicasets) {
        const up = (rs.metadata.ownerReferences ?? []).find((r) => r.controller);
        if (up) rsOwner.set(`${rs.metadata.namespace}/${rs.metadata.name}`, up);
    }
    const jobOwner = new Map<string, { kind: string; name: string }>();
    for (const job of jobs) {
        const up = (job.metadata.ownerReferences ?? []).find((r) => r.controller);
        if (up) jobOwner.set(`${job.metadata.namespace}/${job.metadata.name}`, up);
    }
    const groups = new Map<string, Group>();
    for (const pod of pods) {
        if (!live(pod)) continue;
        const ns = pod.metadata.namespace ?? '';
        const ctrl = (pod.metadata.ownerReferences ?? []).find((r) => r.controller);
        let kind = ctrl?.kind ?? 'Pod';
        let name = ctrl?.name ?? pod.metadata.name;
        if (kind === 'ReplicaSet') {
            const up = rsOwner.get(`${ns}/${name}`);
            if (up?.kind === 'Deployment') ({ kind, name } = up);
        } else if (kind === 'Job') {
            const up = jobOwner.get(`${ns}/${name}`);
            if (up?.kind === 'CronJob') ({ kind, name } = up);
        } else if (kind === 'Node') {
            kind = 'Pod';
            name = pod.metadata.name;
        }
        const appKind = APP_KIND[kind] ?? kind;
        const id = `${ns}/${appKind}/${name}`;
        const have = groups.get(id);
        if (have) {
            have.pods.push(pod);
            if (have.rep.status?.phase !== 'Running' && pod.status?.phase === 'Running') have.rep = pod;
        } else groups.set(id, { id, namespace: ns, name, kind: appKind, pods: [pod], rep: pod });
    }
    return [...groups.values()].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export function groupRef(g: Group): Ref {
    return g.kind === 'pods' || !APP_KIND_VALUES.has(g.kind)
        ? { kind: 'pods', namespace: g.namespace, name: g.rep.metadata.name }
        : { kind: g.kind, namespace: g.namespace, name: g.name };
}

const APP_KIND_VALUES = new Set(Object.values(APP_KIND));

/** A sample address outside the cluster (TEST-NET-3, never routed). */
export const OUTSIDE_IP = '203.0.113.10';

export type Cell = 'all' | 'some' | 'none';

export function cellOf(set: PortSet): Cell {
    return isEmpty(set) ? 'none' : isAll(set) ? 'all' : 'some';
}

/** A row or column of the matrix: a workload, or the outside world. */
export interface Party {
    id: string;
    label: string;
    namespace: string | null;
    endpoint: Endpoint;
    group: Group | null;
}

export function party(g: Group): Party {
    return { id: g.id, label: g.name, namespace: g.namespace, endpoint: { kind: 'pod', pod: g.rep }, group: g };
}

export function outside(ip = OUTSIDE_IP): Party {
    return { id: 'outside', label: 'Outside the cluster', namespace: null, endpoint: { kind: 'ip', ip }, group: null };
}

/** Every row against every column: the ports the row can open to the column. */
export function matrix(rows: Party[], cols: Party[], world: World): PortSet[][] {
    return rows.map((r) =>
        cols.map((c) => {
            if (r.endpoint.kind === 'ip' && c.endpoint.kind === 'ip') return NONE;
            return evaluate(r.endpoint, c.endpoint, world).allowed;
        }),
    );
}

/** Many cells as one: all of them open, none, or anything in between. */
export function combine(cells: Cell[]): Cell {
    if (!cells.length) return 'none';
    if (cells.every((c) => c === 'all')) return 'all';
    if (cells.every((c) => c === 'none')) return 'none';
    return 'some';
}

export { ALL };
