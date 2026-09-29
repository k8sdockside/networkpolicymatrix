// What every page shares: errors, the address, the hand-over between views,
// and the explanation of one connection.

import { button, el } from '@k8sdockside/plugin-sdk/dom';
import { groupRef, type Party } from '../model/groups';
import type { NetworkPolicy } from '../model/kube';
import { contains, describe as describePorts, isAll, isEmpty, protocolOf } from '../model/ports';
import { describeRule, type Side, type Verdict } from '../model/policy';

export function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function showError(err: unknown): void {
    const node = document.getElementById('error');
    if (!node) return;
    node.textContent = message(err);
    node.hidden = false;
}

export function clearError(): void {
    const node = document.getElementById('error');
    if (node) node.hidden = true;
}

export function readHash(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of location.hash.replace(/^#/, '').split('&')) {
        const cut = pair.indexOf('=');
        if (cut <= 0) continue;
        try {
            out[pair.slice(0, cut)] = decodeURIComponent(pair.slice(cut + 1));
        } catch {
            // A stray % in a hand-edited address is ignored.
        }
    }
    return out;
}

export function writeHash(values: Record<string, string>): void {
    const text = Object.entries(values)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
    try {
        history.replaceState(null, '', text ? '#' + text : location.pathname);
    } catch {
        try {
            location.hash = text;
        } catch {
            /* kept in memory only */
        }
    }
}

export function when(): string {
    const now = new Date();
    return k8sdockside.format?.time(now) ?? now.toLocaleTimeString();
}

// ----- the hand-over to the simulator ---------------------------------------------------------

export interface Question {
    from: string;
    to: string;
    fromIp?: string;
    toIp?: string;
    port?: string;
    protocol?: string;
}

const KEY = 'simulate';

export async function askSimulator(q: Question): Promise<void> {
    await k8sdockside.storage?.set(KEY, q).catch(() => null);
    await k8sdockside.openView('simulator');
}

export async function takeQuestion(): Promise<Question | null> {
    const store = k8sdockside.storage;
    if (!store) return null;
    try {
        const q = await store.get<Question>(KEY);
        if (q) await store.remove(KEY);
        return q && typeof q.from === 'string' && typeof q.to === 'string' ? q : null;
    } catch {
        return null;
    }
}

// ----- drawing ------------------------------------------------------------------------------

export function openParty(p: Party): void {
    if (!p.group) return;
    const ref = groupRef(p.group);
    void k8sdockside.open({ kind: ref.kind, namespace: ref.namespace, name: ref.name }).catch(showError);
}

export function openPolicy(np: NetworkPolicy): void {
    void k8sdockside.open({ kind: 'networkpolicies', namespace: np.metadata.namespace, name: np.metadata.name }).catch(showError);
}

export function partyName(p: Party): string {
    return p.namespace === null ? `${p.label} (${p.endpoint.kind === 'ip' ? p.endpoint.ip : ''})` : `${p.namespace}/${p.label}`;
}

function policyLink(np: NetworkPolicy): HTMLElement {
    return button(`${np.metadata.namespace}/${np.metadata.name}`, () => openPolicy(np), { class: 'link mono' });
}

/** One side of a connection, in words: why it lets the traffic through, or why not. */
function sideBlock(title: string, side: Side | null, self: Party, other: Party, port?: { protocol: string; port: number } | null): HTMLElement {
    const box = el('div', { class: 'side' }, el('div', { class: 'side-title' }, title));
    const verb = side?.direction === 'egress' ? 'send to' : 'accept from';
    if (!side) {
        box.append(el('p', { class: 'dim' }, 'Outside the cluster: no NetworkPolicy applies to this end.'));
        box.classList.add('open');
        return box;
    }
    if (side.exempt) {
        box.append(el('p', {}, `No policy applies: ${side.exempt}.`));
        box.classList.add('open');
        return box;
    }
    if (!side.isolated) {
        box.append(el('p', {}, `No policy selects ${partyName(self)} for ${side.direction}, so it may ${verb} anything.`));
        box.classList.add('open');
        return box;
    }
    box.append(
        el('p', { class: 'dim' }, `Isolated for ${side.direction} by ${side.policies.length === 1 ? 'one policy' : `${side.policies.length} policies`}: `, ...side.policies.flatMap((np, i) => [i ? ', ' : '', policyLink(np)])),
    );
    if (!side.matches.length) {
        box.append(el('p', { class: 'deny' }, `No rule in them lets it ${verb} ${partyName(other)}.`));
        box.classList.add('closed');
        return box;
    }
    const rules = el('ul', { class: 'rules' });
    for (const m of side.matches) {
        const rule = (side.direction === 'ingress' ? m.policy.spec?.ingress : m.policy.spec?.egress)?.[m.rule];
        rules.append(
            el('li', {},
                policyLink(m.policy),
                el('span', { class: 'faint' }, ` rule ${m.rule + 1}: `),
                el('span', {}, rule ? describeRule(rule, side.direction) : ''),
                el('div', { class: 'small dim' }, `matches as ${m.peer} · opens ${isEmpty(m.ports) ? 'no port this pod has' : describePorts(m.ports)}`),
            ),
        );
    }
    box.append(rules);
    const shut = port ? !contains(side.allowed, protocolOf(port.protocol), port.port) : isEmpty(side.allowed);
    if (port && shut) box.append(el('p', { class: 'deny' }, `None of them opens ${port.protocol} ${port.port}.`));
    box.classList.add(shut ? 'closed' : 'open');
    return box;
}

/** The whole explanation of one connection. */
export function trace(src: Party, dst: Party, v: Verdict, port?: { protocol: string; port: number } | null, allowedAtPort?: boolean): HTMLElement {
    let head: string;
    let tone: string;
    if (port) {
        tone = allowedAtPort ? 'all' : 'none';
        head = `${allowedAtPort ? 'Allowed' : 'Blocked'}: ${partyName(src)} → ${partyName(dst)} on ${port.protocol} ${port.port}`;
    } else {
        tone = isEmpty(v.allowed) ? 'none' : isAll(v.allowed) ? 'all' : 'some';
        head = isEmpty(v.allowed)
            ? `Blocked: ${partyName(src)} cannot connect to ${partyName(dst)}`
            : `${partyName(src)} → ${partyName(dst)}: ${describePorts(v.allowed)}`;
    }
    return el('section', { class: `trace tone-${tone}` },
        el('div', { class: 'trace-head' }, head),
        el('div', { class: 'sides' },
            sideBlock(`Leaving ${partyName(src)}`, v.egress, src, dst, port),
            el('div', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
            sideBlock(`Arriving at ${partyName(dst)}`, v.ingress, dst, src, port),
        ),
        el('p', { class: 'small faint' }, 'Worked out from one running pod of each workload. Replies to an allowed connection are always allowed.'),
    );
}

export const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="3" width="5" height="5" rx="1" opacity=".35"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="5" height="5" rx="1" opacity=".35"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16" y="9.5" width="5" height="5" rx="1" opacity=".35"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1" opacity=".35"/><rect x="16" y="16" width="5" height="5" rx="1"/></g></svg>`;
