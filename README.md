# Network policy matrix

A [K8s Dockside](https://github.com/k8sdockside/k8sdockside) plugin that works
out the cluster's NetworkPolicies into **who can talk to whom, and why**.

- **Matrix** (the page the plugin opens on). Every namespace, or every workload in one namespace or all of
  them, against every other and against the world outside the cluster. Rows
  are the source and columns the destination. Each square is green (any
  port), amber (some ports) or red (nothing). Click a square for the reason:
  which policies isolate each end, and which rule lets the traffic through,
  or that no rule does. A namespace square lists every workload pair in it.

  Above the matrix, what is worth knowing:
  - workloads whose egress rules forgot DNS;
  - policies that select no pods;
  - workloads that accept nothing at all;
  - namespaces with no policies;
  - Flannel, which does not enforce NetworkPolicy;
  - Cilium, Calico or AdminNetworkPolicy rules, which this plugin does not
    evaluate.
- **Simulator.** One connection: from a workload or an IP address to a
  workload or an IP address, on one port and protocol or on any. You get the
  verdict and the trace, both ends side by side.
- **Network access** panel on Pods: who can connect to it and what it can
  connect to, with ports.
- **What it allows** panel on NetworkPolicies: the pods it selects, and its
  rules in words.

## How it decides

It follows the Kubernetes NetworkPolicy semantics:

- A pod that no policy selects for a direction is open in that direction.
- A pod that some policy selects is isolated, and allowed exactly the union of
  what those policies' rules allow. Rules only add.
- A connection needs the source's egress **and** the destination's ingress.
- `policyTypes` defaults the way the API server defaults it. Named ports are
  looked up in the destination pod's containers. `endPort` ranges,
  `namespaceSelector` with and without `podSelector`, and `ipBlock` with
  `except` all work, for IPv4 and IPv6.
- Where the specification leaves it to the implementation, it takes the common
  reading: `ipBlock` also matches pod IPs, and host-network pods are not
  subject to policies.

It works from one running pod of each workload. Pods of one workload share
their labels and ports, which is all a policy looks at.

## What it reads

It only reads, and never writes anything. It reads Pods, NetworkPolicies,
Namespaces (for their labels), ReplicaSets and Jobs (to name workloads), and
DaemonSets (to recognise the pod network). It counts, but does not evaluate,
CiliumNetworkPolicies, CiliumClusterwideNetworkPolicies, Calico
(Global)NetworkPolicies and (Baseline)AdminNetworkPolicies when the cluster
has them.

## Try it

**Settings → Plugins → From a repository**:

```
https://github.com/k8sdockside/networkpolicymatrix
```

Or, to work on it, **Settings → Plugins → Watch another folder** and pick this
folder. `ui/` is committed, so nothing has to be built first.

## Develop

```sh
npm install
npm run watch        # rebuild ui/ from src/ on every change; reopen the tab to see it
npm test             # the policy engine's tests
npm run check        # type-check, test, and check ui/ matches a fresh build
go run github.com/k8sdockside/k8sdockside/cmd/plugincheck@main .
```

The engine is `src/model/policy.ts`, with ports in `ports.ts` and CIDRs in
`cidr.ts`. The matrix is `groups.ts` and the findings are `findings.ts`. None
of it touches the DOM or the bridge.

Needs K8s Dockside 0.1.1 or newer.
