import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation, SettingItemType } from 'api/types';
import { ON_THIS_DAY_PREFIX, DIGEST_PREFIX } from './constants';
import { registerDialog, showStats } from './statsView';
import { CACHE_SETTING } from './stats';

interface NoteMeta {
	id: string;
	title: string;
	created_time: number; // unix epoch in ms
	is_todo: number;
	todo_completed: number;
}

// -------------------------------------------------------------------------
// Note cache — fetching every note on each click is what makes other random
// plugins lag on large collections, so we keep a short-lived in-memory copy.
// -------------------------------------------------------------------------
let cache: { at: number; notes: NoteMeta[] } | null = null;
const CACHE_TTL_MS = 60 * 1000;

async function fetchAllNotes(): Promise<NoteMeta[]> {
	const fields = ['id', 'title', 'created_time', 'is_todo', 'todo_completed'];
	const notes: NoteMeta[] = [];
	let page = 1;
	for (;;) {
		const res = await joplin.data.get(['notes'], {
			fields,
			limit: 100,
			page,
			order_by: 'updated_time',
			order_dir: 'DESC',
		});
		notes.push(...res.items);
		if (!res.has_more) break;
		page++;
	}
	return notes;
}

async function getNotes(forceRefresh = false): Promise<NoteMeta[]> {
	const now = Date.now();
	if (!forceRefresh && cache && now - cache.at < CACHE_TTL_MS) return cache.notes;
	const notes = await fetchAllNotes();
	cache = { at: now, notes };
	return notes;
}

// Notes eligible for random / digest selection: drop this plugin's own
// generated notes and, optionally, completed to-dos.
async function selectableNotes(): Promise<NoteMeta[]> {
	const excludeCompleted = (await joplin.settings.value('recall.excludeCompletedTodos')) as boolean;
	const all = await getNotes();
	return all.filter((n) => {
		const t = n.title || '';
		if (t.startsWith(ON_THIS_DAY_PREFIX) || t.startsWith(DIGEST_PREFIX)) return false;
		if (excludeCompleted && n.is_todo === 1 && n.todo_completed) return false;
		return true;
	});
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function pickRandom<T>(arr: T[], n: number): T[] {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a.slice(0, Math.max(0, n));
}

function pad(x: number): string {
	return String(x).padStart(2, '0');
}

function fmtDate(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Notes created on the same month/day in *previous* years.
function onThisDay(notes: NoteMeta[], today = new Date()): NoteMeta[] {
	const m = today.getMonth();
	const d = today.getDate();
	const y = today.getFullYear();
	return notes
		.filter((n) => {
			const c = new Date(n.created_time);
			return c.getMonth() === m && c.getDate() === d && c.getFullYear() < y;
		})
		.sort((a, b) => b.created_time - a.created_time);
}

function link(n: NoteMeta): string {
	return `[${n.title || '(untitled)'}](:/${n.id})`;
}

// Create the note, or update it in place if one with the same title already
// exists (keeps a single rolling note per day instead of piling up duplicates).
async function upsertNote(title: string, body: string): Promise<string> {
	const targetNotebookId = (await joplin.settings.value('recall.targetNotebookId')) as string;
	const search = await joplin.data.get(['search'], { query: `title:"${title}"`, fields: ['id', 'title'] });
	const existing = (search.items || []).find((it: any) => it.title === title);
	if (existing) {
		await joplin.data.put(['notes', existing.id], null, { body });
		return existing.id;
	}
	const payload: any = { title, body };
	if (targetNotebookId) payload.parent_id = targetNotebookId;
	const created = await joplin.data.post(['notes'], null, payload);
	return created.id;
}

async function info(message: string) {
	await joplin.views.dialogs.showMessageBox(message);
}

// -------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------
async function cmdRandomNote() {
	const notes = await selectableNotes();
	if (!notes.length) {
		await info('Recall: no notes to pick from.');
		return;
	}
	const [pick] = pickRandom(notes, 1);
	await joplin.commands.execute('openNote', pick.id);
}

async function cmdOnThisDay() {
	const notes = await getNotes();
	const hits = onThisDay(notes);
	const today = fmtDate(Date.now());
	if (!hits.length) {
		await info(`Recall — On This Day (${today}):\nNo notes were created on this day in past years.`);
		return;
	}
	const title = `${ON_THIS_DAY_PREFIX} · ${today}`;
	let body = `# ${title}\n\nNotes you created on this day, in earlier years:\n\n`;
	for (const h of hits) body += `- ${fmtDate(h.created_time)} · ${link(h)}\n`;
	const id = await upsertNote(title, body);
	await joplin.commands.execute('openNote', id);
}

async function cmdDailyDigest() {
	const today = fmtDate(Date.now());
	const all = await getNotes();
	const otd = onThisDay(all);
	const randomCount = (await joplin.settings.value('recall.randomCount')) as number;
	const rnd = pickRandom(await selectableNotes(), randomCount);

	const title = `${DIGEST_PREFIX} · ${today}`;
	let body = `# ${title}\n\n## On This Day\n\n`;
	if (otd.length) {
		for (const h of otd) body += `- ${fmtDate(h.created_time)} · ${link(h)}\n`;
	} else {
		body += `_No notes from this day in past years._\n`;
	}
	body += `\n## Random Review\n\n`;
	if (rnd.length) {
		for (const r of rnd) body += `- ${link(r)} · created ${fmtDate(r.created_time)}\n`;
	} else {
		body += `_No notes available._\n`;
	}

	const id = await upsertNote(title, body);
	await joplin.commands.execute('openNote', id);
}

// -------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------
joplin.plugins.register({
	onStart: async function () {
		await joplin.settings.registerSection('recall', {
			label: 'Recall',
			iconName: 'fas fa-dice',
		});

		await joplin.settings.registerSettings({
			'recall.randomCount': {
				value: 3,
				type: SettingItemType.Int,
				section: 'recall',
				public: true,
				label: 'Random notes in Daily Recall',
				description: 'How many random notes to include in the Daily Recall digest.',
			},
			'recall.excludeCompletedTodos': {
				value: true,
				type: SettingItemType.Bool,
				section: 'recall',
				public: true,
				label: 'Exclude completed to-dos',
				description: 'Skip finished to-dos when picking random / review notes.',
			},
			'recall.targetNotebookId': {
				value: '',
				type: SettingItemType.String,
				section: 'recall',
				public: true,
				label: 'Target notebook ID (optional)',
				description: 'Notebook ID where "On This Day" and "Daily Recall" notes are stored. Leave empty for the default location. (Right-click a notebook → Copy notebook ID.)',
			},
			[CACHE_SETTING]: {
				value: '',
				type: SettingItemType.String,
				section: 'recall',
				public: false,
				label: 'Writing statistics cache',
			},
			'recall.runOnStartup': {
				value: false,
				type: SettingItemType.Bool,
				section: 'recall',
				public: true,
				label: 'Generate Daily Recall on startup',
				description: 'Automatically build the Daily Recall digest when Joplin starts.',
			},
		});

		await joplin.commands.register({
			name: 'recall.randomNote',
			label: 'Recall: Open a random note',
			iconName: 'fas fa-dice',
			execute: cmdRandomNote,
		});
		await joplin.commands.register({
			name: 'recall.onThisDay',
			label: 'Recall: On this day',
			iconName: 'fas fa-calendar-day',
			execute: cmdOnThisDay,
		});
		await registerDialog();

		await joplin.commands.register({
			name: 'recall.writingStats',
			label: 'Recall: Writing statistics',
			iconName: 'fas fa-chart-column',
			execute: () => showStats(),
		});
		await joplin.commands.register({
			name: 'recall.dailyDigest',
			label: 'Recall: Generate daily digest',
			iconName: 'fas fa-clock-rotate-left',
			execute: cmdDailyDigest,
		});

		// Quick-access toolbar button for the most-used action.
		await joplin.views.toolbarButtons.create(
			'recall.toolbar.random',
			'recall.randomNote',
			ToolbarButtonLocation.NoteToolbar,
		);

		// Tools → Recall submenu with every action.
		await joplin.views.menus.create(
			'recall.menu',
			'Recall',
			[
				{ commandName: 'recall.randomNote' },
				{ commandName: 'recall.onThisDay' },
				{ commandName: 'recall.dailyDigest' },
				{ commandName: 'recall.writingStats' },
			],
			MenuItemLocation.Tools,
		);

		if ((await joplin.settings.value('recall.runOnStartup')) as boolean) {
			// Don't block startup; let Joplin finish loading first.
			setTimeout(() => { cmdDailyDigest().catch(() => {}); }, 3000);
		}
	},
});
