import { describe, expect, it } from 'vitest';
import { inCidr } from './cidr';
import { cellOf, groupPods, matrix, outside, party } from './groups';
import type { NetworkPolicy, Pod } from './kube';
import { ALL, contains, describe as describePorts, intersect, isAll, union } from './ports';
import { World, evaluate, rulePorts, types } from './policy';
import { findings } from './findings';

function pod(name: string, ns: string, labels: Record<string, string>, ip: string, ports: { name?: string; containerPort: number; protocol?: string }[] = []): Pod {
    return {
        metadata: { name, namespace: ns, labels },
        spec: { containers: [{ name: 'c', ports }] },
        status: { phase: 'Running', podIP: ip },
    };
}

const nsList = [
    { metadata: { name: 'shop', labels: { team: 'shop' } } },
    { metadata: { name: 'monitoring', labels: { team: 'ops' } } },
    { metadata: { name: 'kube-system' } },
];

const web = pod('web', 'shop', { app: 'web' }, '10.0.0.1', [{ name: 'http', containerPort: 8080 }]);
const db = pod('db', 'shop', { app: 'db' }, '10.0.0.2', [{ name: 'pg', containerPort: 5432 }]);
const prom = pod('prom', 'monitoring', { app: 'prom' }, '10.0.1.1');
const dns = pod('coredns', 'kube-system', { 'k8s-app': 'kube-dns' }, '10.0.2.1', [{ name: 'dns', containerPort: 53, protocol: 'UDP' }]);

const policies: NetworkPolicy[] = [
    // db: only web may connect, on the named port.
    {
        metadata: { name: 'db-in', namespace: 'shop' },
        spec: { podSelector: { matchLabels: { app: 'db' } }, ingress: [{ from: [{ podSelector: { matchLabels: { app: 'web' } } }], ports: [{ port: 'pg' }] }] },
    },
    // web: from anywhere in team=ops namespaces, and from the internet on 8080.
    {
        metadata: { name: 'web-in', namespace: 'shop' },
        spec: {
            podSelector: { matchLabels: { app: 'web' } },
            ingress: [
                { from: [{ namespaceSelector: { matchLabels: { team: 'ops' } } }] },
                { from: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] } }], ports: [{ port: 8080 }] },
            ],
        },
    },
    // web egress: only the db.
    {
        metadata: { name: 'web-out', namespace: 'shop' },
        spec: { podSelector: { matchLabels: { app: 'web' } }, policyTypes: ['Egress'], egress: [{ to: [{ podSelector: { matchLabels: { app: 'db' } } }] }] },
    },
];

const world = new World(policies, nsList);
const P = (p: Pod) => ({ kind: 'pod' as const, pod: p });

describe('ports', () => {
    it('unions, intersects and describes', () => {
        const a = union([{ protocol: 'TCP', from: 80, to: 80 }], [{ protocol: 'TCP', from: 81, to: 90 }]);
        expect(a).toEqual([{ protocol: 'TCP', from: 80, to: 90 }]);
        expect(intersect(a, [{ protocol: 'TCP', from: 85, to: 100 }])).toEqual([{ protocol: 'TCP', from: 85, to: 90 }]);
        expect(isAll(ALL)).toBe(true);
        expect(describePorts([{ protocol: 'TCP', from: 443, to: 443 }, { protocol: 'UDP', from: 53, to: 53 }])).toBe('TCP 443 · UDP 53');
    });

    it('resolves a named port against the destination pod', () => {
        expect(rulePorts([{ port: 'pg' }], P(db))).toEqual([{ protocol: 'TCP', from: 5432, to: 5432 }]);
        expect(rulePorts([{ port: 'pg' }], P(web))).toEqual([]);
        expect(rulePorts([{ port: 'pg' }], { kind: 'ip', ip: '1.2.3.4' })).toEqual([]);
    });
});

describe('cidr', () => {
    it('matches IPv4 and IPv6', () => {
        expect(inCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
        expect(inCidr('11.1.2.3', '10.0.0.0/8')).toBe(false);
        expect(inCidr('fd00::1', 'fd00::/8')).toBe(true);
        expect(inCidr('::ffff:10.0.0.1', '::ffff:0:0/96')).toBe(true);
        expect(inCidr('10.0.0.1', 'fd00::/8')).toBe(false);
    });
});

describe('evaluate', () => {
    it('defaults policyTypes the way the API server does', () => {
        expect(types(policies[0]!)).toEqual({ ingress: true, egress: false });
        expect(types(policies[2]!)).toEqual({ ingress: false, egress: true });
    });

    it('lets web reach db on its named port only', () => {
        const v = evaluate(P(web), P(db), world);
        expect(v.egress?.isolated).toBe(true);
        expect(v.ingress?.matches[0]?.policy.metadata.name).toBe('db-in');
        expect(describePorts(v.allowed)).toBe('TCP 5432');
    });

    it('stops prom reaching db, and web reaching prom (egress)', () => {
        expect(evaluate(P(prom), P(db), world).allowed).toEqual([]);
        const v = evaluate(P(web), P(prom), world);
        expect(v.ingress?.isolated).toBe(false);
        expect(v.egress?.matches).toEqual([]);
        expect(v.allowed).toEqual([]);
    });

    it('lets a namespaceSelector in from another namespace', () => {
        expect(isAll(evaluate(P(prom), P(web), world).allowed)).toBe(true);
    });

    it('lets the internet reach web on 8080, but not an address in the except', () => {
        expect(describePorts(evaluate({ kind: 'ip', ip: '8.8.8.8' }, P(web), world).allowed)).toBe('TCP 8080');
        expect(evaluate({ kind: 'ip', ip: '10.9.9.9' }, P(web), world).allowed).toEqual([]);
    });

    it('ignores pods on the host network', () => {
        const host = { ...db, spec: { ...db.spec, hostNetwork: true } };
        expect(isAll(evaluate(P(prom), P(host), world).allowed)).toBe(true);
    });
});

describe('matrix and findings', () => {
    it('groups pods under their Deployment and draws the matrix', () => {
        const pods = [
            { ...web, metadata: { ...web.metadata, name: 'web-7d-1', ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7d', controller: true }] } },
            db,
        ];
        const groups = groupPods(pods, [{ metadata: { name: 'web-7d', namespace: 'shop', ownerReferences: [{ kind: 'Deployment', name: 'web', controller: true }] } }]);
        expect(groups.map((g) => g.id)).toEqual(['shop/pods/db', 'shop/deployments/web']);
        const parties = [...groups.map(party), outside()];
        const m = matrix(parties, parties, world);
        // web → db: some ports; db → web: nothing (web only takes team=ops and the internet); outside → web: some
        expect(cellOf(m[1]![0]!)).toBe('some');
        expect(cellOf(m[0]![1]!)).toBe('none');
        expect(cellOf(m[2]![1]!)).toBe('some');
    });

    it('finds a workload that cannot reach DNS, and open namespaces', () => {
        const groups = groupPods([web, db, prom, dns], []);
        const f = findings(groups, [web, db, prom, dns], policies, world, { others: {}, cni: '' });
        expect(f.find((x) => /DNS/.test(x.title))?.about).toEqual(['shop/web']);
        expect(f.find((x) => /no policies/.test(x.title))?.about).toEqual(['kube-system', 'monitoring']);
        expect(contains(ALL, 'UDP', 53)).toBe(true);
    });
});
