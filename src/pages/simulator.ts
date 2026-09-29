// The simulator: one connection, from anything to anything, on one port or
// any, with every rule that decides it.

import { byId, el, replace, svg } from '@k8sdockside/plugin-sdk/dom';
import { validIP } from '../model/cidr';
import { OUTSIDE_IP, outside, party, type Party } from '../model/groups';
import { contains, protocolOf } from '../model/ports';
import { evaluate } from '../model/policy';
import { LOGO, clearError, readHash, showError, takeQuestion, trace, when, writeHash } from '../ui/common';
import { load, type Loaded } from '../ui/load';

const OUTSIDE = 'outside';

let data: Loaded | null = null;
let parties = new Map<string, Party>();

const fromSel = byId<HTMLSelectElement>('from');
const toSel = byId<HTMLSelectElement>('to');
const fromIp = byId<HTMLInputElement>('from-ip');
const toIp = byId<HTMLInputElement>('to-ip');
const portIn = byId<HTMLInputElement>('port');
const protoSel = byId<HTMLSelectElement>('protocol');

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    byId('logo').append(svg(LOGO, 'mark'));
    byId('where').textContent = ctx.contextName;

    const hash = readHash();
    const handed = await takeQuestion();
    const q = handed ?? { from: hash.from ?? '', to: hash.to ?? '', fromIp: hash.fromIp, toIp: hash.toIp, port: hash.port, protocol: hash.protocol };
    fromIp.value = q.fromIp ?? OUTSIDE_IP;
    toIp.value = q.toIp ?? '1.1.1.1';
    portIn.value = q.port ?? '';
    protoSel.value = protocolOf(q.protocol);

    for (const input of [fromSel, toSel, protoSel]) input.addEventListener('change', render);
    for (const input of [fromIp, toIp, portIn]) input.addEventListener('input', render);
    byId('form').addEventListener('submit', (e) => e.preventDefault());
    byId('swap').addEventListener('click', () => {
        [fromSel.value, toSel.value] = [toSel.value, fromSel.value];
        [fromIp.value, toIp.value] = [toIp.value, fromIp.value];
        render();
    });
    byId('refresh').addEventListener('click', () => void refresh(fromSel.value, toSel.value));
    await refresh(q.from, q.to);
}

async function refresh(from: string, to: string): Promise<void> {
    try {
        data = await load();
        clearError();
        byId('where').textContent = `${(await k8sdockside.ready()).contextName} · ${data.policies.length} NetworkPolicies · read at ${when()}`;
        parties = new Map(data.groups.map((g) => [g.id, party(g)]));
        fill(fromSel, from || data.groups[0]?.id || OUTSIDE);
        fill(toSel, to || data.groups[1]?.id || data.groups[0]?.id || OUTSIDE);
        render();
    } catch (err) {
        showError(err);
    }
}

function fill(sel: HTMLSelectElement, value: string): void {
    const byNs = new Map<string, Party[]>();
    for (const p of parties.values()) byNs.set(p.namespace ?? '', [...(byNs.get(p.namespace ?? '') ?? []), p]);
    replace(
        sel,
        el('option', { value: OUTSIDE }, 'Outside the cluster (an address)'),
        ...[...byNs.entries()].map(([ns, list]) => {
            const group = el('optgroup', { label: ns });
            for (const p of list) group.append(el('option', { value: p.id }, `${p.label}${p.group && p.group.kind !== 'pods' ? '' : ' (pod)'}`));
            return group;
        }),
    );
    sel.value = value === OUTSIDE || parties.has(value) ? value : (sel.options[1]?.value ?? OUTSIDE);
}

function resolve(sel: HTMLSelectElement, ip: HTMLInputElement): Party | string {
    ip.hidden = sel.value !== OUTSIDE;
    if (sel.value !== OUTSIDE) return parties.get(sel.value) ?? 'Pick something.';
    const addr = ip.value.trim();
    if (!validIP(addr)) return `"${addr}" is not an IP address.`;
    return outside(addr);
}

function render(): void {
    if (!data) return;
    const src = resolve(fromSel, fromIp);
    const dst = resolve(toSel, toIp);
    const portText = portIn.value.trim();
    const port = portText === '' ? null : Number(portText);
    writeHash({
        from: fromSel.value,
        to: toSel.value,
        fromIp: fromSel.value === OUTSIDE ? fromIp.value : '',
        toIp: toSel.value === OUTSIDE ? toIp.value : '',
        port: portText,
        protocol: protoSel.value === 'TCP' ? '' : protoSel.value,
    });
    const main = byId('main');
    if (typeof src === 'string') return replace(main, el('p', { class: 'empty' }, src));
    if (typeof dst === 'string') return replace(main, el('p', { class: 'empty' }, dst));
    if (src.namespace === null && dst.namespace === null) return replace(main, el('p', { class: 'empty' }, 'Both ends are outside the cluster: no NetworkPolicy has a say.'));
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return replace(main, el('p', { class: 'empty' }, 'A port is a number from 1 to 65535.'));

    const v = evaluate(src.endpoint, dst.endpoint, data.world);
    const protocol = protocolOf(protoSel.value);
    const at = port === null ? null : { protocol, port };
    replace(main, trace(src, dst, v, at, at ? contains(v.allowed, protocol, at.port) : undefined));
}

start().catch(showError);
