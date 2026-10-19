import joplin from 'api';
import { Stats, clearCache, computeStats } from './stats';
import { render, toMarkdown } from './statsView';

let handle: string | null = null;
let stats: Stats | null = null;
let busy = false;
let status = 'Sync your notes before generating a review. Automatic startup generation is off on mobile.';

export function mobileHtml(): string {
	return `<main>
		<h1>Recall</h1>
		<p class="intro">Sync first so your review includes your latest notes. Choose source notebooks in Settings → Recall.</p>
		<nav class="actions" aria-label="Recall actions">
			<button data-action="randomNote">Random note</button>
			<button data-action="onThisDay">On this day</button>
			<button data-action="dailyDigest">Daily Recall</button>
			<button data-action="writingStats">Writing statistics</button>
		</nav>
		<p class="status" role="status" aria-live="polite"></p>
		<div id="statistics"></div>
		<div class="stats-actions" hidden>
			<button data-action="copy">Copy Markdown</button>
			<button data-action="rebuild">Recount</button>
		</div>
	</main>`;
}

function update(): void {
	if (handle) joplin.views.panels.postMessage(handle, {
		type: 'state', busy, status, html: stats ? render(stats) : '',
	});
}

export async function showMobileStats(rebuild = false): Promise<void> {
	if (busy) return;
	busy = true;
	try {
		status = rebuild ? 'Rebuilding writing statistics…' : 'Reading note list…';
		update();
		if (rebuild) await clearCache();
		stats = await computeStats((message) => { status = message; update(); });
		status = 'Statistics ready. Counts reflect notes currently stored on this device.';
	} catch (err) {
		status = `Could not build statistics: ${String((err as Error)?.message || err)}`;
	} finally {
		busy = false;
		update();
	}
}

export async function registerMobileView(): Promise<void> {
	handle = await joplin.views.panels.create('recall.mobile');
	await joplin.views.panels.setHtml(handle, mobileHtml());
	await joplin.views.panels.addScript(handle, './webview/stats.css');
	await joplin.views.panels.addScript(handle, './webview/mobile.js');
	await joplin.views.panels.onMessage(handle, async (message: unknown) => {
		const action = (message as { action?: string })?.action;
		if (action === 'ready') { update(); return; }
		if (busy) return;
		if (action === 'writingStats' || action === 'rebuild') {
			await showMobileStats(action === 'rebuild');
			return;
		}
		busy = true;
		try {
			status = 'Working…';
			update();
			if (action === 'copy') {
				if (!stats) throw new Error('Calculate statistics first.');
				await joplin.clipboard.writeText(toMarkdown(stats));
				status = 'Statistics copied as Markdown.';
			} else if (action === 'randomNote' || action === 'onThisDay' || action === 'dailyDigest') {
				await joplin.commands.execute('dismissPluginPanels');
				await joplin.commands.execute(`recall.${action}`);
				status = 'Ready. Sync your notes before generating your next review.';
			} else {
				status = 'Choose a Recall action.';
			}
		} catch (err) {
			status = String((err as Error)?.message || err);
		} finally {
			busy = false;
			update();
		}
	});
	// Keep the panel registered and available from Joplin's plugin-panel button.
	// On mobile this does not open an extra desktop-style layout column.
	await joplin.views.panels.show(handle);
}
