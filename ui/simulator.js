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
  function validIP(text) {
    return parseIP(text) !== null;
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
  var APP_KIND_VALUES = new Set(Object.values(APP_KIND));
  var OUTSIDE_IP = "203.0.113.10";
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
  async function takeQuestion() {
    const store = k8sdockside.storage;
    if (!store) return null;
    try {
      const q = await store.get(KEY);
      if (q) await store.remove(KEY);
      return q && typeof q.from === "string" && typeof q.to === "string" ? q : null;
    } catch {
      return null;
    }
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

  // src/pages/simulator.ts
  var OUTSIDE = "outside";
  var data = null;
  var parties = /* @__PURE__ */ new Map();
  var fromSel = byId("from");
  var toSel = byId("to");
  var fromIp = byId("from-ip");
  var toIp = byId("to-ip");
  var portIn = byId("port");
  var protoSel = byId("protocol");
  async function start() {
    const ctx = await k8sdockside.ready();
    byId("logo").append(svg(LOGO, "mark"));
    byId("where").textContent = ctx.contextName;
    const hash = readHash();
    const handed = await takeQuestion();
    const q = handed ?? { from: hash.from ?? "", to: hash.to ?? "", fromIp: hash.fromIp, toIp: hash.toIp, port: hash.port, protocol: hash.protocol };
    fromIp.value = q.fromIp ?? OUTSIDE_IP;
    toIp.value = q.toIp ?? "1.1.1.1";
    portIn.value = q.port ?? "";
    protoSel.value = protocolOf(q.protocol);
    for (const input of [fromSel, toSel, protoSel]) input.addEventListener("change", render);
    for (const input of [fromIp, toIp, portIn]) input.addEventListener("input", render);
    byId("form").addEventListener("submit", (e) => e.preventDefault());
    byId("swap").addEventListener("click", () => {
      [fromSel.value, toSel.value] = [toSel.value, fromSel.value];
      [fromIp.value, toIp.value] = [toIp.value, fromIp.value];
      render();
    });
    byId("refresh").addEventListener("click", () => void refresh(fromSel.value, toSel.value));
    await refresh(q.from, q.to);
  }
  async function refresh(from, to) {
    try {
      data = await load();
      clearError();
      byId("where").textContent = `${(await k8sdockside.ready()).contextName} · ${data.policies.length} NetworkPolicies · read at ${when()}`;
      parties = new Map(data.groups.map((g) => [g.id, party(g)]));
      fill(fromSel, from || data.groups[0]?.id || OUTSIDE);
      fill(toSel, to || data.groups[1]?.id || data.groups[0]?.id || OUTSIDE);
      render();
    } catch (err) {
      showError(err);
    }
  }
  function fill(sel, value) {
    const byNs = /* @__PURE__ */ new Map();
    for (const p of parties.values()) byNs.set(p.namespace ?? "", [...byNs.get(p.namespace ?? "") ?? [], p]);
    replace(
      sel,
      el("option", { value: OUTSIDE }, "Outside the cluster (an address)"),
      ...[...byNs.entries()].map(([ns, list2]) => {
        const group = el("optgroup", { label: ns });
        for (const p of list2) group.append(el("option", { value: p.id }, `${p.label}${p.group && p.group.kind !== "pods" ? "" : " (pod)"}`));
        return group;
      })
    );
    sel.value = value === OUTSIDE || parties.has(value) ? value : sel.options[1]?.value ?? OUTSIDE;
  }
  function resolve(sel, ip) {
    ip.hidden = sel.value !== OUTSIDE;
    if (sel.value !== OUTSIDE) return parties.get(sel.value) ?? "Pick something.";
    const addr = ip.value.trim();
    if (!validIP(addr)) return `"${addr}" is not an IP address.`;
    return outside(addr);
  }
  function render() {
    if (!data) return;
    const src = resolve(fromSel, fromIp);
    const dst = resolve(toSel, toIp);
    const portText = portIn.value.trim();
    const port = portText === "" ? null : Number(portText);
    writeHash({
      from: fromSel.value,
      to: toSel.value,
      fromIp: fromSel.value === OUTSIDE ? fromIp.value : "",
      toIp: toSel.value === OUTSIDE ? toIp.value : "",
      port: portText,
      protocol: protoSel.value === "TCP" ? "" : protoSel.value
    });
    const main = byId("main");
    if (typeof src === "string") return replace(main, el("p", { class: "empty" }, src));
    if (typeof dst === "string") return replace(main, el("p", { class: "empty" }, dst));
    if (src.namespace === null && dst.namespace === null) return replace(main, el("p", { class: "empty" }, "Both ends are outside the cluster: no NetworkPolicy has a say."));
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return replace(main, el("p", { class: "empty" }, "A port is a number from 1 to 65535."));
    const v = evaluate(src.endpoint, dst.endpoint, data.world);
    const protocol = protocolOf(protoSel.value);
    const at = port === null ? null : { protocol, port };
    replace(main, trace(src, dst, v, at, at ? contains(v.allowed, protocol, at.port) : void 0));
  }
  start().catch(showError);
})();
