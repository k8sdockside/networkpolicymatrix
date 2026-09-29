// NetworkPolicy, evaluated the way the Kubernetes documentation defines it.
//
// A connection from A to B is allowed when both ends allow it:
//
//   - A's egress: if no policy selecting A has Egress in its policyTypes, A
//     may send anywhere. Otherwise only what some egress rule of those
//     policies allows -- a peer matching B, on a port B has.
//   - B's ingress: the same, with ingress rules and peers matching A.
//
// Rules only ever add. There is no "deny" in NetworkPolicy: a pod that some
// policy selects is isolated in that direction, and then allowed exactly the
// union of what the rules of every policy selecting it allow. Replies to an
// allowed connection are always allowed, so nothing here asks about them.
//
// Implementations differ in two places the specification leaves open, and
// this follows the common reading: ipBlock is matched against pod IPs too,
// and pods on the host network are not subject to policies at all.

import { inCidr } from './cidr';
import { podIPs, type Namespace, type NetworkPolicy, type Peer, type Pod, type PolicyPort, type Rule } from './kube';
import { ALL, NONE, intersect, protocolOf, union, type PortSet } from './ports';
import { matches, type LabelSelector, type Labels } from './selector';

export type Direction = 'ingress' | 'egress';

/** One end of a connection: a pod, or an address outside the cluster. */
export type Endpoint = { kind: 'pod'; pod: Pod } | { kind: 'ip'; ip: string };

/** What the evaluation reads. */
export class World {
    readonly nsLabels = new Map<string, Labels>();

    constructor(
        readonly policies: NetworkPolicy[],
        namespaces: Namespace[],
    ) {
        for (const ns of namespaces) {
            // The API server sets this label on every namespace; an old cluster may not have.
            this.nsLabels.set(ns.metadata.name, { 'kubernetes.io/metadata.name': ns.metadata.name, ...(ns.metadata.labels ?? {}) });
        }
    }

    labelsOf(namespace: string): Labels {
        return this.nsLabels.get(namespace) ?? { 'kubernetes.io/metadata.name': namespace };
    }

    /** The policies that select a pod for one direction. */
    selecting(pod: Pod, direction: Direction): NetworkPolicy[] {
        const ns = pod.metadata.namespace ?? '';
        return this.policies.filter(
            (np) => (np.metadata.namespace ?? '') === ns && types(np)[direction] && matches(np.spec?.podSelector ?? {}, pod.metadata.labels),
        );
    }
}

/** Which directions a policy isolates: its policyTypes, or what the API server would default them to. */
export function types(np: NetworkPolicy): Record<Direction, boolean> {
    const declared = np.spec?.policyTypes;
    if (declared && declared.length) return { ingress: declared.includes('Ingress'), egress: declared.includes('Egress') };
    return { ingress: true, egress: (np.spec?.egress ?? []).length > 0 };
}

export function endpointNamespace(e: Endpoint): string | null {
    return e.kind === 'pod' ? (e.pod.metadata.namespace ?? '') : null;
}

function endpointIPs(e: Endpoint): string[] {
    return e.kind === 'pod' ? podIPs(e.pod) : [e.ip];
}

/** Whether a rule's peer is the other end, given the namespace the policy lives in. */
export function peerMatches(peer: Peer, policyNs: string, other: Endpoint, world: World): boolean {
    if (peer.ipBlock) {
        const block = peer.ipBlock;
        return endpointIPs(other).some((ip) => inCidr(ip, block.cidr) && !(block.except ?? []).some((ex) => inCidr(ip, ex)));
    }
    if (other.kind !== 'pod') return false;
    if (!peer.podSelector && !peer.namespaceSelector) return false;
    const ns = other.pod.metadata.namespace ?? '';
    const nsOk = peer.namespaceSelector ? matches(peer.namespaceSelector, world.labelsOf(ns)) : ns === policyNs;
    const podOk = peer.podSelector ? matches(peer.podSelector, other.pod.metadata.labels) : true;
    return nsOk && podOk;
}

/**
 * The ports a rule opens, on `dest` -- the pod the traffic arrives at. A
 * named port is looked up in that pod's containers, so a rule naming
 * `metrics` opens nothing on a pod without a port of that name.
 */
export function rulePorts(ports: PolicyPort[] | undefined, dest: Endpoint): PortSet {
    if (!ports || !ports.length) return ALL;
    let out: PortSet = NONE;
    for (const p of ports) {
        const protocol = protocolOf(p.protocol);
        if (p.port === undefined || p.port === null) {
            out = union(out, [{ protocol, from: 1, to: 65535 }]);
        } else if (typeof p.port === 'number' || /^\d+$/.test(p.port)) {
            const from = Number(p.port);
            out = union(out, [{ protocol, from, to: p.endPort && p.endPort >= from ? p.endPort : from }]);
        } else if (dest.kind === 'pod') {
            const named = p.port;
            const spec = dest.pod.spec;
            const containers = [...(spec?.containers ?? []), ...(spec?.initContainers ?? [])];
            for (const c of containers) {
                for (const cp of c.ports ?? []) {
                    if (cp.name === named && protocolOf(cp.protocol) === protocol) {
                        out = union(out, [{ protocol, from: cp.containerPort, to: cp.containerPort }]);
                    }
                }
            }
        }
    }
    return out;
}

/** A rule of a policy that let something through. */
export interface RuleMatch {
    policy: NetworkPolicy;
    /** Index into the policy's ingress or egress rules. */
    rule: number;
    /** Which peer matched, in words. */
    peer: string;
    ports: PortSet;
}

export interface Side {
    direction: Direction;
    /** False when no policy selects the pod for this direction: then everything is allowed. */
    isolated: boolean;
    /** Why it is not subject to policies at all, when that is the case. */
    exempt: string;
    policies: NetworkPolicy[];
    matches: RuleMatch[];
    allowed: PortSet;
}

/** One pod's side of a connection with `other`. */
export function side(direction: Direction, self: Pod, other: Endpoint, world: World): Side {
    if (self.spec?.hostNetwork) {
        return { direction, isolated: false, exempt: 'it runs on the host network, where NetworkPolicy does not apply', policies: [], matches: [], allowed: ALL };
    }
    const policies = world.selecting(self, direction);
    if (!policies.length) return { direction, isolated: false, exempt: '', policies, matches: [], allowed: ALL };
    const selfEnd: Endpoint = { kind: 'pod', pod: self };
    const out: RuleMatch[] = [];
    let allowed: PortSet = NONE;
    for (const np of policies) {
        const rules: Rule[] = (direction === 'ingress' ? np.spec?.ingress : np.spec?.egress) ?? [];
        const ns = np.metadata.namespace ?? '';
        rules.forEach((rule, i) => {
            const peers = (direction === 'ingress' ? rule.from : rule.to) ?? [];
            let peer = '';
            if (!peers.length) peer = 'anything';
            else {
                const hit = peers.find((p) => peerMatches(p, ns, other, world));
                if (!hit) return;
                peer = describePeer(hit);
            }
            const ports = rulePorts(rule.ports, direction === 'ingress' ? selfEnd : other);
            out.push({ policy: np, rule: i, peer, ports });
            allowed = union(allowed, ports);
        });
    }
    return { direction, isolated: true, exempt: '', policies, matches: out, allowed };
}

export interface Verdict {
    /** The source's egress; null when the source is outside the cluster. */
    egress: Side | null;
    /** The destination's ingress; null when the destination is outside the cluster. */
    ingress: Side | null;
    allowed: PortSet;
}

export function evaluate(src: Endpoint, dst: Endpoint, world: World): Verdict {
    const egress = src.kind === 'pod' ? side('egress', src.pod, dst, world) : null;
    const ingress = dst.kind === 'pod' ? side('ingress', dst.pod, src, world) : null;
    return { egress, ingress, allowed: intersect(egress?.allowed ?? ALL, ingress?.allowed ?? ALL) };
}

// ----- in words ------------------------------------------------------------------------

export function describeSelector(sel: LabelSelector | undefined): string {
    if (!sel) return '';
    const parts: string[] = [];
    for (const [k, v] of Object.entries(sel.matchLabels ?? {})) parts.push(`${k}=${v}`);
    for (const e of sel.matchExpressions ?? []) {
        const values = (e.values ?? []).join(', ');
        if (e.operator === 'In') parts.push(`${e.key} in (${values})`);
        else if (e.operator === 'NotIn') parts.push(`${e.key} not in (${values})`);
        else if (e.operator === 'Exists') parts.push(e.key);
        else if (e.operator === 'DoesNotExist') parts.push(`!${e.key}`);
    }
    return parts.join(', ');
}

export function describePeer(peer: Peer): string {
    if (peer.ipBlock) {
        const except = peer.ipBlock.except?.length ? ` except ${peer.ipBlock.except.join(', ')}` : '';
        return `addresses in ${peer.ipBlock.cidr}${except}`;
    }
    const pods = peer.podSelector ? describeSelector(peer.podSelector) : '';
    const podText = peer.podSelector ? (pods ? `pods with ${pods}` : 'every pod') : 'every pod';
    if (!peer.namespaceSelector) return `${podText} in the policy's namespace`;
    const ns = describeSelector(peer.namespaceSelector);
    return ns ? `${podText} in namespaces with ${ns}` : `${podText} in every namespace`;
}

/** A rule in a sentence: "from pods with app=web in the policy's namespace, on TCP 8080". */
export function describeRule(rule: Rule, direction: Direction): string {
    const peers = (direction === 'ingress' ? rule.from : rule.to) ?? [];
    const who = peers.length ? peers.map(describePeer).join('; or ') : 'anything';
    const ports = rule.ports?.length
        ? rule.ports
              .map((p) => {
                  const proto = protocolOf(p.protocol);
                  if (p.port === undefined) return `any ${proto} port`;
                  return `${proto} ${p.port}${p.endPort ? `–${p.endPort}` : ''}`;
              })
              .join(', ')
        : 'any port';
    return `${direction === 'ingress' ? 'from' : 'to'} ${who}, on ${ports}`;
}
