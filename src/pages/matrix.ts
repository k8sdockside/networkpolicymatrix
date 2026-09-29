// The matrix: every source against every destination, coloured by what the
// policies let through. Click a square for the reason.

import { button, byId, el, replace, svg } from '@k8sdockside/plugin-sdk/dom';
import { findings, type Finding } from '../model/findings';
import { cellOf, combine, matrix, outside, party, type Cell, type Party } from '../model/groups';
import { describe as describePorts, type PortSet } from '../model/ports';
import { evaluate } from '../model/policy';
import { LOGO, askSimulator, clearError, openParty, partyName, readHash, showError, trace, when, writeHash } from '../ui/common';
import { load, type Loaded } from '../ui/load';

type Level = 'ns' | 'wl';

const hash = readHash();
let level: Level = hash.level === 'wl' ? 'wl' : 'ns';
let nsFilter = hash.ns ?? '';
let showSystem = hash.system === '1';
let selected: { row: string; col: string } | null = hash.row && hash.col ? { row: hash.row, col: hash.col } : null;
let data: Loaded | null = null;

// The computed matrix over every visible workload, and outside.
let parties: Party[] = [];
let cells = new Map<string, PortSet>();

const CELL_TEXT: Record<Cell, string> = { all: 'any port', some: 'some ports', none: 'nothing' };

async function start(): Promise<void> {
    const ctx = await k8sdockside.ready();
    byId('logo').append(svg(LOGO, 'mark'));
    byId('where').textContent = ctx.contextName;
    byId('lvl-ns').addEventListener('click', () => setLevel('ns'));
    byId('lvl-wl').addEventListener('click', () => setLevel('wl'));
    byId<HTMLSelectElement>('namespace').addEventListener('change', (e) => {
        nsFilter = (e.target as HTMLSelectElement).value;
        selected = null;
        compute();
        render();
    });
    const sys = byId<HTMLInputElement>('system');
    sys.checked = showSystem;
    sys.addEventListener('change', () => {
        showSystem = sys.checked;
        selected = null;
        compute();
        render();
    });
    byId('refresh').addEventListener('click', () => void refresh());
    await refresh();
}

function setLevel(next: Level): void {
    level = next;
    selected = null;
    compute();
    render();
}

async function refresh(): Promise<void> {
    try {
        data = await load();
        clearError();
        byId('where').textContent = `${(await k8sdockside.ready()).contextName} · ${data.policies.length} NetworkPolicies · read at ${when()}`;
        drawFindings(findings(data.groups, data.pods, data.policies, data.world, data.engines));
        compute();
        render();
    } catch (err) {
        showError(err);
    }
}

function visibleNamespace(ns: string): boolean {
    return showSystem || !ns.startsWith('kube-');
}

function compute(): void {
    if (!data) return;
    let groups = data.groups.filter((g) => visibleNamespace(g.namespace));
    if (level === 'wl' && nsFilter) groups = groups.filter((g) => g.namespace === nsFilter);
    parties = [...groups.map(party), outside()];
    const m = matrix(parties, parties, data.world);
    cells = new Map();
    parties.forEach((r, i) => parties.forEach((c, j) => cells.set(`${r.id}>${c.id}`, m[i]![j]!)));
}

function cellAt(row: string, col: string): PortSet {
    return cells.get(`${row}>${col}`) ?? [];
}

// ----- the axes ---------------------------------------------------------------------------

interface Axis {
    id: string;
    label: string;
    sub: string;
    members: Party[];
}

function axes(): Axis[] {
    if (level === 'wl') {
        return parties.map((p) => ({ id: p.id, label: p.label, sub: p.namespace ?? (p.endpoint.kind === 'ip' ? p.endpoint.ip : ''), members: [p] }));
    }
    const byNs = new Map<string, Party[]>();
    for (const p of parties) {
        if (p.namespace === null) continue;
        byNs.set(p.namespace, [...(byNs.get(p.namespace) ?? []), p]);
    }
    const out: Axis[] = [...byNs.entries()].map(([ns, members]) => ({ id: `ns:${ns}`, label: ns, sub: `${members.length} workload${members.length === 1 ? '' : 's'}`, members }));
    const world = parties.find((p) => p.namespace === null);
    if (world) out.push({ id: world.id, label: world.label, sub: world.endpoint.kind === 'ip' ? world.endpoint.ip : '', members: [world] });
    return out;
}

function blockCell(rows: Party[], cols: Party[]): { cell: Cell; open: number; total: number } {
    const states: Cell[] = [];
    for (const r of rows) {
        for (const c of cols) {
            if (r.namespace === null && c.namespace === null) continue;
            states.push(cellOf(cellAt(r.id, c.id)));
        }
    }
    return { cell: combine(states), open: states.filter((s) => s !== 'none').length, total: states.length };
}

// ----- drawing ------------------------------------------------------------------------------

function render(): void {
    if (!data) return;
    byId('lvl-ns').classList.toggle('on', level === 'ns');
    byId('lvl-wl').classList.toggle('on', level === 'wl');
    byId('ns-wrap').hidden = level !== 'wl';
    const nsSel = byId<HTMLSelectElement>('namespace');
    const namespaces = [...new Set(data.groups.map((g) => g.namespace))].filter(visibleNamespace).sort();
    replace(nsSel, el('option', { value: '' }, 'Every namespace'), ...namespaces.map((ns) => el('option', { value: ns }, ns)));
    nsSel.value = namespaces.includes(nsFilter) ? nsFilter : '';
    writeHash({ level, ns: level === 'wl' ? nsFilter : '', system: showSystem ? '1' : '', row: selected?.row ?? '', col: selected?.col ?? '' });

    const ax = axes();
    const table = el('table', { class: `matrix ${level}` });
    const headRow = el('tr', {}, el('th', { class: 'corner' }, el('span', { class: 'faint small' }, 'from ↓  to →')));
    for (const c of ax) headRow.append(el('th', { class: 'col-h', title: `${c.label} ${c.sub}` }, el('span', {}, c.label)));
    table.append(el('thead', {}, headRow));
    const body = el('tbody');
    for (const r of ax) {
        const tr = el('tr', {}, el('th', { class: 'row-h', title: `${r.label} ${r.sub}` }, el('span', { class: 'row-label' }, r.label), el('span', { class: 'faint small' }, r.sub)));
        for (const c of ax) {
            const { cell, open, total } = blockCell(r.members, c.members);
            const na = r.members.every((m) => m.namespace === null) && c.members.every((m) => m.namespace === null);
            const td = el('td');
            if (!na) {
                const single = r.members.length === 1 && c.members.length === 1;
                const tip = single
                    ? `${r.label} → ${c.label}: ${describePorts(cellAt(r.members[0]!.id, c.members[0]!.id))}`
                    : `${r.label} → ${c.label}: ${open} of ${total} workload pairs can connect`;
                const b = button('', () => select(r.id, c.id), { class: `cell c-${cell}${r.id === c.id ? ' diag' : ''}`, title: tip, 'aria-label': tip });
                if (selected?.row === r.id && selected.col === c.id) b.classList.add('sel');
                td.append(b);
            }
            tr.append(td);
        }
        body.append(tr);
    }
    table.append(body);

    const legend = el('div', { class: 'legend' },
        ...(['all', 'some', 'none'] as Cell[]).map((c) => el('span', { class: 'leg' }, el('span', { class: `cell c-${c} static` }), CELL_TEXT[c])),
        el('span', { class: 'faint small' }, level === 'ns' ? 'A namespace square sums up every workload pair in it.' : 'Rows connect to columns.'),
    );
    replace(byId('main'), legend, parties.length > 1 ? el('div', { class: 'matrix-wrap' }, table) : el('p', { class: 'empty' }, 'No running workloads here.'));
    renderDetail(ax);
}

function select(row: string, col: string): void {
    selected = selected?.row === row && selected.col === col ? null : { row, col };
    render();
    if (selected) byId('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetail(ax: Axis[]): void {
    const box = byId('detail');
    if (!selected || !data) return replace(box);
    const r = ax.find((a) => a.id === selected!.row);
    const c = ax.find((a) => a.id === selected!.col);
    if (!r || !c) return replace(box);
    if (r.members.length === 1 && c.members.length === 1) return replace(box, pairDetail(r.members[0]!, c.members[0]!));

    // A namespace block: every pair in it, open ones first.
    const pairs: { src: Party; dst: Party; set: PortSet }[] = [];
    for (const s of r.members) for (const d of c.members) if (s.namespace !== null || d.namespace !== null) pairs.push({ src: s, dst: d, set: cellAt(s.id, d.id) });
    const rank: Record<Cell, number> = { all: 0, some: 1, none: 2 };
    pairs.sort((a, b) => rank[cellOf(a.set)] - rank[cellOf(b.set)] || partyName(a.src).localeCompare(partyName(b.src)));
    const pick = el('div', { id: 'pair' });
    const rows = pairs.map((p) => {
        const tr = el('tr', { class: 'pick-row' },
            el('td', {}, el('span', { class: `cell c-${cellOf(p.set)} static` })),
            el('td', {}, partyName(p.src)),
            el('td', { class: 'faint' }, '→'),
            el('td', {}, partyName(p.dst)),
            el('td', { class: 'dim' }, describePorts(p.set)),
        );
        tr.addEventListener('click', () => {
            for (const other of tr.parentElement?.children ?? []) other.classList.remove('sel');
            tr.classList.add('sel');
            replace(pick, pairDetail(p.src, p.dst));
        });
        return tr;
    });
    replace(box,
        el('h3', {}, `${r.label} → ${c.label}`),
        el('p', { class: 'dim small' }, 'Every workload pair in this square. Pick one for the reason.'),
        el('div', { class: 'pairs' }, el('table', { class: 'pair-table' }, el('tbody', {}, ...rows))),
        pick,
    );
}

function pairDetail(src: Party, dst: Party): HTMLElement {
    const v = evaluate(src.endpoint, dst.endpoint, data!.world);
    const t = trace(src, dst, v);
    const actions = el('div', { class: 'actions' },
        button('Try a port in the simulator', () =>
            void askSimulator({ from: src.id, to: dst.id, fromIp: src.endpoint.kind === 'ip' ? src.endpoint.ip : undefined, toIp: dst.endpoint.kind === 'ip' ? dst.endpoint.ip : undefined }).catch(showError),
        ),
    );
    if (src.group) actions.append(button(`Open ${src.label}`, () => openParty(src), { class: 'ghost' }));
    if (dst.group && dst.id !== src.id) actions.append(button(`Open ${dst.label}`, () => openParty(dst), { class: 'ghost' }));
    t.append(actions);
    return t;
}

function drawFindings(list: Finding[]): void {
    const box = byId('findings');
    if (!list.length) return replace(box);
    replace(box,
        ...list.map((f) =>
            el('details', { class: `finding tone-${f.tone}` },
                el('summary', {}, el('span', { class: 'f-title' }, f.title), el('span', { class: 'dim small' }, ` — ${f.text}`)),
                f.about.length ? el('div', { class: 'about' }, ...f.about.map((a) => el('span', { class: 'tag mono' }, a))) : null,
            ),
        ),
    );
}

start().catch(showError);
