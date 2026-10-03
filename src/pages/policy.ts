// The panel on a NetworkPolicy: which workloads it selects, and its rules in words.

import { button, byId, el, replace } from '@k8sdockside/plugin-sdk/dom';
import { party } from '../model/groups';
import type { NetworkPolicy } from '../model/kube';
import { describeRule, describeSelector, types, type Direction } from '../model/policy';
import { matches } from '../model/selector';
import { openParty, showError } from '../ui/common';
import { load } from '../ui/load';

async function start(): Promise<void> {
    const np = await k8sdockside.object<K8sDockside.KubeObject>() as unknown as NetworkPolicy;
    const data = await load();
    const ns = np.metadata.namespace ?? '';
    const selected = data.groups.filter((g) => g.namespace === ns && g.pods.some((p) => matches(np.spec?.podSelector ?? {}, p.metadata.labels)));
    const t = types(np);
    const sel = describeSelector(np.spec?.podSelector);

    const block = (direction: Direction): HTMLElement | null => {
        if (!t[direction]) return null;
        const rules = (direction === 'ingress' ? np.spec?.ingress : np.spec?.egress) ?? [];
        const box = el('div', { class: `side ${rules.length ? 'open' : 'closed'}` }, el('div', { class: 'side-title' }, direction === 'ingress' ? 'Lets in' : 'Lets out'));
        if (!rules.length) box.append(el('p', { class: 'deny' }, direction === 'ingress' ? 'Nothing: it denies every connection in.' : 'Nothing: it denies every connection out.'));
        else box.append(el('ol', { class: 'rules' }, ...rules.map((r) => el('li', {}, describeRule(r, direction)))));
        return box;
    };

    replace(
        byId('main'),
        el('p', {},
            `Selects ${sel ? `pods with ${sel}` : 'every pod'} in ${ns}: `,
            selected.length
                ? el('span', {}, ...selected.flatMap((g, i) => [i ? ', ' : '', button(g.name, () => openParty(party(g)), { class: 'link' })]))
                : el('strong', { class: 'deny' }, 'none running right now'),
            '.',
        ),
        el('p', { class: 'dim small' }, `Isolates ${[t.ingress ? 'ingress' : '', t.egress ? 'egress' : ''].filter(Boolean).join(' and ')}. Other policies selecting the same pods add to what this one allows; none can take anything away.`),
        el('div', { class: t.ingress && t.egress ? 'sides two' : 'sides one' }, block('ingress'), block('egress')),
        el('p', {}, button('Open the matrix', () => void k8sdockside.openView('overview').catch(showError), { class: 'ghost' })),
    );
}

start().catch(showError);
