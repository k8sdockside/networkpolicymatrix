// Things worth knowing about a cluster's policies, found without asking.

import type { NetworkPolicy, Pod } from './kube';
import { contains } from './ports';
import { evaluate, type World } from './policy';
import { idlePolicies } from './summary';
import type { Group } from './groups';

export type Tone = 'warn' | 'info' | 'error';

export interface Finding {
    tone: Tone;
    title: string;
    text: string;
    /** Objects it is about, as `namespace/name`. */
    about: string[];
}

export interface Engines {
    /** Policy kinds of other engines found in the cluster, with how many: `CiliumNetworkPolicy` → 3. */
    others: Record<string, number>;
    /** The pod network, when it can be told from what runs: `flannel`, `cilium`, `calico`, or ''. */
    cni: string;
}

export function findings(groups: Group[], pods: Pod[], policies: NetworkPolicy[], world: World, engines: Engines): Finding[] {
    const out: Finding[] = [];

    if (engines.cni === 'flannel') {
        out.push({
            tone: 'error',
            title: 'Flannel does not enforce NetworkPolicy',
            text: 'This cluster runs Flannel, which ignores NetworkPolicy on its own. Unless something else enforces them, everything below is what the policies say, not what the network does.',
            about: [],
        });
    }
    for (const [kind, n] of Object.entries(engines.others)) {
        if (!n) continue;
        out.push({
            tone: 'warn',
            title: `${n} ${kind}${n === 1 ? '' : 's'} not included`,
            text: `This plugin reads Kubernetes NetworkPolicy only. ${kind} rules are enforced on top of them, so real traffic may be allowed less, or more, than shown.`,
            about: [],
        });
    }

    // Namespaces where nothing is isolated at all.
    const byNs = new Map<string, Group[]>();
    for (const g of groups) byNs.set(g.namespace, [...(byNs.get(g.namespace) ?? []), g]);
    const covered = new Set(policies.map((p) => p.metadata.namespace ?? ''));
    const open = [...byNs.keys()].filter((ns) => !covered.has(ns)).sort();
    if (open.length) {
        out.push({
            tone: 'info',
            title: `${open.length} namespace${open.length === 1 ? ' has' : 's have'} no policies`,
            text: 'Every pod in them accepts connections from anywhere and may connect anywhere.',
            about: open,
        });
    }

    // Egress-isolated workloads that cannot reach cluster DNS.
    const dns = pods.find(
        (p) => p.metadata.namespace === 'kube-system' && (p.metadata.labels?.['k8s-app'] === 'kube-dns' || p.metadata.labels?.['k8s-app'] === 'coredns') && p.status?.phase === 'Running',
    );
    if (dns) {
        const blind = groups.filter((g) => {
            if (!world.selecting(g.rep, 'egress').length) return false;
            const allowed = evaluate({ kind: 'pod', pod: g.rep }, { kind: 'pod', pod: dns }, world).allowed;
            return !contains(allowed, 'UDP', 53) && !contains(allowed, 'TCP', 53);
        });
        if (blind.length) {
            out.push({
                tone: 'warn',
                title: `${blind.length} workload${blind.length === 1 ? '' : 's'} cannot reach DNS`,
                text: 'Their egress is restricted and nothing allows port 53 to the cluster DNS in kube-system, so looking up any name fails.',
                about: blind.map((g) => `${g.namespace}/${g.name}`),
            });
        }
    }

    // Policies that select nothing: a typo in a label, or a workload gone.
    const idle = idlePolicies(pods, policies);
    if (idle.length) {
        out.push({
            tone: 'info',
            title: `${idle.length} polic${idle.length === 1 ? 'y selects' : 'ies select'} no pods`,
            text: 'They change nothing today. Often a label that does not match what the workload has, or a workload that is gone.',
            about: idle.map((np) => `${np.metadata.namespace}/${np.metadata.name}`),
        });
    }

    // Workloads that accept nothing at all.
    const sealed = groups.filter((g) => {
        const policiesIn = world.selecting(g.rep, 'ingress');
        if (!policiesIn.length) return false;
        return policiesIn.every((np) => !(np.spec?.ingress ?? []).length);
    });
    if (sealed.length) {
        out.push({
            tone: 'info',
            title: `${sealed.length} workload${sealed.length === 1 ? ' accepts' : 's accept'} no connections`,
            text: 'Selected for ingress by policies without a single ingress rule: a default deny, and nothing allowing anything back in.',
            about: sealed.map((g) => `${g.namespace}/${g.name}`),
        });
    }
    return out;
}
