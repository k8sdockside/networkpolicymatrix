// The matrix: every source against every destination, coloured by what the
// policies let through. Click a square for the reason. Above it, the cluster at
// a glance: tiles, every namespace's posture, and the findings.

import { button, byId, el, replace, svg } from '@k8sdockside/plugin-sdk/dom';
import { findings, type Finding, type Tone } from '../model/findings';
import { cellOf, combine, matrix, outside, party, type Cell, type Party } from '../model/groups';
import { describe as describePorts, type PortSet } from '../model/ports';
import { evaluate } from '../model/policy';
import { arcs, idlePolicies, percent, posture, postureCounts, tally, toneCounts, type NsPosture, type Posture, type Tally } from '../model/summary';
import { LOGO, askSimulator, clearError, openParty, partyName, readHash, showError, trace, when, writeHash } from '../ui/common';
import { load, type Loaded } from '../ui/load';

type Level = 'ns' | 'wl';

const hash = readHash();
let level: Level = hash.level === 'wl' ? 'wl' : 'ns';
let nsFilter = hash.ns ?? '';
let showSystem = hash.system === '1';
let selected: { row: string; col: string } | null = hash.row && hash.col ? { row: hash.row, col: hash.col } : null;
let data: Loaded | null = null;
let found: Finding[] = [];

// The computed matrix over every visible workload, and outside.
let parties: Party[] = [];
let cells = new Map<string, PortSet>();

const CELL_TEXT: Record<Cell, string> = { all: 'any port', some: 'some ports', none: 'nothing' };
const POSTURE_TEXT: Record<Posture, string> = { isolated: 'isolated', partial: 'partly isolated', open: 'wide open' };

// Icons: the plugin's own constants, the only markup handed to svg().
const ICON: Record<Tone, string> = {
    error: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    warn: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.7H1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.3v3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>`,
    info: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".9" fill="currentColor"/></svg>`,
};
const ICON_OK = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2l2 2 3.8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4.2c0 3.3-2.3 5.8-5.5 6.8-3.2-1-5.5-3.5-5.5-6.8V3.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICON_BOX = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6 3v7l-6 3-6-3v-7z M2 4.5l6 3 6-3 M8 7.5v7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const ICON_DOC = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5l3 3v10h-8.5z M9.5 1.5v3h3 M6 8h5 M6 10.5h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const ICON_ROUTE = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="12.5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12.5" cy="3.5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 12.5h4a2.5 2.5 0 000-5h-3a2.5 2.5 0 010-5h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

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
    // The tooltip is placed once; any scroll would leave it behind.
    document.addEventListener('scroll', () => (byId('tip').hidden = true), { capture: true, passive: true });
    await refresh();
}

function setLevel(next: Level, ns?: string): void {
    level = next;
    if (ns !== undefined) nsFilter = ns;
    selected = null;
    compute();
    render();
}

async function refresh(): Promise<void> {
    const btn = byId<HTMLButtonElement>('refresh');
    btn.disabled = true;
    try {
        data = await load();
        clearError();
        byId('where').textContent = `${(await k8sdockside.ready()).contextName} · ${data.policies.length} NetworkPolicies · read at ${when()}`;
        found = findings(data.groups, data.pods, data.policies, data.world, data.engines);
        drawFindings(found);
        compute();
        render();
    } catch (err) {
        showError(err);
        if (!data) {
            replace(byId('overview'));
            replace(byId('main'), emptyState(ICON.error, 'Could not read the cluster', 'The error is above. Press Refresh to try again.'));
        }
    } finally {
        btn.disabled = false;
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

/** Every workload pair in view, outside-to-outside left out. */
function pairTally(): Tally {
    const states: Cell[] = [];
    for (const r of parties) for (const c of parties) if (r.namespace !== null || c.namespace !== null) states.push(cellOf(cellAt(r.id, c.id)));
    return tally(states);
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

interface Block {
    cell: Cell;
    open: number;
    total: number;
    na: boolean;
}

function blockCell(rows: Party[], cols: Party[]): Block {
    const states: Cell[] = [];
    for (const r of rows) {
        for (const c of cols) {
            if (r.namespace === null && c.namespace === null) continue;
            states.push(cellOf(cellAt(r.id, c.id)));
        }
    }
    return { cell: combine(states), open: states.filter((s) => s !== 'none').length, total: states.length, na: !states.length };
}

function blockText(r: Axis, c: Axis, b: Block): string {
    if (r.members.length === 1 && c.members.length === 1) return describePorts(cellAt(r.members[0]!.id, c.members[0]!.id));
    return `${b.open} of ${b.total} workload pair${b.total === 1 ? '' : 's'} can connect`;
}

// ----- at a glance ----------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
}

/** A ring: the share of pairs that connect on any port, some ports, or not at all. */
function donut(t: Tally): SVGElement {
    const root = svgEl('svg', { viewBox: '0 0 42 42', class: 'donut', 'aria-hidden': 'true' });
    root.append(svgEl('circle', { cx: 21, cy: 21, r: 15.915, class: 'donut-track' }));
    for (const a of arcs(t)) {
        const len = a.length * 100;
        // A tiny gap between slices, unless one slice is the whole ring.
        const gap = a.length < 1 ? Math.min(0.8, len / 3) : 0;
        root.append(svgEl('circle', { cx: 21, cy: 21, r: 15.915, class: `donut-seg c-${a.key}`, 'stroke-dasharray': `${len - gap} ${100 - len + gap}`, 'stroke-dashoffset': 25 - a.start * 100 }));
    }
    return root;
}

/** A horizontal bar split into coloured parts. */
function stack(parts: { n: number; cls: string; label: string }[]): HTMLElement {
    const total = parts.reduce((s, p) => s + p.n, 0);
    const bar = el('div', { class: 'stack', role: 'img', 'aria-label': parts.map((p) => `${p.n} ${p.label}`).join(', ') });
    for (const p of parts) if (p.n) bar.append(el('span', { class: `stack-part ${p.cls}`, style: `flex-grow:${p.n}`, title: `${p.n} ${p.label}` }));
    if (!total) bar.append(el('span', { class: 'stack-part empty-part', style: 'flex-grow:1' }));
    return bar;
}

function meter(label: string, n: number, total: number): HTMLElement {
    const p = percent(n, total);
    return el('div', { class: 'meter' },
        el('div', { class: 'meter-top' }, el('span', { class: 'dim' }, label), el('span', {}, el('strong', {}, String(n)), el('span', { class: 'faint' }, ` / ${total}`))),
        el('div', { class: 'meter-bar' }, el('span', { class: `meter-fill ${p === 100 ? 'full' : p === 0 ? 'zero' : ''}`, style: `width:${p}%` })),
    );
}

function tile(icon: string, title: string, value: string, ...body: (Node | null)[]): HTMLElement {
    return el('div', { class: 'tile' },
        el('div', { class: 'tile-head' }, svg(icon, 'ico'), el('span', {}, title)),
        el('div', { class: 'tile-value' }, value),
        ...body,
    );
}

function dotLegend(items: { n: number; cls: string; label: string }[]): HTMLElement {
    return el('div', { class: 'mini-legend' }, ...items.map((i) => el('span', { class: 'ml' }, el('span', { class: `dot ${i.cls}` }), el('strong', {}, String(i.n)), ` ${i.label}`)));
}

function renderOverview(): void {
    if (!data) return;
    const groups = data.groups.filter((g) => visibleNamespace(g.namespace));
    const policies = data.policies.filter((p) => visibleNamespace(p.metadata.namespace ?? ''));
    const nsList = posture(groups, policies, data.world);
    const pc = postureCounts(nsList);
    const ingress = nsList.reduce((s, n) => s + n.ingress, 0);
    const egress = nsList.reduce((s, n) => s + n.egress, 0);
    const idle = idlePolicies(data.pods, policies).length;
    const t = pairTally();
    const tones = toneCounts(found);
    const nsCovered = new Set(policies.map((p) => p.metadata.namespace ?? '')).size;

    const nsTile = tile(ICON_SHIELD, 'Namespaces', String(nsList.length),
        stack([
            { n: pc.isolated, cls: 'p-isolated', label: 'isolated' },
            { n: pc.partial, cls: 'p-partial', label: 'partly isolated' },
            { n: pc.open, cls: 'p-open', label: 'wide open' },
        ]),
        dotLegend([
            { n: pc.isolated, cls: 'p-isolated', label: 'isolated' },
            { n: pc.partial, cls: 'p-partial', label: 'partly' },
            { n: pc.open, cls: 'p-open', label: 'wide open' },
        ]),
    );

    const wlTile = tile(ICON_BOX, 'Workloads', String(groups.length), meter('Ingress isolated', ingress, groups.length), meter('Egress isolated', egress, groups.length));

    const polTile = tile(ICON_DOC, 'NetworkPolicies', String(policies.length),
        el('div', { class: 'tile-lines' },
            el('div', {}, el('strong', {}, String(nsCovered)), el('span', { class: 'dim' }, ` of ${nsList.length} namespace${nsList.length === 1 ? '' : 's'} have one`)),
            idle
                ? el('div', { class: 'warn-text' }, svg(ICON.warn, 'ico-s'), ` ${idle} select${idle === 1 ? 's' : ''} no pods`)
                : el('div', { class: 'ok-text' }, svg(ICON_OK, 'ico-s'), policies.length ? ' every one selects pods' : ' none yet'),
        ),
    );

    const openShare = percent(t.all + t.some, t.total);
    const pathsTile = el('div', { class: 'tile' },
        el('div', { class: 'tile-head' }, svg(ICON_ROUTE, 'ico'), el('span', {}, level === 'wl' && nsFilter ? `Paths in ${nsFilter}` : 'Open paths')),
        el('div', { class: 'donut-row' },
            el('div', { class: 'donut-box' }, donut(t), el('div', { class: 'donut-label' }, el('strong', {}, `${openShare}%`), el('span', { class: 'faint' }, 'open'))),
            dotLegend([
                { n: t.all, cls: 'c-all', label: 'any port' },
                { n: t.some, cls: 'c-some', label: 'some ports' },
                { n: t.none, cls: 'c-none', label: 'blocked' },
            ]),
        ),
        el('div', { class: 'faint small' }, `${t.total} workload pair${t.total === 1 ? '' : 's'}, outside included`),
    );

    const fTile = tile(found.length ? ICON[tones.error ? 'error' : tones.warn ? 'warn' : 'info'] : ICON_OK, 'Findings', String(found.length),
        found.length
            ? el('div', { class: 'pills' },
                  ...(['error', 'warn', 'info'] as Tone[]).filter((k) => tones[k]).map((k) =>
                      button('', () => byId('findings').scrollIntoView({ behavior: 'smooth', block: 'start' }), { class: `pill tone-${k}`, title: `Show the ${k === 'warn' ? 'warnings' : k === 'error' ? 'errors' : 'notes'}` }),
                  ),
              )
            : el('div', { class: 'ok-text' }, svg(ICON_OK, 'ico-s'), ' nothing to flag'),
    );
    // Pills get their icon and count after creation, since button() only takes a text label.
    fTile.querySelectorAll<HTMLButtonElement>('.pill').forEach((b) => {
        const k = (['error', 'warn', 'info'] as Tone[]).find((x) => b.classList.contains(`tone-${x}`))!;
        b.append(svg(ICON[k], 'ico-s'), el('strong', {}, String(tones[k])), ` ${k === 'error' ? 'critical' : k === 'warn' ? 'warning' : 'note'}${tones[k] === 1 ? '' : 's'}`);
    });
    if (tones.error) fTile.classList.add('alert');

    replace(byId('overview'), el('div', { class: 'tiles' }, nsTile, wlTile, polTile, pathsTile, fTile));
    renderPosture(nsList, policies.length === 0 && groups.length > 0);
}

function renderPosture(list: NsPosture[], noPolicies: boolean): void {
    const box = byId('posture');
    if (!list.length) return replace(box);
    const hero = noPolicies
        ? el('div', { class: 'hero' }, svg(ICON.info, 'ico'),
              el('div', {},
                  el('strong', {}, 'No NetworkPolicies in view'),
                  el('div', { class: 'dim' }, 'Nothing is isolated: every pod can connect to every other pod and to the outside world, on any port. The matrix below is all green.'),
              ))
        : null;
    const chips = list.map((n) => {
        const b = button('', () => setLevel('wl', n.namespace), {
            class: `ns-chip p-${n.state}${level === 'wl' && nsFilter === n.namespace ? ' on' : ''}`,
            title: `${n.namespace}: ${POSTURE_TEXT[n.state]} · ${n.ingress}/${n.workloads} ingress-isolated · ${n.egress}/${n.workloads} egress-isolated · ${n.policies} polic${n.policies === 1 ? 'y' : 'ies'}. Click for its workloads.`,
        });
        b.append(
            el('span', { class: `dot p-${n.state}` }),
            el('span', { class: 'ns-name' }, n.namespace),
            el('span', { class: 'ns-dirs' },
                el('span', { class: `dir ${dirClass(n.ingress, n.workloads)}` }, 'in'),
                el('span', { class: `dir ${dirClass(n.egress, n.workloads)}` }, 'out'),
            ),
        );
        return b;
    });
    replace(box,
        hero,
        el('div', { class: 'posture-head' },
            el('h2', {}, 'Namespace posture'),
            el('span', { class: 'faint small' }, 'Wide open first. "in" and "out": every, some or no workload isolated for ingress and egress. Click a namespace to see its workloads.'),
        ),
        el('div', { class: 'chips' }, ...chips),
    );
}

function dirClass(n: number, total: number): string {
    return n === 0 ? 'd-none' : n === total ? 'd-all' : 'd-some';
}

// ----- drawing ------------------------------------------------------------------------------

let currentAxes: Axis[] = [];

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

    renderOverview();

    const ax = axes();
    currentAxes = ax;
    const blocks: Block[][] = ax.map((r) => ax.map((c) => blockCell(r.members, c.members)));
    const shown = tally(blocks.flat().filter((b) => !b.na).map((b) => b.cell));

    const table = el('table', { class: `matrix ${level}` });
    const headRow = el('tr', {}, el('th', { class: 'corner' }, el('span', { class: 'axis-hint' }, el('span', {}, 'to →'), el('span', {}, 'from ↓'))));
    ax.forEach((c, j) => headRow.append(el('th', { class: `col-h${c.members.every((m) => m.namespace === null) ? ' world' : ''}`, title: `${c.label} ${c.sub}`, 'data-c': j }, el('span', {}, c.label))));
    table.append(el('thead', {}, headRow));
    const body = el('tbody');
    ax.forEach((r, i) => {
        const tr = el('tr', {}, el('th', { class: `row-h${r.members.every((m) => m.namespace === null) ? ' world' : ''}`, title: `${r.label} ${r.sub}`, 'data-r': i }, el('span', { class: 'row-label' }, r.label), el('span', { class: 'faint small' }, r.sub)));
        ax.forEach((c, j) => {
            const b = blocks[i]![j]!;
            const td = el('td');
            if (!b.na) {
                const tip = `${r.label} → ${c.label}: ${blockText(r, c, b)}`;
                const multi = !(r.members.length === 1 && c.members.length === 1);
                const node = button('', () => select(r.id, c.id), {
                    class: `cell c-${b.cell}${r.id === c.id ? ' diag' : ''}${multi && b.cell === 'some' ? ' part' : ''}`,
                    'aria-label': tip,
                    'data-r': i,
                    'data-c': j,
                    style: multi && b.cell === 'some' ? `--p:${percent(b.open, b.total)}%` : undefined,
                });
                if (selected?.row === r.id && selected.col === c.id) node.classList.add('sel');
                td.append(node);
            }
            tr.append(td);
        });
        body.append(tr);
    });
    table.append(body);
    hookHover(table, blocks);

    const legend = el('div', { class: 'legend' },
        ...(['all', 'some', 'none'] as Cell[]).map((c) => el('span', { class: 'leg' }, el('span', { class: `cell c-${c} static` }), el('span', {}, CELL_TEXT[c]), el('span', { class: 'leg-n' }, String(shown[c])))),
        level === 'ns' ? el('span', { class: 'leg' }, el('span', { class: 'cell c-some part static', style: '--p:60%' }), el('span', { class: 'faint' }, 'fill = share of pairs open')) : null,
        el('span', { class: 'faint small grow right' }, 'Rows connect to columns. Hover for a summary, click for the reason.'),
    );

    const mainTitle = el('div', { class: 'section-head' },
        el('h2', {}, level === 'ns' ? 'Namespace to namespace' : nsFilter ? `Workloads in ${nsFilter}` : 'Workload to workload'),
        level === 'wl' && nsFilter ? button('← All namespaces', () => setLevel('ns', ''), { class: 'ghost small-btn' }) : null,
    );
    replace(byId('main'),
        mainTitle,
        legend,
        parties.length > 1
            ? el('div', { class: 'matrix-wrap' }, table)
            : emptyState(ICON_BOX, 'No running workloads here', showSystem ? 'There are no running pods in view.' : 'There are no running pods in view. Tick "Show kube-* namespaces" to include the system ones.'),
    );
    renderDetail(ax);
}

function emptyState(icon: string, title: string, text: string): HTMLElement {
    return el('div', { class: 'empty-state' }, svg(icon, 'ico-l'), el('strong', {}, title), el('span', { class: 'dim' }, text));
}

// ----- hover: crosshair and tooltip ---------------------------------------------------------------

function hookHover(table: HTMLTableElement, blocks: Block[][]): void {
    const tip = byId('tip');
    let lit: Element[] = [];
    const clear = (): void => {
        for (const n of lit) n.classList.remove('hl');
        lit = [];
        tip.hidden = true;
    };
    table.addEventListener('mouseleave', clear);
    table.addEventListener('mouseover', (e) => {
        const cell = (e.target as Element).closest<HTMLElement>('.cell[data-r]');
        if (!cell) return clear();
        const i = Number(cell.dataset.r);
        const j = Number(cell.dataset.c);
        for (const n of lit) n.classList.remove('hl');
        lit = [...table.querySelectorAll(`th[data-r="${i}"], th[data-c="${j}"]`)];
        for (const n of lit) n.classList.add('hl');
        const r = currentAxes[i];
        const c = currentAxes[j];
        const b = blocks[i]?.[j];
        if (!r || !c || !b) return;
        const verdict = b.cell === 'all' ? 'Allowed on any port' : b.cell === 'some' ? (b.open === b.total ? 'Allowed on some ports' : 'Partly allowed') : 'Blocked';
        replace(tip,
            el('div', { class: 'tip-route' }, el('span', {}, r.label), el('span', { class: 'faint' }, ' → '), el('span', {}, c.label)),
            el('div', { class: `tip-verdict v-${b.cell}` }, el('span', { class: `dot c-${b.cell}` }), verdict),
            el('div', { class: 'dim' }, blockText(r, c, b)),
            el('div', { class: 'faint small' }, 'Click for the reason'),
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

function select(row: string, col: string): void {
    selected = selected?.row === row && selected.col === col ? null : { row, col };
    byId('tip').hidden = true;
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
    const t = tally(pairs.map((p) => cellOf(p.set)));
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
        el('div', { class: 'detail-head' },
            el('h3', {}, `${r.label} → ${c.label}`),
            button('Close', () => select(r.id, c.id), { class: 'ghost small-btn' }),
        ),
        stack([
            { n: t.all, cls: 'c-all', label: 'pairs on any port' },
            { n: t.some, cls: 'c-some', label: 'pairs on some ports' },
            { n: t.none, cls: 'c-none', label: 'pairs blocked' },
        ]),
        el('p', { class: 'dim small' }, `${t.all} on any port · ${t.some} on some ports · ${t.none} blocked. Pick a pair for the reason.`),
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

// ----- findings -----------------------------------------------------------------------------

function drawFindings(list: Finding[]): void {
    const box = byId('findings');
    if (!list.length) return replace(box);
    const order: Record<Tone, number> = { error: 0, warn: 1, info: 2 };
    const sorted = [...list].sort((a, b) => order[a.tone] - order[b.tone]);
    replace(box,
        el('div', { class: 'section-head' }, el('h2', {}, 'Worth knowing'), el('span', { class: 'faint small' }, 'Click one to see what it is about.')),
        el('div', { class: 'finding-grid' },
            ...sorted.map((f) =>
                el('details', { class: `finding tone-${f.tone}` },
                    el('summary', {},
                        svg(ICON[f.tone], 'f-ico'),
                        el('span', { class: 'f-body' }, el('span', { class: 'f-title' }, f.title), el('span', { class: 'dim small f-text' }, f.text)),
                        f.about.length ? el('span', { class: 'f-count', title: `${f.about.length} affected` }, String(f.about.length)) : null,
                    ),
                    f.about.length ? el('div', { class: 'about' }, ...f.about.map((a) => el('span', { class: 'tag mono' }, a))) : null,
                ),
            ),
        ),
    );
}

start().catch(showError);
