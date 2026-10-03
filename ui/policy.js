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

  // src/model/ports.ts
  var PROTOCOLS = ["TCP", "UDP", "SCTP"];
  var ALL = PROTOCOLS.map((protocol) => ({ protocol, from: 1, to: 65535 }));
  function protocolOf(text) {
    const up = (text ?? "TCP").toUpperCase();
    return up === "UDP" || up === "SCTP" ? up : "TCP";
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
  function describeRule(rule, direction) {
    const peers = (direction === "ingress" ? rule.from : rule.to) ?? [];
    const who = peers.length ? peers.map(describePeer).join("; or ") : "anything";
    const ports = rule.ports?.length ? rule.ports.map((p) => {
      const proto = protocolOf(p.protocol);
      if (p.port === void 0) return `any ${proto} port`;
      return `${proto} ${p.port}${p.endPort ? `–${p.endPort}` : ""}`;
    }).join(", ") : "any port";
    return `${direction === "ingress" ? "from" : "to"} ${who}, on ${ports}`;
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
  function party(g) {
    return { id: g.id, label: g.name, namespace: g.namespace, endpoint: { kind: "pod", pod: g.rep }, group: g };
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
  function openParty(p) {
    if (!p.group) return;
    const ref = groupRef(p.group);
    void k8sdockside.open({ kind: ref.kind, namespace: ref.namespace, name: ref.name }).catch(showError);
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

  // src/pages/policy.ts
  async function start() {
    const np = await k8sdockside.object();
    const data = await load();
    const ns = np.metadata.namespace ?? "";
    const selected = data.groups.filter((g) => g.namespace === ns && g.pods.some((p) => matches(np.spec?.podSelector ?? {}, p.metadata.labels)));
    const t = types(np);
    const sel = describeSelector(np.spec?.podSelector);
    const block = (direction) => {
      if (!t[direction]) return null;
      const rules = (direction === "ingress" ? np.spec?.ingress : np.spec?.egress) ?? [];
      const box = el("div", { class: `side ${rules.length ? "open" : "closed"}` }, el("div", { class: "side-title" }, direction === "ingress" ? "Lets in" : "Lets out"));
      if (!rules.length) box.append(el("p", { class: "deny" }, direction === "ingress" ? "Nothing: it denies every connection in." : "Nothing: it denies every connection out."));
      else box.append(el("ol", { class: "rules" }, ...rules.map((r) => el("li", {}, describeRule(r, direction)))));
      return box;
    };
    replace(
      byId("main"),
      el(
        "p",
        {},
        `Selects ${sel ? `pods with ${sel}` : "every pod"} in ${ns}: `,
        selected.length ? el("span", {}, ...selected.flatMap((g, i) => [i ? ", " : "", button(g.name, () => openParty(party(g)), { class: "link" })])) : el("strong", { class: "deny" }, "none running right now"),
        "."
      ),
      el("p", { class: "dim small" }, `Isolates ${[t.ingress ? "ingress" : "", t.egress ? "egress" : ""].filter(Boolean).join(" and ")}. Other policies selecting the same pods add to what this one allows; none can take anything away.`),
      el("div", { class: t.ingress && t.egress ? "sides two" : "sides one" }, block("ingress"), block("egress")),
      el("p", {}, button("Open the matrix", () => void k8sdockside.openView("overview").catch(showError), { class: "ghost" }))
    );
  }
  start().catch(showError);
})();
