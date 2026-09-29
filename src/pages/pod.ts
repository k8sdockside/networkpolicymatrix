// The Network access panel on a Pod: whether it is isolated each way, and
// who it can talk to.

import { button, byId, el, replace } from '@k8sdockside/plugin-sdk/dom';
import { cellOf, outside, party, type Party } from '../model/groups';
import type { Pod } from '../model/kube';
import { describe as describePorts, type PortSet } from '../model/ports';
import { evaluate, type Direction } from '../model/policy';
import { askSimulator, openParty, openPolicy, partyName, showError } from '../ui/common';
import { load } from '../ui/load';

const SHOWN = 10;

async function start(): Promise<void> {
    const pod = await k8sdockside.object<K8sDockside.KubeObject>() as unknown as Pod;
    const data = await load();
    const ns = pod.metadata.namespace ?? '';
    const own = data.groups.find((g) => g.pods.some((p) => p.metadata.name === pod.metadata.name && p.metadata.namespace === ns));
    const me: Party = own ? { ...party(own), endpoint: { kind: 'pod', pod } } : { id: `${ns}/pods/${pod.metadata.name}`, label: pod.metadata.name, namespace: ns, endpoint: { kind: 'pod', pod }, group: null };
    const others = [...data.groups.filter((g) => g.id !== own?.id).map(party), outside()];

    const column = (direction: Direction): HTMLElement => {
        const title = direction === 'ingress' ? 'Who can connect to it' : 'What it can connect to';
        const box = el('div', { class: 'side' }, el('div', { class: 'side-title' }, title));
        if (pod.spec?.hostNetwork) {
            box.append(el('p', {}, 'It runs on the host network, where NetworkPolicy does not apply.'));
            return box;
        }
        const policies = data.world.selecting(pod, direction);
        if (!policies.length) {
            box.classList.add('open');
            box.append(el('p', {}, direction === 'ingress' ? 'Not isolated: anything may connect to it.' : 'Not isolated: it may connect anywhere.'));
            return box;
        }
        box.append(el('p', { class: 'dim small' }, 'Isolated by ', ...policies.flatMap((np, i) => [i ? ', ' : '', button(np.metadata.name, () => openPolicy(np), { class: 'link mono' })])));
        const reach: { p: Party; set: PortSet }[] = [];
        for (const o of others) {
            const v = direction === 'ingress' ? evaluate(o.endpoint, me.endpoint, data.world) : evaluate(me.endpoint, o.endpoint, data.world);
            if (cellOf(v.allowed) !== 'none') reach.push({ p: o, set: v.allowed });
        }
        if (!reach.length) {
            box.classList.add('closed');
            box.append(el('p', { class: 'deny' }, direction === 'ingress' ? 'Nothing may connect to it.' : 'It may connect to nothing.'));
            return box;
        }
        const list = el('ul', { class: 'reach' });
        for (const r of reach.slice(0, SHOWN)) {
            const name = r.p.group ? button(partyName(r.p), () => openParty(r.p), { class: 'link' }) : el('span', {}, partyName(r.p));
            const why = button('why', () => void askSimulator(direction === 'ingress' ? { from: r.p.id, to: me.group ? me.id : '' } : { from: me.group ? me.id : '', to: r.p.id }).catch(showError), { class: 'link small' });
            list.append(el('li', {}, el('span', { class: `cell c-${cellOf(r.set)} static` }), name, el('span', { class: 'dim small' }, describePorts(r.set)), why));
        }
        box.append(list);
        if (reach.length > SHOWN) box.append(el('p', { class: 'faint small' }, `and ${reach.length - SHOWN} more — see the matrix.`));
        return box;
    };

    replace(byId('main'), el('div', { class: 'sides two' }, column('ingress'), column('egress')));
}

start().catch(showError);
