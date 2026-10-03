import { describe, expect, it } from 'vitest';
import type { Finding } from './findings';
import { groupPods } from './groups';
import type { NetworkPolicy, Pod } from './kube';
import { World } from './policy';
import { arcs, idlePolicies, percent, posture, postureCounts, tally, toneCounts } from './summary';

function pod(name: string, ns: string, labels: Record<string, string>): Pod {
    return { metadata: { name, namespace: ns, labels }, spec: { containers: [{ name: 'c' }] }, status: { phase: 'Running', podIP: '10.0.0.1' } };
}

const pods = [
    pod('web', 'shop', { app: 'web' }),
    pod('db', 'shop', { app: 'db' }),
    pod('api', 'half', { app: 'api' }),
    pod('job', 'half', { app: 'job' }),
    pod('prom', 'monitoring', { app: 'prom' }),
];

const policies: NetworkPolicy[] = [
    // shop: default deny ingress for everything.
    { metadata: { name: 'deny', namespace: 'shop' }, spec: { podSelector: {} } },
    // half: only api, and only egress.
    { metadata: { name: 'api-out', namespace: 'half' }, spec: { podSelector: { matchLabels: { app: 'api' } }, policyTypes: ['Egress'], egress: [{}] } },
    // a typo: selects nothing.
    { metadata: { name: 'typo', namespace: 'half' }, spec: { podSelector: { matchLabels: { app: 'nope' } } } },
];

const world = new World(policies, []);

describe('summary', () => {
    it('works out each namespace posture, wide open first', () => {
        const p = posture(groupPods(pods, []), policies, world);
        expect(p.map((x) => [x.namespace, x.state, x.ingress, x.egress, x.policies])).toEqual([
            ['monitoring', 'open', 0, 0, 0],
            ['half', 'partial', 0, 1, 2],
            ['shop', 'isolated', 2, 0, 1],
        ]);
        expect(postureCounts(p)).toEqual({ isolated: 1, partial: 1, open: 1 });
    });

    it('finds policies that select no pods', () => {
        expect(idlePolicies(pods, policies).map((p) => p.metadata.name)).toEqual(['typo']);
    });

    it('tallies cells and makes donut arcs', () => {
        const t = tally(['all', 'none', 'none', 'some']);
        expect(t).toEqual({ all: 1, some: 1, none: 2, total: 4 });
        expect(arcs(t)).toEqual([
            { key: 'all', start: 0, length: 0.25 },
            { key: 'some', start: 0.25, length: 0.25 },
            { key: 'none', start: 0.5, length: 0.5 },
        ]);
        expect(arcs(tally(['none']))).toEqual([{ key: 'none', start: 0, length: 1 }]);
        expect(arcs(tally([]))).toEqual([]);
    });

    it('rounds percentages and never divides by zero', () => {
        expect(percent(1, 3)).toBe(33);
        expect(percent(0, 0)).toBe(0);
    });

    it('counts findings by tone', () => {
        const f = (tone: Finding['tone']): Finding => ({ tone, title: '', text: '', about: [] });
        expect(toneCounts([f('warn'), f('warn'), f('info')])).toEqual({ error: 0, warn: 2, info: 1 });
    });
});
