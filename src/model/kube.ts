// The parts of Kubernetes objects this plugin reads.

import type { LabelSelector, Labels } from './selector';

export interface Meta {
    name: string;
    namespace?: string;
    uid?: string;
    labels?: Labels;
    ownerReferences?: { kind: string; name: string; controller?: boolean }[];
    deletionTimestamp?: string;
}

export interface Obj {
    metadata: Meta;
    [field: string]: unknown;
}

export interface ContainerPort {
    name?: string;
    containerPort: number;
    protocol?: string;
}

export interface Pod extends Obj {
    spec?: {
        hostNetwork?: boolean;
        nodeName?: string;
        containers?: { name: string; ports?: ContainerPort[] }[];
        initContainers?: { name: string; ports?: ContainerPort[]; restartPolicy?: string }[];
    };
    status?: { phase?: string; podIP?: string; podIPs?: { ip: string }[] };
}

export interface PolicyPort {
    protocol?: string;
    port?: number | string;
    endPort?: number;
}

export interface Peer {
    podSelector?: LabelSelector;
    namespaceSelector?: LabelSelector;
    ipBlock?: { cidr: string; except?: string[] };
}

export interface Rule {
    from?: Peer[];
    to?: Peer[];
    ports?: PolicyPort[];
}

export interface NetworkPolicy extends Obj {
    spec?: {
        podSelector?: LabelSelector;
        policyTypes?: string[];
        ingress?: Rule[];
        egress?: Rule[];
    };
}

export interface Namespace extends Obj {}

export interface Ref {
    kind: string;
    namespace: string;
    name: string;
}

export const APP_KIND: Record<string, string> = {
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    ReplicaSet: 'replicasets',
    Job: 'jobs',
    CronJob: 'cronjobs',
    Pod: 'pods',
};

export function live(pod: Pod): boolean {
    const phase = pod.status?.phase;
    return phase !== 'Succeeded' && phase !== 'Failed' && !pod.metadata.deletionTimestamp;
}

export function podIPs(pod: Pod): string[] {
    const ips = (pod.status?.podIPs ?? []).map((p) => p.ip).filter(Boolean);
    if (!ips.length && pod.status?.podIP) ips.push(pod.status.podIP);
    return ips;
}
