// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // node_modules/@k8sdockside/plugin-sdk/dom.js
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    append(node, children);
    return node;
  }
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    append(parent, children);
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }
  function append(parent, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }

  // src/model/kube.ts
  var APP_KIND = {
    Deployment: "deployments",
    StatefulSet: "statefulsets",
    DaemonSet: "daemonsets",
    ReplicaSet: "replicasets",
    Job: "jobs",
    CronJob: "cronjobs",
    Pod: "pods"
  };
  function live(pod) {
    const phase = pod.status?.phase;
    return phase !== "Succeeded" && phase !== "Failed" && !pod.metadata.deletionTimestamp;
  }
  function podIPs(pod) {
    const ips = (pod.status?.podIPs ?? []).map((p) => p.ip).filter(Boolean);
    if (!ips.length && pod.status?.podIP) ips.push(pod.status.podIP);
    return ips;
  }

  // src/model/ports.ts
  var PROTOCOLS = ["TCP", "UDP", "SCTP"];
  var ALL = PROTOCOLS.map((protocol) => ({ protocol, from: 1, to: 65535 }));
  var NONE = [];
  function protocolOf(text) {
    const up = (text ?? "TCP").toUpperCase();
    return up === "UDP" || up === "SCTP" ? up : "TCP";
  }
  function normalize(set) {
    const out = [];
    const sorted = [...set].filter((r) => r.from <= r.to).sort((a, b) => PROTOCOLS.indexOf(a.protocol) - PROTOCOLS.indexOf(b.protocol) || a.from - b.from);
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && last.protocol === r.protocol && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
      else out.push({ ...r });
    }
    return out;
  }
  function union(a, b) {
    return normalize([...a, ...b]);
  }
  function intersect(a, b) {
    const out = [];
    for (const x of a) {
      for (const y of b) {
        if (x.protocol !== y.protocol) continue;
        const from = Math.max(x.from, y.from);
        const to = Math.min(x.to, y.to);
        if (from <= to) out.push({ protocol: x.protocol, from, to });
      }
    }
    return normalize(out);
  }
  function isAll(set) {
    const n = normalize(set);
    return PROTOCOLS.every((p) => n.some((r) => r.protocol === p && r.from <= 1 && r.to >= 65535));
  }
  function isEmpty(set) {
    return set.length === 0;
  }
  function describe(set) {
    if (isEmpty(set)) return "nothing";
    if (isAll(set)) return "any port";
    const parts = [];
    for (const p of PROTOCOLS) {
      const ranges = set.filter((r) => r.protocol === p);
      if (!ranges.length) continue;
      if (ranges.length === 1 && ranges[0].from <= 1 && ranges[0].to >= 65535) {
        parts.push(`any ${p} port`);
        continue;
      }
      parts.push(`${p} ${ranges.map((r) => r.from === r.to ? String(r.from) : `${r.from}–${r.to}`).join(", ")}`);
    }
    return parts.join(" · ");
  }

  // src/model/cidr.ts
  function parseIP(text) {
    const s = text.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      const parts = s.split(".").map(Number);
      if (parts.some((p) => p > 255)) return null;
      return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
    }
    if (!s.includes(":")) return null;
    let head = s;
    const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
      const v4 = parseIP(dotted[2]);
      if (!v4) return null;
      head = dotted[1] + (v4.n >> 16n).toString(16) + ":" + (v4.n & 0xffffn).toString(16);
    }
    const halves = head.split("::");
    if (halves.length > 2) return null;
    const words = (part) => {
      if (!part) return [];
      const out = [];
      for (const w of part.split(":")) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(w)) return null;
        out.push(parseInt(w, 16));
      }
      return out;
    };
    const left = words(halves[0] ?? "");
    const right = halves.length === 2 ? words(halves[1] ?? "") : [];
    if (!left || !right) return null;
    const known = left.length + right.length;
    if (halves.length === 1 && known !== 8) return null;
    if (known > 8) return null;
    const all = [...left, ...Array(8 - known).fill(0), ...right];
    return { v: 6, n: all.reduce((acc, w) => (acc << 16n) + BigInt(w), 0n) };
  }
  function inCidr(ip, cidr) {
    const [base, bitsText] = cidr.split("/");
    const addr = parseIP(ip);
    const net = parseIP(base ?? "");
    if (!addr || !net || addr.v !== net.v) return false;
    const width = addr.v === 4 ? 32 : 128;
    const bits = bitsText === void 0 ? width : Number(bitsText);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
    const shift = BigInt(width - bits);
    return addr.n >> shift === net.n >> shift;
  }

  // src/model/selector.ts
  function matches(selector, labels) {
    if (!selector) return false;
    const have = labels ?? {};
    for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
      if (have[key] !== value) return false;
    }
    for (const req of selector.matchExpressions ?? []) {
      const present = Object.prototype.hasOwnProperty.call(have, req.key);
      const values = req.values ?? [];
      switch (req.operator) {
        case "In":
          if (!present || !values.includes(have[req.key])) return false;
          break;
        case "NotIn":
          if (present && values.includes(have[req.key])) return false;
          break;
        case "Exists":
          if (!present) return false;
          break;
        case "DoesNotExist":
          if (present) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  }

  // src/model/policy.ts
  var World = class {
    constructor(policies, namespaces) {
      this.policies = policies;
      for (const ns of namespaces) {
        this.nsLabels.set(ns.metadata.name, { "kubernetes.io/metadata.name": ns.metadata.name, ...ns.metadata.labels ?? {} });
      }
    }
    policies;
    nsLabels = /* @__PURE__ */ new Map();
    labelsOf(namespace) {
      return this.nsLabels.get(namespace) ?? { "kubernetes.io/metadata.name": namespace };
    }
    /** The policies that select a pod for one direction. */
    selecting(pod, direction) {
      const ns = pod.metadata.namespace ?? "";
      return this.policies.filter(
        (np) => (np.metadata.namespace ?? "") === ns && types(np)[direction] && matches(np.spec?.podSelector ?? {}, pod.metadata.labels)
      );
    }
  };
  function types(np) {
    const declared = np.spec?.policyTypes;
    if (declared && declared.length) return { ingress: declared.includes("Ingress"), egress: declared.includes("Egress") };
    return { ingress: true, egress: (np.spec?.egress ?? []).length > 0 };
  }
  function endpointIPs(e) {
    return e.kind === "pod" ? podIPs(e.pod) : [e.ip];
  }
  function peerMatches(peer, policyNs, other, world) {
    if (peer.ipBlock) {
      const block = peer.ipBlock;
      return endpointIPs(other).some((ip) => inCidr(ip, block.cidr) && !(block.except ?? []).some((ex) => inCidr(ip, ex)));
    }
    if (other.kind !== "pod") return false;
    if (!peer.podSelector && !peer.namespaceSelector) return false;
    const ns = other.pod.metadata.namespace ?? "";
    const nsOk = peer.namespaceSelector ? matches(peer.namespaceSelector, world.labelsOf(ns)) : ns === policyNs;
    const podOk = peer.podSelector ? matches(peer.podSelector, other.pod.metadata.labels) : true;
    return nsOk && podOk;
  }
  function rulePorts(ports, dest) {
    if (!ports || !ports.length) return ALL;
    let out = NONE;
    for (const p of ports) {
      const protocol = protocolOf(p.protocol);
      if (p.port === void 0 || p.port === null) {
        out = union(out, [{ protocol, from: 1, to: 65535 }]);
      } else if (typeof p.port === "number" || /^\d+$/.test(p.port)) {
        const from = Number(p.port);
        out = union(out, [{ protocol, from, to: p.endPort && p.endPort >= from ? p.endPort : from }]);
      } else if (dest.kind === "pod") {
        const named = p.port;
        const spec = dest.pod.spec;
        const containers = [...spec?.containers ?? [], ...spec?.initContainers ?? []];
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
  function side(direction, self, other, world) {
    if (self.spec?.hostNetwork) {
      return { direction, isolated: false, exempt: "it runs on the host network, where NetworkPolicy does not apply", policies: [], matches: [], allowed: ALL };
    }
    const policies = world.selecting(self, direction);
    if (!policies.length) return { direction, isolated: false, exempt: "", policies, matches: [], allowed: ALL };
    const selfEnd = { kind: "pod", pod: self };
    const out = [];
    let allowed = NONE;
    for (const np of policies) {
      const rules = (direction === "ingress" ? np.spec?.ingress : np.spec?.egress) ?? [];
      const ns = np.metadata.namespace ?? "";
      rules.forEach((rule, i) => {
        const peers = (direction === "ingress" ? rule.from : rule.to) ?? [];
        let peer = "";
        if (!peers.length) peer = "anything";
        else {
          const hit = peers.find((p) => peerMatches(p, ns, other, world));
          if (!hit) return;
          peer = describePeer(hit);
        }
        const ports = rulePorts(rule.ports, direction === "ingress" ? selfEnd : other);
        out.push({ policy: np, rule: i, peer, ports });
        allowed = union(allowed, ports);
      });
    }
    return { direction, isolated: true, exempt: "", policies, matches: out, allowed };
  }
  function evaluate(src, dst, world) {
    const egress = src.kind === "pod" ? side("egress", src.pod, dst, world) : null;
    const ingress = dst.kind === "pod" ? side("ingress", dst.pod, src, world) : null;
    return { egress, ingress, allowed: intersect(egress?.allowed ?? ALL, ingress?.allowed ?? ALL) };
  }
  function describeSelector(sel) {
    if (!sel) return "";
    const parts = [];
    for (const [k, v] of Object.entries(sel.matchLabels ?? {})) parts.push(`${k}=${v}`);
    for (const e of sel.matchExpressions ?? []) {
      const values = (e.values ?? []).join(", ");
      if (e.operator === "In") parts.push(`${e.key} in (${values})`);
      else if (e.operator === "NotIn") parts.push(`${e.key} not in (${values})`);
      else if (e.operator === "Exists") parts.push(e.key);
      else if (e.operator === "DoesNotExist") parts.push(`!${e.key}`);
    }
    return parts.join(", ");
  }
  function describePeer(peer) {
    if (peer.ipBlock) {
      const except = peer.ipBlock.except?.length ? ` except ${peer.ipBlock.except.join(", ")}` : "";
      return `addresses in ${peer.ipBlock.cidr}${except}`;
    }
    const pods = peer.podSelector ? describeSelector(peer.podSelector) : "";
    const podText = peer.podSelector ? pods ? `pods with ${pods}` : "every pod" : "every pod";
    if (!peer.namespaceSelector) return `${podText} in the policy's namespace`;
    const ns = describeSelector(peer.namespaceSelector);
    return ns ? `${podText} in namespaces with ${ns}` : `${podText} in every namespace`;
  }

  // src/model/groups.ts
  function groupPods(pods, replicasets, jobs = []) {
    const rsOwner = /* @__PURE__ */ new Map();
    for (const rs of replicasets) {
      const up = (rs.metadata.ownerReferences ?? []).find((r) => r.controller);
      if (up) rsOwner.set(`${rs.metadata.namespace}/${rs.metadata.name}`, up);
    }
    const jobOwner = /* @__PURE__ */ new Map();
    for (const job of jobs) {
      const up = (job.metadata.ownerReferences ?? []).find((r) => r.controller);
      if (up) jobOwner.set(`${job.metadata.namespace}/${job.metadata.name}`, up);
    }
    const groups = /* @__PURE__ */ new Map();
    for (const pod of pods) {
      if (!live(pod)) continue;
      const ns = pod.metadata.namespace ?? "";
      const ctrl = (pod.metadata.ownerReferences ?? []).find((r) => r.controller);
      let kind = ctrl?.kind ?? "Pod";
      let name = ctrl?.name ?? pod.metadata.name;
      if (kind === "ReplicaSet") {
        const up = rsOwner.get(`${ns}/${name}`);
        if (up?.kind === "Deployment") ({ kind, name } = up);
      } else if (kind === "Job") {
        const up = jobOwner.get(`${ns}/${name}`);
        if (up?.kind === "CronJob") ({ kind, name } = up);
      } else if (kind === "Node") {
        kind = "Pod";
        name = pod.metadata.name;
      }
      const appKind = APP_KIND[kind] ?? kind;
      const id = `${ns}/${appKind}/${name}`;
      const have = groups.get(id);
      if (have) {
        have.pods.push(pod);
        if (have.rep.status?.phase !== "Running" && pod.status?.phase === "Running") have.rep = pod;
      } else groups.set(id, { id, namespace: ns, name, kind: appKind, pods: [pod], rep: pod });
    }
    return [...groups.values()].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  }
  function groupRef(g) {
    return g.kind === "pods" || !APP_KIND_VALUES.has(g.kind) ? { kind: "pods", namespace: g.namespace, name: g.rep.metadata.name } : { kind: g.kind, namespace: g.namespace, name: g.name };
  }
  var APP_KIND_VALUES = new Set(Object.values(APP_KIND));
  var OUTSIDE_IP = "203.0.113.10";
  function cellOf(set) {
    return isEmpty(set) ? "none" : isAll(set) ? "all" : "some";
  }
  function party(g) {
    return { id: g.id, label: g.name, namespace: g.namespace, endpoint: { kind: "pod", pod: g.rep }, group: g };
  }
  function outside(ip = OUTSIDE_IP) {
    return { id: "outside", label: "Outside the cluster", namespace: null, endpoint: { kind: "ip", ip }, group: null };
  }

  // src/ui/common.ts
  function message(err) {
    return err instanceof Error ? err.message : String(err);
  }
  function showError(err) {
    const node = document.getElementById("error");
    if (!node) return;
    node.textContent = message(err);
    node.hidden = false;
  }
  var KEY = "simulate";
  async function askSimulator(q) {
    await k8sdockside.storage?.set(KEY, q).catch(() => null);
    await k8sdockside.openView("simulator");
  }
  function openParty(p) {
    if (!p.group) return;
    const ref = groupRef(p.group);
    void k8sdockside.open({ kind: ref.kind, namespace: ref.namespace, name: ref.name }).catch(showError);
  }
  function openPolicy(np) {
    void k8sdockside.open({ kind: "networkpolicies", namespace: np.metadata.namespace, name: np.metadata.name }).catch(showError);
  }
  function partyName(p) {
    return p.namespace === null ? `${p.label} (${p.endpoint.kind === "ip" ? p.endpoint.ip : ""})` : `${p.namespace}/${p.label}`;
  }

  // src/ui/load.ts
  var OTHERS = [
    ["crd:ciliumnetworkpolicies.cilium.io", "CiliumNetworkPolicy"],
    ["crd:ciliumclusterwidenetworkpolicies.cilium.io", "CiliumClusterwideNetworkPolicy"],
    ["crd:networkpolicies.crd.projectcalico.org", "Calico NetworkPolicy"],
    ["crd:globalnetworkpolicies.crd.projectcalico.org", "Calico GlobalNetworkPolicy"],
    ["crd:adminnetworkpolicies.policy.networking.k8s.io", "AdminNetworkPolicy"],
    ["crd:baselineadminnetworkpolicies.policy.networking.k8s.io", "BaselineAdminNetworkPolicy"]
  ];
  async function list(kind, required = false) {
    try {
      return await k8sdockside.list({ kind });
    } catch (err) {
      if (required) throw err;
      return [];
    }
  }
  async function load() {
    const [pods, policies, namespaces, replicasets, jobs, daemonsets, ...others] = await Promise.all([
      list("pods", true),
      list("networkpolicies", true),
      list("namespaces"),
      list("replicasets"),
      list("jobs"),
      list("daemonsets"),
      ...OTHERS.map(([kind]) => list(kind))
    ]);
    const engines = { others: {}, cni: "" };
    OTHERS.forEach(([, label], i) => {
      const n = others[i]?.length ?? 0;
      if (n) engines.others[label] = n;
    });
    const dsNames = daemonsets.map((d) => d.metadata.name);
    if (dsNames.some((n) => n === "cilium" || n.startsWith("cilium-agent"))) engines.cni = "cilium";
    else if (dsNames.some((n) => n === "calico-node" || n.startsWith("canal"))) engines.cni = "calico";
    else if (dsNames.some((n) => n.includes("flannel"))) engines.cni = "flannel";
    return { pods, policies, namespaces, groups: groupPods(pods, replicasets, jobs), world: new World(policies, namespaces), engines };
  }

  // src/pages/pod.ts
  var SHOWN = 10;
  async function start() {
    const pod = await k8sdockside.object();
    const data = await load();
    const ns = pod.metadata.namespace ?? "";
    const own = data.groups.find((g) => g.pods.some((p) => p.metadata.name === pod.metadata.name && p.metadata.namespace === ns));
    const me = own ? { ...party(own), endpoint: { kind: "pod", pod } } : { id: `${ns}/pods/${pod.metadata.name}`, label: pod.metadata.name, namespace: ns, endpoint: { kind: "pod", pod }, group: null };
    const others = [...data.groups.filter((g) => g.id !== own?.id).map(party), outside()];
    const column = (direction) => {
      const title = direction === "ingress" ? "Who can connect to it" : "What it can connect to";
      const box = el("div", { class: "side" }, el("div", { class: "side-title" }, title));
      if (pod.spec?.hostNetwork) {
        box.append(el("p", {}, "It runs on the host network, where NetworkPolicy does not apply."));
        return box;
      }
      const policies = data.world.selecting(pod, direction);
      if (!policies.length) {
        box.classList.add("open");
        box.append(el("p", {}, direction === "ingress" ? "Not isolated: anything may connect to it." : "Not isolated: it may connect anywhere."));
        return box;
      }
      box.append(el("p", { class: "dim small" }, "Isolated by ", ...policies.flatMap((np, i) => [i ? ", " : "", button(np.metadata.name, () => openPolicy(np), { class: "link mono" })])));
      const reach = [];
      for (const o of others) {
        const v = direction === "ingress" ? evaluate(o.endpoint, me.endpoint, data.world) : evaluate(me.endpoint, o.endpoint, data.world);
        if (cellOf(v.allowed) !== "none") reach.push({ p: o, set: v.allowed });
      }
      if (!reach.length) {
        box.classList.add("closed");
        box.append(el("p", { class: "deny" }, direction === "ingress" ? "Nothing may connect to it." : "It may connect to nothing."));
        return box;
      }
      const list2 = el("ul", { class: "reach" });
      for (const r of reach.slice(0, SHOWN)) {
        const name = r.p.group ? button(partyName(r.p), () => openParty(r.p), { class: "link" }) : el("span", {}, partyName(r.p));
        const why = button("why", () => void askSimulator(direction === "ingress" ? { from: r.p.id, to: me.group ? me.id : "" } : { from: me.group ? me.id : "", to: r.p.id }).catch(showError), { class: "link small" });
        list2.append(el("li", {}, el("span", { class: `cell c-${cellOf(r.set)} static` }), name, el("span", { class: "dim small" }, describe(r.set)), why));
      }
      box.append(list2);
      if (reach.length > SHOWN) box.append(el("p", { class: "faint small" }, `and ${reach.length - SHOWN} more — see the matrix.`));
      return box;
    };
    replace(byId("main"), el("div", { class: "sides two" }, column("ingress"), column("egress")));
  }
  start().catch(showError);
})();
