// Reads what the pages work from.

import type { Engines } from '../model/findings';
import { groupPods, type Group } from '../model/groups';
import type { Namespace, NetworkPolicy, Obj, Pod } from '../model/kube';
import { World } from '../model/policy';

/** Other engines' policy kinds, counted so the page can say they are not included. */
const OTHERS: [string, string][] = [
    ['crd:ciliumnetworkpolicies.cilium.io', 'CiliumNetworkPolicy'],
    ['crd:ciliumclusterwidenetworkpolicies.cilium.io', 'CiliumClusterwideNetworkPolicy'],
    ['crd:networkpolicies.crd.projectcalico.org', 'Calico NetworkPolicy'],
    ['crd:globalnetworkpolicies.crd.projectcalico.org', 'Calico GlobalNetworkPolicy'],
    ['crd:adminnetworkpolicies.policy.networking.k8s.io', 'AdminNetworkPolicy'],
    ['crd:baselineadminnetworkpolicies.policy.networking.k8s.io', 'BaselineAdminNetworkPolicy'],
];

export interface Loaded {
    pods: Pod[];
    policies: NetworkPolicy[];
    namespaces: Namespace[];
    groups: Group[];
    world: World;
    engines: Engines;
}

async function list<T extends Obj>(kind: string, required = false): Promise<T[]> {
    try {
        return (await k8sdockside.list({ kind })) as unknown as T[];
    } catch (err) {
        if (required) throw err;
        return [];
    }
}

export async function load(): Promise<Loaded> {
    const [pods, policies, namespaces, replicasets, jobs, daemonsets, ...others] = await Promise.all([
        list<Pod>('pods', true),
        list<NetworkPolicy>('networkpolicies', true),
        list<Namespace>('namespaces'),
        list<Obj>('replicasets'),
        list<Obj>('jobs'),
        list<Obj>('daemonsets'),
        ...OTHERS.map(([kind]) => list<Obj>(kind)),
    ]);
    const engines: Engines = { others: {}, cni: '' };
    OTHERS.forEach(([, label], i) => {
        const n = others[i]?.length ?? 0;
        if (n) engines.others[label] = n;
    });
    const dsNames = daemonsets.map((d) => d.metadata.name);
    if (dsNames.some((n) => n === 'cilium' || n.startsWith('cilium-agent'))) engines.cni = 'cilium';
    else if (dsNames.some((n) => n === 'calico-node' || n.startsWith('canal'))) engines.cni = 'calico';
    else if (dsNames.some((n) => n.includes('flannel'))) engines.cni = 'flannel';
    return { pods, policies, namespaces, groups: groupPods(pods, replicasets, jobs), world: new World(policies, namespaces), engines };
}
