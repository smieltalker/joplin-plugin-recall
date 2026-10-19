import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation, SettingItemType } from 'api/types';
import { ON_THIS_DAY_PREFIX, DIGEST_PREFIX, createdAt } from './constants';
import { registerDialog, showStats } from './statsView';
import { CACHE_SETTING } from './stats';
import { registerMobileView, showMobileStats } from './mobileView';
import { SOURCE_NOTEBOOK_IDS, INCLUDE_SUB_NOTEBOOKS, sourceNotebookIds } from './notebookScope';

interface NoteMeta {
	id: string;
	parent_id: string;
	title: string;
	created_time: number; // unix epoch in ms
	user_created_time?: number;
	is_todo: number;
	todo_completed: number;
}

// -------------------------------------------------------------------------
// Note cache — fetching every note on each click is what makes other random
// plugins lag on large collections, so we keep a short-lived in-memory copy.
// -------------------------------------------------------------------------
let cache: { at: number; notes: NoteMeta[] } | null = null;
let mobile = false;
let syncing = false;
let generating = false;
let syncRevision = 0;
let generationRevision = 0;

// A local lock prevents double taps from creating two daily notes. It cannot
// coordinate two devices; mobile auto-generation stays disabled for that reason.
async function generate(action: () => Promise<void>): Promise<void> {
	if (generating) return;
	generating = true;
	generationRevision = syncRevision;
	try {
		await action();
	} finally {
		generating = false;
	}
}

function checkSync(): void {
	if (mobile && (syncing || (generating && generationRevision !== syncRevision))) throw new Error('Please wait for synchronisation to finish, then try again.');
}

async function runAction(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (err) {
		await info(`Recall: ${String((err as Error)?.message || err)}`);
	}
}
const CACHE_TTL_MS = 60 * 1000;

async function fetchAllNotes(): Promise<NoteMeta[]> {
	const fields = ['id', 'parent_id', 'title', 'created_time', 'user_created_time', 'is_todo', 'todo_completed'];
	const notes: NoteMeta[] = [];
	let page = 1;
	for (;;) {
		const res = await joplin.data.get(['notes'], {
			fields,
			limit: 100,
			page,
			order_by: 'id',
			order_dir: 'ASC',
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

// Apply one source scope to all review actions, while retaining the whole
// library for daily-note lookup (the output notebook may be outside the scope).
async function reviewNotes(forceRefresh = false): Promise<{ all: NoteMeta[]; source: NoteMeta[] }> {
	const scope = await sourceNotebookIds();
	// Scoped reviews refresh metadata so a note moved to another notebook stops
	// appearing immediately. Folder relationships are also read for each action.
	const all = await getNotes(forceRefresh || scope !== null);
	const source = all.filter((note) => {
		const title = note.title || '';
		return !title.startsWith(ON_THIS_DAY_PREFIX) && !title.startsWith(DIGEST_PREFIX)
			&& (scope === null || scope.has(note.parent_id));
	});
	if (scope !== null && !source.length) {
		throw new Error('No notes in the selected source notebooks. Check the source IDs and Include sub-notebooks in Settings → Recall, or finish syncing.');
	}
	return { all, source };
}

async function selectableNotes(source: NoteMeta[]): Promise<NoteMeta[]> {
	const excludeCompleted = (await joplin.settings.value('recall.excludeCompletedTodos')) as boolean;
	return source.filter((note) => !(excludeCompleted && note.is_todo === 1 && note.todo_completed));
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
			const c = new Date(createdAt(n));
			return c.getMonth() === m && c.getDate() === d && c.getFullYear() < y;
		})
		.sort((a, b) => createdAt(b) - createdAt(a));
}

function link(n: NoteMeta): string {
	const title = (n.title || '(untitled)').replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/[\r\n]+/g, ' ');
	return `[${title}](:/${n.id})`;
}

// Create the note, or update it in place if one with the same title already
// exists (keeps a single rolling note per day instead of piling up duplicates).
async function upsertNote(title: string, body: string, notes: NoteMeta[]): Promise<string> {
	checkSync();
	const targetNotebookId = (await joplin.settings.value('recall.targetNotebookId')) as string;
	// Use the fresh note list: Joplin's search index can lag just-created notes.
	const existing = notes.find((it) => it.title === title);
	checkSync();
	if (existing) {
		await joplin.data.put(['notes', existing.id], null, { body });
		return existing.id;
	}
	const payload: any = { title, body };
	if (targetNotebookId) payload.parent_id = targetNotebookId;
	else if (mobile) {
		const selected = await joplin.workspace.selectedFolder();
		const folders = selected ? null : await joplin.data.get(['folders'], { fields: ['id'], limit: 1 });
		payload.parent_id = selected?.id || folders?.items?.[0]?.id;
		if (!payload.parent_id) throw new Error('Create a notebook before generating a Recall note.');
	}
	checkSync();
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
	const { source } = await reviewNotes();
	const notes = await selectableNotes(source);
	if (!notes.length) {
		await info('Recall: no notes to pick from.');
		return;
	}
	const [pick] = pickRandom(notes, 1);
	await joplin.commands.execute('openNote', pick.id);
}

async function cmdOnThisDay() {
	checkSync();
	const { all, source } = await reviewNotes(true);
	const hits = onThisDay(source);
	const today = fmtDate(Date.now());
	if (!hits.length) {
		await info(`Recall — On This Day (${today}):\nNo notes were created on this day in past years.`);
		return;
	}
	const title = `${ON_THIS_DAY_PREFIX} · ${today}`;
	let body = `# ${title}\n\nNotes you created on this day, in earlier years:\n\n`;
	for (const h of hits) body += `- ${fmtDate(createdAt(h))} · ${link(h)}\n`;
	const id = await upsertNote(title, body, all);
	await joplin.commands.execute('openNote', id);
}

async function cmdDailyDigest() {
	checkSync();
	const today = fmtDate(Date.now());
	const { all, source } = await reviewNotes(true);
	const otd = onThisDay(source);
	const randomCount = (await joplin.settings.value('recall.randomCount')) as number;
	const rnd = pickRandom(await selectableNotes(source), randomCount);

	const title = `${DIGEST_PREFIX} · ${today}`;
	let body = `# ${title}\n\n## On This Day\n\n`;
	if (otd.length) {
		for (const h of otd) body += `- ${fmtDate(createdAt(h))} · ${link(h)}\n`;
	} else {
		body += `_No notes from this day in past years._\n`;
	}
	body += `\n## Random Review\n\n`;
	if (rnd.length) {
		for (const r of rnd) body += `- ${link(r)} · created ${fmtDate(createdAt(r))}\n`;
	} else {
		body += `_No notes available._\n`;
	}

	const id = await upsertNote(title, body, all);
	await joplin.commands.execute('openNote', id);
}

// -------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------
joplin.plugins.register({
	onStart: async function () {
		mobile = (await joplin.versionInfo()).platform === 'mobile';
		await joplin.workspace.onSyncStart(() => { syncing = true; syncRevision++; cache = null; });
		await joplin.workspace.onSyncComplete(() => { syncing = false; syncRevision++; cache = null; });
		await joplin.workspace.onNoteChange(() => { cache = null; });
		await joplin.settings.registerSection('recall', {
			label: 'Recall',
			iconName: 'fas fa-dice',
		});

		await joplin.settings.registerSettings({
			[SOURCE_NOTEBOOK_IDS]: {
				value: '',
				type: SettingItemType.String,
				section: 'recall',
				public: true,
				label: 'Source notebook IDs (optional)',
				description: 'Comma-separated notebook IDs to review. Leave empty for all notebooks. On desktop, right-click a notebook → Copy notebook ID. Applies to Random note, On This Day and Daily Recall; writing statistics still cover the whole library.',
			},
			[INCLUDE_SUB_NOTEBOOKS]: {
				value: false,
				type: SettingItemType.Bool,
				section: 'recall',
				public: true,
				label: 'Include sub-notebooks',
				description: 'Include all levels of sub-notebooks inside the selected source notebooks. Applies only when source notebook IDs are set.',
			},
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
				description: 'Notebook ID where generated notes are stored. Leave empty for the current notebook on mobile or the default location on desktop.',
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
				description: 'Desktop only. On mobile, sync first, then generate the digest manually from the Recall panel.',
			},
		});

		await joplin.commands.register({
			name: 'recall.randomNote',
			label: 'Recall: Open a random note',
			iconName: 'fas fa-dice',
			execute: () => runAction(cmdRandomNote),
		});
		await joplin.commands.register({
			name: 'recall.onThisDay',
			label: 'Recall: On this day',
			iconName: 'fas fa-calendar-day',
			execute: () => runAction(() => generate(cmdOnThisDay)),
		});
		if (!mobile) await registerDialog();

		await joplin.commands.register({
			name: 'recall.writingStats',
			label: 'Recall: Writing statistics',
			iconName: 'fas fa-chart-column',
			execute: () => runAction(mobile ? showMobileStats : showStats),
		});
		await joplin.commands.register({
			name: 'recall.dailyDigest',
			label: 'Recall: Generate daily digest',
			iconName: 'fas fa-clock-rotate-left',
			execute: () => runAction(() => generate(cmdDailyDigest)),
		});

		if (mobile) {
			await registerMobileView();
		} else {
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

		}

		if (!mobile && ((await joplin.settings.value('recall.runOnStartup')) as boolean)) {
			// Don't block startup; let Joplin finish loading first.
			setTimeout(() => { void runAction(() => generate(cmdDailyDigest)); }, 3000);
		}
	},
});
