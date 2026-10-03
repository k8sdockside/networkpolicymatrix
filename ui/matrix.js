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
  function svg(markup, className = "icon") {
    const holder = document.createElement("span");
    holder.innerHTML = markup;
    const node = holder.firstElementChild;
    if (!node) throw new Error("svg() was given no element");
    node.setAttribute("class", className);
    return node;
  }
  function append(parent, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
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
  function contains(set, protocol, port) {
    return set.some((r) => r.protocol === protocol && r.from <= port && port <= r.to);
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

  // src/model/summary.ts
  function posture(groups, policies, world) {
    const byNs = /* @__PURE__ */ new Map();
    for (const g of groups) byNs.set(g.namespace, [...byNs.get(g.namespace) ?? [], g]);
    const out = [];
    for (const [namespace, gs] of byNs) {
      let ingress = 0;
      let egress = 0;
      for (const g of gs) {
        if (world.selecting(g.rep, "ingress").length) ingress++;
        if (world.selecting(g.rep, "egress").length) egress++;
      }
      const state = ingress === gs.length ? "isolated" : ingress === 0 && egress === 0 ? "open" : "partial";
      out.push({ namespace, workloads: gs.length, ingress, egress, policies: policies.filter((p) => (p.metadata.namespace ?? "") === namespace).length, state });
    }
    const rank = { open: 0, partial: 1, isolated: 2 };
    return out.sort((a, b) => rank[a.state] - rank[b.state] || a.namespace.localeCompare(b.namespace));
  }
  function postureCounts(list2) {
    const out = { isolated: 0, partial: 0, open: 0 };
    for (const p of list2) out[p.state]++;
    return out;
  }
  function tally(cells2) {
    const t = { all: 0, some: 0, none: 0, total: 0 };
    for (const c of cells2) {
      t[c]++;
      t.total++;
    }
    return t;
  }
  function percent(n, total) {
    return total > 0 ? Math.round(n / total * 100) : 0;
  }
  function toneCounts(list2) {
    const out = { error: 0, warn: 0, info: 0 };
    for (const f of list2) out[f.tone]++;
    return out;
  }
  function idlePolicies(pods, policies) {
    return policies.filter((np) => {
      const ns = np.metadata.namespace ?? "";
      return !pods.some((p) => (p.metadata.namespace ?? "") === ns && matches(np.spec?.podSelector ?? {}, p.metadata.labels));
    });
  }
  function arcs(t) {
    if (!t.total) return [];
    const out = [];
    let at = 0;
    for (const key of ["all", "some", "none"]) {
      const length = t[key] / t.total;
      if (length > 0) out.push({ key, start: at, length });
      at += length;
    }
    return out;
  }

  // src/model/findings.ts
  function findings(groups, pods, policies, world, engines) {
    const out = [];
    if (engines.cni === "flannel") {
      out.push({
        tone: "error",
        title: "Flannel does not enforce NetworkPolicy",
        text: "This cluster runs Flannel, which ignores NetworkPolicy on its own. Unless something else enforces them, everything below is what the policies say, not what the network does.",
        about: []
      });
    }
    for (const [kind, n] of Object.entries(engines.others)) {
      if (!n) continue;
      out.push({
        tone: "warn",
        title: `${n} ${kind}${n === 1 ? "" : "s"} not included`,
        text: `This plugin reads Kubernetes NetworkPolicy only. ${kind} rules are enforced on top of them, so real traffic may be allowed less, or more, than shown.`,
        about: []
      });
    }
    const byNs = /* @__PURE__ */ new Map();
    for (const g of groups) byNs.set(g.namespace, [...byNs.get(g.namespace) ?? [], g]);
    const covered = new Set(policies.map((p) => p.metadata.namespace ?? ""));
    const open = [...byNs.keys()].filter((ns) => !covered.has(ns)).sort();
    if (open.length) {
      out.push({
        tone: "info",
        title: `${open.length} namespace${open.length === 1 ? " has" : "s have"} no policies`,
        text: "Every pod in them accepts connections from anywhere and may connect anywhere.",
        about: open
      });
    }
    const dns = pods.find(
      (p) => p.metadata.namespace === "kube-system" && (p.metadata.labels?.["k8s-app"] === "kube-dns" || p.metadata.labels?.["k8s-app"] === "coredns") && p.status?.phase === "Running"
    );
    if (dns) {
      const blind = groups.filter((g) => {
        if (!world.selecting(g.rep, "egress").length) return false;
        const allowed = evaluate({ kind: "pod", pod: g.rep }, { kind: "pod", pod: dns }, world).allowed;
        return !contains(allowed, "UDP", 53) && !contains(allowed, "TCP", 53);
      });
      if (blind.length) {
        out.push({
          tone: "warn",
          title: `${blind.length} workload${blind.length === 1 ? "" : "s"} cannot reach DNS`,
          text: "Their egress is restricted and nothing allows port 53 to the cluster DNS in kube-system, so looking up any name fails.",
          about: blind.map((g) => `${g.namespace}/${g.name}`)
        });
      }
    }
    const idle = idlePolicies(pods, policies);
    if (idle.length) {
      out.push({
        tone: "info",
        title: `${idle.length} polic${idle.length === 1 ? "y selects" : "ies select"} no pods`,
        text: "They change nothing today. Often a label that does not match what the workload has, or a workload that is gone.",
        about: idle.map((np) => `${np.metadata.namespace}/${np.metadata.name}`)
      });
    }
    const sealed = groups.filter((g) => {
      const policiesIn = world.selecting(g.rep, "ingress");
      if (!policiesIn.length) return false;
      return policiesIn.every((np) => !(np.spec?.ingress ?? []).length);
    });
    if (sealed.length) {
      out.push({
        tone: "info",
        title: `${sealed.length} workload${sealed.length === 1 ? " accepts" : "s accept"} no connections`,
        text: "Selected for ingress by policies without a single ingress rule: a default deny, and nothing allowing anything back in.",
        about: sealed.map((g) => `${g.namespace}/${g.name}`)
      });
    }
    return out;
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
  function matrix(rows, cols, world) {
    return rows.map(
      (r) => cols.map((c) => {
        if (r.endpoint.kind === "ip" && c.endpoint.kind === "ip") return NONE;
        return evaluate(r.endpoint, c.endpoint, world).allowed;
      })
    );
  }
  function combine(cells2) {
    if (!cells2.length) return "none";
    if (cells2.every((c) => c === "all")) return "all";
    if (cells2.every((c) => c === "none")) return "none";
    return "some";
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
  function clearError() {
    const node = document.getElementById("error");
    if (node) node.hidden = true;
  }
  function readHash() {
    const out = {};
    for (const pair of location.hash.replace(/^#/, "").split("&")) {
      const cut = pair.indexOf("=");
      if (cut <= 0) continue;
      try {
        out[pair.slice(0, cut)] = decodeURIComponent(pair.slice(cut + 1));
      } catch {
      }
    }
    return out;
  }
  function writeHash(values) {
    const text = Object.entries(values).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    try {
      history.replaceState(null, "", text ? "#" + text : location.pathname);
    } catch {
      try {
        location.hash = text;
      } catch {
      }
    }
  }
  function when() {
    const now = /* @__PURE__ */ new Date();
    return k8sdockside.format?.time(now) ?? now.toLocaleTimeString();
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
  function policyLink(np) {
    return button(`${np.metadata.namespace}/${np.metadata.name}`, () => openPolicy(np), { class: "link mono" });
  }
  function sideBlock(title, side2, self, other, port) {
    const box = el("div", { class: "side" }, el("div", { class: "side-title" }, title));
    const verb = side2?.direction === "egress" ? "send to" : "accept from";
    if (!side2) {
      box.append(el("p", { class: "dim" }, "Outside the cluster: no NetworkPolicy applies to this end."));
      box.classList.add("open");
      return box;
    }
    if (side2.exempt) {
      box.append(el("p", {}, `No policy applies: ${side2.exempt}.`));
      box.classList.add("open");
      return box;
    }
    if (!side2.isolated) {
      box.append(el("p", {}, `No policy selects ${partyName(self)} for ${side2.direction}, so it may ${verb} anything.`));
      box.classList.add("open");
      return box;
    }
    box.append(
      el("p", { class: "dim" }, `Isolated for ${side2.direction} by ${side2.policies.length === 1 ? "one policy" : `${side2.policies.length} policies`}: `, ...side2.policies.flatMap((np, i) => [i ? ", " : "", policyLink(np)]))
    );
    if (!side2.matches.length) {
      box.append(el("p", { class: "deny" }, `No rule in them lets it ${verb} ${partyName(other)}.`));
      box.classList.add("closed");
      return box;
    }
    const rules = el("ul", { class: "rules" });
    for (const m of side2.matches) {
      const rule = (side2.direction === "ingress" ? m.policy.spec?.ingress : m.policy.spec?.egress)?.[m.rule];
      rules.append(
        el(
          "li",
          {},
          policyLink(m.policy),
          el("span", { class: "faint" }, ` rule ${m.rule + 1}: `),
          el("span", {}, rule ? describeRule(rule, side2.direction) : ""),
          el("div", { class: "small dim" }, `matches as ${m.peer} · opens ${isEmpty(m.ports) ? "no port this pod has" : describe(m.ports)}`)
        )
      );
    }
    box.append(rules);
    const shut = port ? !contains(side2.allowed, protocolOf(port.protocol), port.port) : isEmpty(side2.allowed);
    if (port && shut) box.append(el("p", { class: "deny" }, `None of them opens ${port.protocol} ${port.port}.`));
    box.classList.add(shut ? "closed" : "open");
    return box;
  }
  function trace(src, dst, v, port, allowedAtPort) {
    let head;
    let tone;
    if (port) {
      tone = allowedAtPort ? "all" : "none";
      head = `${allowedAtPort ? "Allowed" : "Blocked"}: ${partyName(src)} → ${partyName(dst)} on ${port.protocol} ${port.port}`;
    } else {
      tone = isEmpty(v.allowed) ? "none" : isAll(v.allowed) ? "all" : "some";
      head = isEmpty(v.allowed) ? `Blocked: ${partyName(src)} cannot connect to ${partyName(dst)}` : `${partyName(src)} → ${partyName(dst)}: ${describe(v.allowed)}`;
    }
    return el(
      "section",
      { class: `trace tone-${tone}` },
      el("div", { class: "trace-head" }, head),
      el(
        "div",
        { class: "sides" },
        sideBlock(`Leaving ${partyName(src)}`, v.egress, src, dst, port),
        el("div", { class: "arrow", "aria-hidden": "true" }, "→"),
        sideBlock(`Arriving at ${partyName(dst)}`, v.ingress, dst, src, port)
      ),
      el("p", { class: "small faint" }, "Worked out from one running pod of each workload. Replies to an allowed connection are always allowed.")
    );
  }
  var LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="3" width="5" height="5" rx="1" opacity=".35"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="5" height="5" rx="1" opacity=".35"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16" y="9.5" width="5" height="5" rx="1" opacity=".35"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1" opacity=".35"/><rect x="16" y="16" width="5" height="5" rx="1"/></g></svg>`;

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

  // src/pages/matrix.ts
  var hash = readHash();
  var level = hash.level === "wl" ? "wl" : "ns";
  var nsFilter = hash.ns ?? "";
  var showSystem = hash.system === "1";
  var selected = hash.row && hash.col ? { row: hash.row, col: hash.col } : null;
  var data = null;
  var found = [];
  var parties = [];
  var cells = /* @__PURE__ */ new Map();
  var CELL_TEXT = { all: "any port", some: "some ports", none: "nothing" };
  var POSTURE_TEXT = { isolated: "isolated", partial: "partly isolated", open: "wide open" };
  var ICON = {
    error: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    warn: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.7H1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.3v3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>`,
    info: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".9" fill="currentColor"/></svg>`
  };
  var ICON_OK = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2l2 2 3.8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  var ICON_SHIELD = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4.2c0 3.3-2.3 5.8-5.5 6.8-3.2-1-5.5-3.5-5.5-6.8V3.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  var ICON_BOX = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6 3v7l-6 3-6-3v-7z M2 4.5l6 3 6-3 M8 7.5v7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  var ICON_DOC = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5l3 3v10h-8.5z M9.5 1.5v3h3 M6 8h5 M6 10.5h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  var ICON_ROUTE = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="12.5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12.5" cy="3.5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 12.5h4a2.5 2.5 0 000-5h-3a2.5 2.5 0 010-5h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  async function start() {
    const ctx = await k8sdockside.ready();
    byId("logo").append(svg(LOGO, "mark"));
    byId("where").textContent = ctx.contextName;
    byId("lvl-ns").addEventListener("click", () => setLevel("ns"));
    byId("lvl-wl").addEventListener("click", () => setLevel("wl"));
    byId("namespace").addEventListener("change", (e) => {
      nsFilter = e.target.value;
      selected = null;
      compute();
      render();
    });
    const sys = byId("system");
    sys.checked = showSystem;
    sys.addEventListener("change", () => {
      showSystem = sys.checked;
      selected = null;
      compute();
      render();
    });
    byId("refresh").addEventListener("click", () => void refresh());
    document.addEventListener("scroll", () => byId("tip").hidden = true, { capture: true, passive: true });
    await refresh();
  }
  function setLevel(next, ns) {
    level = next;
    if (ns !== void 0) nsFilter = ns;
    selected = null;
    compute();
    render();
  }
  async function refresh() {
    const btn = byId("refresh");
    btn.disabled = true;
    try {
      data = await load();
      clearError();
      byId("where").textContent = `${(await k8sdockside.ready()).contextName} · ${data.policies.length} NetworkPolicies · read at ${when()}`;
      found = findings(data.groups, data.pods, data.policies, data.world, data.engines);
      drawFindings(found);
      compute();
      render();
    } catch (err) {
      showError(err);
      if (!data) {
        replace(byId("overview"));
        replace(byId("main"), emptyState(ICON.error, "Could not read the cluster", "The error is above. Press Refresh to try again."));
      }
    } finally {
      btn.disabled = false;
    }
  }
  function visibleNamespace(ns) {
    return showSystem || !ns.startsWith("kube-");
  }
  function compute() {
    if (!data) return;
    let groups = data.groups.filter((g) => visibleNamespace(g.namespace));
    if (level === "wl" && nsFilter) groups = groups.filter((g) => g.namespace === nsFilter);
    parties = [...groups.map(party), outside()];
    const m = matrix(parties, parties, data.world);
    cells = /* @__PURE__ */ new Map();
    parties.forEach((r, i) => parties.forEach((c, j) => cells.set(`${r.id}>${c.id}`, m[i][j])));
  }
  function cellAt(row, col) {
    return cells.get(`${row}>${col}`) ?? [];
  }
  function pairTally() {
    const states = [];
    for (const r of parties) for (const c of parties) if (r.namespace !== null || c.namespace !== null) states.push(cellOf(cellAt(r.id, c.id)));
    return tally(states);
  }
  function axes() {
    if (level === "wl") {
      return parties.map((p) => ({ id: p.id, label: p.label, sub: p.namespace ?? (p.endpoint.kind === "ip" ? p.endpoint.ip : ""), members: [p] }));
    }
    const byNs = /* @__PURE__ */ new Map();
    for (const p of parties) {
      if (p.namespace === null) continue;
      byNs.set(p.namespace, [...byNs.get(p.namespace) ?? [], p]);
    }
    const out = [...byNs.entries()].map(([ns, members]) => ({ id: `ns:${ns}`, label: ns, sub: `${members.length} workload${members.length === 1 ? "" : "s"}`, members }));
    const world = parties.find((p) => p.namespace === null);
    if (world) out.push({ id: world.id, label: world.label, sub: world.endpoint.kind === "ip" ? world.endpoint.ip : "", members: [world] });
    return out;
  }
  function blockCell(rows, cols) {
    const states = [];
    for (const r of rows) {
      for (const c of cols) {
        if (r.namespace === null && c.namespace === null) continue;
        states.push(cellOf(cellAt(r.id, c.id)));
      }
    }
    return { cell: combine(states), open: states.filter((s) => s !== "none").length, total: states.length, na: !states.length };
  }
  function blockText(r, c, b) {
    if (r.members.length === 1 && c.members.length === 1) return describe(cellAt(r.members[0].id, c.members[0].id));
    return `${b.open} of ${b.total} workload pair${b.total === 1 ? "" : "s"} can connect`;
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }
  function donut(t) {
    const root = svgEl("svg", { viewBox: "0 0 42 42", class: "donut", "aria-hidden": "true" });
    root.append(svgEl("circle", { cx: 21, cy: 21, r: 15.915, class: "donut-track" }));
    for (const a of arcs(t)) {
      const len = a.length * 100;
      const gap = a.length < 1 ? Math.min(0.8, len / 3) : 0;
      root.append(svgEl("circle", { cx: 21, cy: 21, r: 15.915, class: `donut-seg c-${a.key}`, "stroke-dasharray": `${len - gap} ${100 - len + gap}`, "stroke-dashoffset": 25 - a.start * 100 }));
    }
    return root;
  }
  function stack(parts) {
    const total = parts.reduce((s, p) => s + p.n, 0);
    const bar = el("div", { class: "stack", role: "img", "aria-label": parts.map((p) => `${p.n} ${p.label}`).join(", ") });
    for (const p of parts) if (p.n) bar.append(el("span", { class: `stack-part ${p.cls}`, style: `flex-grow:${p.n}`, title: `${p.n} ${p.label}` }));
    if (!total) bar.append(el("span", { class: "stack-part empty-part", style: "flex-grow:1" }));
    return bar;
  }
  function meter(label, n, total) {
    const p = percent(n, total);
    return el(
      "div",
      { class: "meter" },
      el("div", { class: "meter-top" }, el("span", { class: "dim" }, label), el("span", {}, el("strong", {}, String(n)), el("span", { class: "faint" }, ` / ${total}`))),
      el("div", { class: "meter-bar" }, el("span", { class: `meter-fill ${p === 100 ? "full" : p === 0 ? "zero" : ""}`, style: `width:${p}%` }))
    );
  }
  function tile(icon, title, value, ...body) {
    return el(
      "div",
      { class: "tile" },
      el("div", { class: "tile-head" }, svg(icon, "ico"), el("span", {}, title)),
      el("div", { class: "tile-value" }, value),
      ...body
    );
  }
  function dotLegend(items) {
    return el("div", { class: "mini-legend" }, ...items.map((i) => el("span", { class: "ml" }, el("span", { class: `dot ${i.cls}` }), el("strong", {}, String(i.n)), ` ${i.label}`)));
  }
  function renderOverview() {
    if (!data) return;
    const groups = data.groups.filter((g) => visibleNamespace(g.namespace));
    const policies = data.policies.filter((p) => visibleNamespace(p.metadata.namespace ?? ""));
    const nsList = posture(groups, policies, data.world);
    const pc = postureCounts(nsList);
    const ingress = nsList.reduce((s, n) => s + n.ingress, 0);
    const egress = nsList.reduce((s, n) => s + n.egress, 0);
    const idle = idlePolicies(data.pods, policies).length;
    const t = pairTally();
    const tones = toneCounts(found);
    const nsCovered = new Set(policies.map((p) => p.metadata.namespace ?? "")).size;
    const nsTile = tile(
      ICON_SHIELD,
      "Namespaces",
      String(nsList.length),
      stack([
        { n: pc.isolated, cls: "p-isolated", label: "isolated" },
        { n: pc.partial, cls: "p-partial", label: "partly isolated" },
        { n: pc.open, cls: "p-open", label: "wide open" }
      ]),
      dotLegend([
        { n: pc.isolated, cls: "p-isolated", label: "isolated" },
        { n: pc.partial, cls: "p-partial", label: "partly" },
        { n: pc.open, cls: "p-open", label: "wide open" }
      ])
    );
    const wlTile = tile(ICON_BOX, "Workloads", String(groups.length), meter("Ingress isolated", ingress, groups.length), meter("Egress isolated", egress, groups.length));
    const polTile = tile(
      ICON_DOC,
      "NetworkPolicies",
      String(policies.length),
      el(
        "div",
        { class: "tile-lines" },
        el("div", {}, el("strong", {}, String(nsCovered)), el("span", { class: "dim" }, ` of ${nsList.length} namespace${nsList.length === 1 ? "" : "s"} have one`)),
        idle ? el("div", { class: "warn-text" }, svg(ICON.warn, "ico-s"), ` ${idle} select${idle === 1 ? "s" : ""} no pods`) : el("div", { class: "ok-text" }, svg(ICON_OK, "ico-s"), policies.length ? " every one selects pods" : " none yet")
      )
    );
    const openShare = percent(t.all + t.some, t.total);
    const pathsTile = el(
      "div",
      { class: "tile" },
      el("div", { class: "tile-head" }, svg(ICON_ROUTE, "ico"), el("span", {}, level === "wl" && nsFilter ? `Paths in ${nsFilter}` : "Open paths")),
      el(
        "div",
        { class: "donut-row" },
        el("div", { class: "donut-box" }, donut(t), el("div", { class: "donut-label" }, el("strong", {}, `${openShare}%`), el("span", { class: "faint" }, "open"))),
        dotLegend([
          { n: t.all, cls: "c-all", label: "any port" },
          { n: t.some, cls: "c-some", label: "some ports" },
          { n: t.none, cls: "c-none", label: "blocked" }
        ])
      ),
      el("div", { class: "faint small" }, `${t.total} workload pair${t.total === 1 ? "" : "s"}, outside included`)
    );
    const fTile = tile(
      found.length ? ICON[tones.error ? "error" : tones.warn ? "warn" : "info"] : ICON_OK,
      "Findings",
      String(found.length),
      found.length ? el(
        "div",
        { class: "pills" },
        ...["error", "warn", "info"].filter((k) => tones[k]).map(
          (k) => button("", () => byId("findings").scrollIntoView({ behavior: "smooth", block: "start" }), { class: `pill tone-${k}`, title: `Show the ${k === "warn" ? "warnings" : k === "error" ? "errors" : "notes"}` })
        )
      ) : el("div", { class: "ok-text" }, svg(ICON_OK, "ico-s"), " nothing to flag")
    );
    fTile.querySelectorAll(".pill").forEach((b) => {
      const k = ["error", "warn", "info"].find((x) => b.classList.contains(`tone-${x}`));
      b.append(svg(ICON[k], "ico-s"), el("strong", {}, String(tones[k])), ` ${k === "error" ? "critical" : k === "warn" ? "warning" : "note"}${tones[k] === 1 ? "" : "s"}`);
    });
    if (tones.error) fTile.classList.add("alert");
    replace(byId("overview"), el("div", { class: "tiles" }, nsTile, wlTile, polTile, pathsTile, fTile));
    renderPosture(nsList, policies.length === 0 && groups.length > 0);
  }
  function renderPosture(list2, noPolicies) {
    const box = byId("posture");
    if (!list2.length) return replace(box);
    const hero = noPolicies ? el(
      "div",
      { class: "hero" },
      svg(ICON.info, "ico"),
      el(
        "div",
        {},
        el("strong", {}, "No NetworkPolicies in view"),
        el("div", { class: "dim" }, "Nothing is isolated: every pod can connect to every other pod and to the outside world, on any port. The matrix below is all green.")
      )
    ) : null;
    const chips = list2.map((n) => {
      const b = button("", () => setLevel("wl", n.namespace), {
        class: `ns-chip p-${n.state}${level === "wl" && nsFilter === n.namespace ? " on" : ""}`,
        title: `${n.namespace}: ${POSTURE_TEXT[n.state]} · ${n.ingress}/${n.workloads} ingress-isolated · ${n.egress}/${n.workloads} egress-isolated · ${n.policies} polic${n.policies === 1 ? "y" : "ies"}. Click for its workloads.`
      });
      b.append(
        el("span", { class: `dot p-${n.state}` }),
        el("span", { class: "ns-name" }, n.namespace),
        el(
          "span",
          { class: "ns-dirs" },
          el("span", { class: `dir ${dirClass(n.ingress, n.workloads)}` }, "in"),
          el("span", { class: `dir ${dirClass(n.egress, n.workloads)}` }, "out")
        )
      );
      return b;
    });
    replace(
      box,
      hero,
      el(
        "div",
        { class: "posture-head" },
        el("h2", {}, "Namespace posture"),
        el("span", { class: "faint small" }, 'Wide open first. "in" and "out": every, some or no workload isolated for ingress and egress. Click a namespace to see its workloads.')
      ),
      el("div", { class: "chips" }, ...chips)
    );
  }
  function dirClass(n, total) {
    return n === 0 ? "d-none" : n === total ? "d-all" : "d-some";
  }
  var currentAxes = [];
  function render() {
    if (!data) return;
    byId("lvl-ns").classList.toggle("on", level === "ns");
    byId("lvl-wl").classList.toggle("on", level === "wl");
    byId("ns-wrap").hidden = level !== "wl";
    const nsSel = byId("namespace");
    const namespaces = [...new Set(data.groups.map((g) => g.namespace))].filter(visibleNamespace).sort();
    replace(nsSel, el("option", { value: "" }, "Every namespace"), ...namespaces.map((ns) => el("option", { value: ns }, ns)));
    nsSel.value = namespaces.includes(nsFilter) ? nsFilter : "";
    writeHash({ level, ns: level === "wl" ? nsFilter : "", system: showSystem ? "1" : "", row: selected?.row ?? "", col: selected?.col ?? "" });
    renderOverview();
    const ax = axes();
    currentAxes = ax;
    const blocks = ax.map((r) => ax.map((c) => blockCell(r.members, c.members)));
    const shown = tally(blocks.flat().filter((b) => !b.na).map((b) => b.cell));
    const table = el("table", { class: `matrix ${level}` });
    const headRow = el("tr", {}, el("th", { class: "corner" }, el("span", { class: "axis-hint" }, el("span", {}, "to →"), el("span", {}, "from ↓"))));
    ax.forEach((c, j) => headRow.append(el("th", { class: `col-h${c.members.every((m) => m.namespace === null) ? " world" : ""}`, title: `${c.label} ${c.sub}`, "data-c": j }, el("span", {}, c.label))));
    table.append(el("thead", {}, headRow));
    const body = el("tbody");
    ax.forEach((r, i) => {
      const tr = el("tr", {}, el("th", { class: `row-h${r.members.every((m) => m.namespace === null) ? " world" : ""}`, title: `${r.label} ${r.sub}`, "data-r": i }, el("span", { class: "row-label" }, r.label), el("span", { class: "faint small" }, r.sub)));
      ax.forEach((c, j) => {
        const b = blocks[i][j];
        const td = el("td");
        if (!b.na) {
          const tip = `${r.label} → ${c.label}: ${blockText(r, c, b)}`;
          const multi = !(r.members.length === 1 && c.members.length === 1);
          const node = button("", () => select(r.id, c.id), {
            class: `cell c-${b.cell}${r.id === c.id ? " diag" : ""}${multi && b.cell === "some" ? " part" : ""}`,
            "aria-label": tip,
            "data-r": i,
            "data-c": j,
            style: multi && b.cell === "some" ? `--p:${percent(b.open, b.total)}%` : void 0
          });
          if (selected?.row === r.id && selected.col === c.id) node.classList.add("sel");
          td.append(node);
        }
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    hookHover(table, blocks);
    const legend = el(
      "div",
      { class: "legend" },
      ...["all", "some", "none"].map((c) => el("span", { class: "leg" }, el("span", { class: `cell c-${c} static` }), el("span", {}, CELL_TEXT[c]), el("span", { class: "leg-n" }, String(shown[c])))),
      level === "ns" ? el("span", { class: "leg" }, el("span", { class: "cell c-some part static", style: "--p:60%" }), el("span", { class: "faint" }, "fill = share of pairs open")) : null,
      el("span", { class: "faint small grow right" }, "Rows connect to columns. Hover for a summary, click for the reason.")
    );
    const mainTitle = el(
      "div",
      { class: "section-head" },
      el("h2", {}, level === "ns" ? "Namespace to namespace" : nsFilter ? `Workloads in ${nsFilter}` : "Workload to workload"),
      level === "wl" && nsFilter ? button("← All namespaces", () => setLevel("ns", ""), { class: "ghost small-btn" }) : null
    );
    replace(
      byId("main"),
      mainTitle,
      legend,
      parties.length > 1 ? el("div", { class: "matrix-wrap" }, table) : emptyState(ICON_BOX, "No running workloads here", showSystem ? "There are no running pods in view." : 'There are no running pods in view. Tick "Show kube-* namespaces" to include the system ones.')
    );
    renderDetail(ax);
  }
  function emptyState(icon, title, text) {
    return el("div", { class: "empty-state" }, svg(icon, "ico-l"), el("strong", {}, title), el("span", { class: "dim" }, text));
  }
  function hookHover(table, blocks) {
    const tip = byId("tip");
    let lit = [];
    const clear = () => {
      for (const n of lit) n.classList.remove("hl");
      lit = [];
      tip.hidden = true;
    };
    table.addEventListener("mouseleave", clear);
    table.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".cell[data-r]");
      if (!cell) return clear();
      const i = Number(cell.dataset.r);
      const j = Number(cell.dataset.c);
      for (const n of lit) n.classList.remove("hl");
      lit = [...table.querySelectorAll(`th[data-r="${i}"], th[data-c="${j}"]`)];
      for (const n of lit) n.classList.add("hl");
      const r = currentAxes[i];
      const c = currentAxes[j];
      const b = blocks[i]?.[j];
      if (!r || !c || !b) return;
      const verdict = b.cell === "all" ? "Allowed on any port" : b.cell === "some" ? b.open === b.total ? "Allowed on some ports" : "Partly allowed" : "Blocked";
      replace(
        tip,
        el("div", { class: "tip-route" }, el("span", {}, r.label), el("span", { class: "faint" }, " → "), el("span", {}, c.label)),
        el("div", { class: `tip-verdict v-${b.cell}` }, el("span", { class: `dot c-${b.cell}` }), verdict),
        el("div", { class: "dim" }, blockText(r, c, b)),
        el("div", { class: "faint small" }, "Click for the reason")
      );
      tip.hidden = false;
      const box = cell.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let x = box.right + 10;
      if (x + w > window.innerWidth - 8) x = Math.max(8, box.left - w - 10);
      let y = box.top + box.height / 2 - h / 2;
      y = Math.min(Math.max(8, y), window.innerHeight - h - 8);
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
  }
  function select(row, col) {
    selected = selected?.row === row && selected.col === col ? null : { row, col };
    byId("tip").hidden = true;
    render();
    if (selected) byId("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function renderDetail(ax) {
    const box = byId("detail");
    if (!selected || !data) return replace(box);
    const r = ax.find((a) => a.id === selected.row);
    const c = ax.find((a) => a.id === selected.col);
    if (!r || !c) return replace(box);
    if (r.members.length === 1 && c.members.length === 1) return replace(box, pairDetail(r.members[0], c.members[0]));
    const pairs = [];
    for (const s of r.members) for (const d of c.members) if (s.namespace !== null || d.namespace !== null) pairs.push({ src: s, dst: d, set: cellAt(s.id, d.id) });
    const rank = { all: 0, some: 1, none: 2 };
    pairs.sort((a, b) => rank[cellOf(a.set)] - rank[cellOf(b.set)] || partyName(a.src).localeCompare(partyName(b.src)));
    const t = tally(pairs.map((p) => cellOf(p.set)));
    const pick = el("div", { id: "pair" });
    const rows = pairs.map((p) => {
      const tr = el(
        "tr",
        { class: "pick-row" },
        el("td", {}, el("span", { class: `cell c-${cellOf(p.set)} static` })),
        el("td", {}, partyName(p.src)),
        el("td", { class: "faint" }, "→"),
        el("td", {}, partyName(p.dst)),
        el("td", { class: "dim" }, describe(p.set))
      );
      tr.addEventListener("click", () => {
        for (const other of tr.parentElement?.children ?? []) other.classList.remove("sel");
        tr.classList.add("sel");
        replace(pick, pairDetail(p.src, p.dst));
      });
      return tr;
    });
    replace(
      box,
      el(
        "div",
        { class: "detail-head" },
        el("h3", {}, `${r.label} → ${c.label}`),
        button("Close", () => select(r.id, c.id), { class: "ghost small-btn" })
      ),
      stack([
        { n: t.all, cls: "c-all", label: "pairs on any port" },
        { n: t.some, cls: "c-some", label: "pairs on some ports" },
        { n: t.none, cls: "c-none", label: "pairs blocked" }
      ]),
      el("p", { class: "dim small" }, `${t.all} on any port · ${t.some} on some ports · ${t.none} blocked. Pick a pair for the reason.`),
      el("div", { class: "pairs" }, el("table", { class: "pair-table" }, el("tbody", {}, ...rows))),
      pick
    );
  }
  function pairDetail(src, dst) {
    const v = evaluate(src.endpoint, dst.endpoint, data.world);
    const t = trace(src, dst, v);
    const actions = el(
      "div",
      { class: "actions" },
      button(
        "Try a port in the simulator",
        () => void askSimulator({ from: src.id, to: dst.id, fromIp: src.endpoint.kind === "ip" ? src.endpoint.ip : void 0, toIp: dst.endpoint.kind === "ip" ? dst.endpoint.ip : void 0 }).catch(showError)
      )
    );
    if (src.group) actions.append(button(`Open ${src.label}`, () => openParty(src), { class: "ghost" }));
    if (dst.group && dst.id !== src.id) actions.append(button(`Open ${dst.label}`, () => openParty(dst), { class: "ghost" }));
    t.append(actions);
    return t;
  }
  function drawFindings(list2) {
    const box = byId("findings");
    if (!list2.length) return replace(box);
    const order = { error: 0, warn: 1, info: 2 };
    const sorted = [...list2].sort((a, b) => order[a.tone] - order[b.tone]);
    replace(
      box,
      el("div", { class: "section-head" }, el("h2", {}, "Worth knowing"), el("span", { class: "faint small" }, "Click one to see what it is about.")),
      el(
        "div",
        { class: "finding-grid" },
        ...sorted.map(
          (f) => el(
            "details",
            { class: `finding tone-${f.tone}` },
            el(
              "summary",
              {},
              svg(ICON[f.tone], "f-ico"),
              el("span", { class: "f-body" }, el("span", { class: "f-title" }, f.title), el("span", { class: "dim small f-text" }, f.text)),
              f.about.length ? el("span", { class: "f-count", title: `${f.about.length} affected` }, String(f.about.length)) : null
            ),
            f.about.length ? el("div", { class: "about" }, ...f.about.map((a) => el("span", { class: "tag mono" }, a))) : null
          )
        )
      )
    );
  }
  start().catch(showError);
})();
