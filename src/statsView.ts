import joplin from 'api';
import { ToastType } from 'api/types';
import { Stats, computeStats, clearCache } from './stats';
import { upsertStatsNote } from './statsNote';

// The statistics are shown in a modal dialog rather than a panel: this is a
// look-at-it-occasionally feature, and a panel would hold a column of the
// layout open permanently for it. The trade-off is that Joplin dialogs have no
// message channel back to the plugin, so everything interactive is a dialog
// button, and note links live in the "as a note" output where markdown links
// work natively.

let handle: string | null = null;
let busy = false;

const esc = (s: string): string =>
	String(s).replace(/[&<>"']/g, (c) => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
	));

const n = (x: number): string => x.toLocaleString();

// --- fragments -----------------------------------------------------------

function tile(label: string, value: number, sub = ''): string {
	return `<div class="tile"><div class="tile-v">${n(value)}</div>
		<div class="tile-l">${esc(label)}</div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ''}</div>`;
}

function bars(rows: { key: string; words: number; notes: number }[], limit = 0): string {
	const shown = limit ? rows.slice(0, limit) : rows;
	if (!shown.length) return '<p class="empty">Nothing yet.</p>';
	const max = Math.max(...shown.map((r) => r.words), 1);
	return `<table class="bars">${shown.map((r) => `<tr>
		<td class="b-k" title="${esc(r.key)}">${esc(r.key)}</td>
		<td class="b-b"><span style="width:${Math.max(1, (r.words / max) * 100)}%"></span></td>
		<td class="b-w">${n(r.words)}</td>
		<td class="b-n">${n(r.notes)}</td></tr>`).join('')}</table>`;
}

// Column pitch in px: must track the .c width + .hgrid gap in stats.css, or the
// month labels drift away from the columns they name.
const CELL_PITCH = 11;

// GitHub-style contribution grid for the trailing 12 months, by note creation date.
function heatmap(byDay: Record<string, number>): string {
	const today = new Date();
	const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const start = new Date(end);
	start.setDate(start.getDate() - 363);
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to a Monday

	const values: number[] = [];
	for (const k of Object.keys(byDay)) values.push(byDay[k]);
	values.sort((a, b) => a - b);
	// Percentile thresholds, so one 10k-word day doesn't flatten the rest.
	const at = (p: number) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;
	const t = [at(0.25), at(0.5), at(0.75), at(0.92)];
	const level = (v: number) => (v <= 0 ? 0 : v <= t[0] ? 1 : v <= t[1] ? 2 : v <= t[2] ? 3 : v <= t[3] ? 4 : 5);

	const cols: string[] = [];
	const months: { col: number; label: string }[] = [];
	const cur = new Date(start);
	let col = 0;
	while (cur <= end) {
		const cells: string[] = [];
		for (let d = 0; d < 7; d++) {
			if (cur > end) { cells.push('<i class="c pad"></i>'); continue; }
			const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
			const v = byDay[key] || 0;
			if (cur.getDate() <= 7 && d === 0) {
				months.push({ col, label: cur.toLocaleString(undefined, { month: 'short' }) });
			}
			cells.push(`<i class="c l${level(v)}" title="${key} · ${n(v)} words"></i>`);
			cur.setDate(cur.getDate() + 1);
		}
		cols.push(`<div class="hcol">${cells.join('')}</div>`);
		col++;
	}

	const labels = months
		.filter((m, i) => i === 0 || m.col - months[i - 1].col >= 3)
		.map((m) => `<span style="left:${m.col * CELL_PITCH}px">${esc(m.label)}</span>`)
		.join('');

	return `<div class="heatwrap">
		<div class="heat">
			<div class="hmonths">${labels}</div>
			<div class="hgrid">${cols.join('')}</div>
		</div>
		<div class="hlegend"><span>Less</span>
			${[0, 1, 2, 3, 4, 5].map((l) => `<i class="c l${l}"></i>`).join('')}
			<span>More</span></div>
	</div>`;
}

export function render(s: Stats): string {
	const books = s.byNotebook.filter((b) => b.words > 0);
	const composition = `${n(s.total.cjk)} CJK characters + ${n(s.total.latin)} words in other scripts`;
	const punct = s.total.cjkPunct
		? `<li>${n(s.total.words + s.total.cjkPunct)} including full-width punctuation</li>` : '';

	return `<div class="wrap">
	<h2>Writing Stats</h2>

	<div class="tiles">
		${tile('Total words', s.total.words)}
		${tile('This year', s.thisYear)}
		${tile('This month', s.thisMonth)}
		${tile('Today', s.today)}
	</div>

	<p class="note">${esc(composition)}. ${n(s.noteCount)} notes, ${n(s.withBody)} with text.</p>

	<h3>Last 12 months</h3>
	${heatmap(s.byDay)}

	<div class="cols">
		<section>
			<h3>By year</h3>
			${bars(s.byYear)}
		</section>
		<section>
			<h3>By notebook</h3>
			${bars(books, 15)}
			${books.length > 15 ? `<p class="note">+ ${n(books.length - 15)} more notebooks</p>` : ''}
		</section>
		<section>
			<h3>Longest notes</h3>
			<table class="bars longest">${s.longest.map((l) => `<tr>
				<td class="b-k">${esc(l.title)}</td>
				<td class="b-w">${n(l.words)}</td></tr>`).join('')}</table>
		</section>
	</div>

	<details class="method"><summary>How this is counted</summary>
		<ul>
			<li>Han, hiragana and katakana count per character; every other script counts per word.</li>
			<li>Markdown syntax, URLs, attachment links, HTML tags and inline code are removed first.</li>
			<li>Fenced code blocks are excluded${s.total.code ? ` (${n(s.total.code)} characters skipped)` : ''}.</li>
			${punct}
			<li>Recall's own generated notes are not counted.</li>
		</ul>
	</details>

	<div class="foot">
		<span>${s.rescanned ? `${n(s.rescanned)} note${s.rescanned === 1 ? '' : 's'} re-read this run` : 'served from cache'}</span>
	</div>
</div>`;
}

export function toMarkdown(s: Stats): string {
	const lines = [
		`# Writing Stats`,
		``,
		`- **Total words:** ${n(s.total.words)} (${n(s.total.cjk)} CJK characters + ${n(s.total.latin)} words)`,
		`- **Notes:** ${n(s.noteCount)} (${n(s.withBody)} with text)`,
		`- **This year:** ${n(s.thisYear)} · **This month:** ${n(s.thisMonth)} · **Today:** ${n(s.today)}`,
		``,
		`## By year`,
		``,
		`| Year | Words | Notes |`,
		`| --- | ---: | ---: |`,
		...s.byYear.map((y) => `| ${y.key} | ${n(y.words)} | ${n(y.notes)} |`),
		``,
		`## By notebook`,
		``,
		`| Notebook | Words | Notes |`,
		`| --- | ---: | ---: |`,
		...s.byNotebook.filter((b) => b.words > 0).map((b) => `| ${b.key} | ${n(b.words)} | ${n(b.notes)} |`),
	];
	return lines.join('\n');
}

// --- dialog ---------------------------------------------------------------

// The dismiss button must be id 'cancel' (or 'no'/'reject') or Joplin will not
// wire Escape to it. None of the others are submit ids, so Enter is a no-op —
// deliberate, since the remaining actions all have side effects.
const BUTTONS = [
	{ id: 'copy', title: 'Copy as Markdown' },
	{ id: 'note', title: 'Save as note' },
	{ id: 'rebuild', title: 'Rebuild cache' },
	{ id: 'cancel', title: 'Close' },
];

export async function registerDialog(): Promise<void> {
	handle = await joplin.views.dialogs.create('recall.stats.dialog');
	await joplin.views.dialogs.addScript(handle, './webview/stats.css');
	await joplin.views.dialogs.addScript(handle, './webview/stats.js');
	// Without this the dialog shrinks to its content and the heatmap is cramped.
	await joplin.views.dialogs.setFitToContent(handle, false);
	await joplin.views.dialogs.setButtons(handle, BUTTONS);
}

export async function showStats(rebuild = false): Promise<void> {
	if (!handle || busy) return;
	busy = true;
	try {
		if (rebuild) await clearCache();
		// The dialog blocks once open, so counting has to finish first. A toast
		// keeps the first (uncached) run from looking like nothing happened.
		await joplin.views.dialogs.showToast({
			message: rebuild ? 'Recall: rebuilding writing statistics…' : 'Recall: counting…',
			type: ToastType.Info,
		});
		const stats = await computeStats();
		await joplin.views.dialogs.setHtml(handle, render(stats));
		const result = await joplin.views.dialogs.open(handle);

		if (result.id === 'copy') {
			await joplin.clipboard.writeText(toMarkdown(stats));
			await joplin.views.dialogs.showToast({ message: 'Recall: statistics copied.', type: ToastType.Success });
		} else if (result.id === 'note') {
			const id = await upsertStatsNote(toMarkdown(stats));
			await joplin.commands.execute('openNote', id);
		} else if (result.id === 'rebuild') {
			busy = false;
			return showStats(true);
		}
	} catch (err) {
		await joplin.views.dialogs.showMessageBox(
			`Recall could not build statistics:\n${String((err as Error)?.message || err)}`,
		);
	} finally {
		busy = false;
	}
}
