import * as assert from 'assert';
import { lifecycle, store, reset } from './pluginStub';
import '../src/index';
import { ON_THIS_DAY_PREFIX, DIGEST_PREFIX } from '../src/constants';
import { computeStats } from '../src/stats';
import { SOURCE_NOTEBOOK_IDS, INCLUDE_SUB_NOTEBOOKS, sourceNotebookIds } from '../src/notebookScope';

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
const run = (action: string) => store.commands[`recall.${action}`]();
const panel = (action: string) => store.panels['recall.mobile'].handler!({ action });
const lastState = () => store.states[store.states.length - 1];
function note(id: string, title: string, body = 'hello 世界', time = Date.now()) {
	return { id, title, body, parent_id: 'book', created_time: time, updated_time: time, is_todo: 0, todo_completed: 0 };
}

(async () => {
	reset('mobile');
	let timers = 0;
	const originalTimer = global.setTimeout;
	global.setTimeout = (() => { timers++; return 0; }) as any;
	await lifecycle.onStart();
	global.setTimeout = originalTimer;
	check('mobile registers all four commands and a launcher; no desktop APIs or automatic writes', () => {
		assert.equal(Object.keys(store.commands).length, 4);
		assert.equal(Object.keys(store.panels).length, 1);
		assert.equal(store.menus + store.toolbars + store.dialogs + store.posts + timers, 0);
	});
	await panel('ready');
	check('reopened panel restores current state', () => assert.match(lastState().status, /startup generation is off/));
	await run('randomNote');
	check('empty library reports no notes', () => assert.match(store.messages.pop()!, /no notes/));
	store.notes = [note('ordinary', 'A [bracket] and \\slash'), note('todo', 'Done'), note('generated', DIGEST_PREFIX + ' · yesterday')];
	store.notes[1].is_todo = 1; store.notes[1].todo_completed = 123;
	store.noteChange();
	await panel('randomNote');
	check('random review excludes generated notes and completed to-dos', () => assert.equal(store.opened.pop(), 'ordinary'));
	store.syncStart();
	await run('dailyDigest');
	check('active sync prevents summary writes', () => { assert.equal(store.posts, 0); assert.match(store.messages.pop()!, /synchronisation/); });
	store.syncComplete({ withErrors: false });

	// Force two requests to overlap at the write, then release the first.
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	let reached!: () => void;
	const writing = new Promise<void>((resolve) => { reached = resolve; });
	store.beforePost = async () => { reached(); await blocked; };
	const first = run('dailyDigest');
	await writing;
	await run('dailyDigest');
	release(); await first; store.beforePost = null;
	check('double taps create only one daily summary in a notebook', () => {
		assert.equal(store.posts, 1);
		assert.equal(store.notes.find((n) => n.id === 'generated-1')!.parent_id, 'book');
	});
	check('generated note links escape brackets and backslashes', () => {
		assert.ok(store.notes.find((n) => n.id === 'generated-1')!.body.includes('[A \\[bracket\\] and \\\\slash](:/ordinary)'));
	});
	await run('dailyDigest');
	check('rerunning updates the same daily note', () => { assert.equal(store.posts, 1); assert.equal(store.puts, 1); });

	store.beforeGet = async (path) => { if (path[0] === 'notes' && path.length === 1) store.syncStart(); };
	await run('dailyDigest'); store.beforeGet = null;
	check('sync beginning during generation aborts before updating a note', () => {
		assert.equal(store.puts, 1); assert.match(store.messages.pop()!, /synchronisation/);
	});
	store.syncComplete({ withErrors: false });
	store.beforeGet = async (path) => {
		if (path[0] === 'notes' && path.length === 1) {
			store.syncStart(); store.syncComplete({ withErrors: false });
		}
	};
	await run('dailyDigest'); store.beforeGet = null;
	check('even a sync that finishes mid-generation invalidates that snapshot', () => {
		assert.equal(store.puts, 1); assert.match(store.messages.pop()!, /synchronisation/);
	});

	const today = new Date();
	const old = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).getTime();
	store.notes.push(note('anniversary', 'An anniversary', '去年今天', old)); store.noteChange();
	await run('onThisDay');
	check('on-this-day includes previous years and opens the result', () => {
		const output = store.notes.find((n) => n.title.startsWith(ON_THIS_DAY_PREFIX))!;
		assert.ok(output.body.includes('(:/anniversary)'));
		assert.ok(!output.body.includes('(:/ordinary)'));
		assert.equal(store.opened.pop(), output.id);
	});


	store.notes.push({ ...note('imported', 'Imported date', '旧日记'), user_created_time: old });
	store.noteChange(); await run('onThisDay');
	check('on-this-day honours imported/user-edited creation dates', () => {
		assert.ok(store.notes.find((n) => n.title.startsWith(ON_THIS_DAY_PREFIX))!.body.includes('(:/imported)'));
	});
	const datedStats = await computeStats();
	check('statistics use the same visible creation date', () => {
		assert.equal(datedStats.byYear.find((row) => row.key === String(today.getFullYear() - 1))!.words, 7);
	});

	store.notes = Array.from({ length: 205 }, (_, i) => note(`n${String(i).padStart(3, '0')}`, i === 0 ? '<img src=x onerror=alert(1)>' : `Note ${i}`));
	store.noteChange(); store.settings['recall.statsCache'] = ''; store.calls = [];
	await panel('writingStats');
	check('mobile counts a multi-page library and escapes note titles', () => {
		assert.ok(lastState().html.includes('615'));
		assert.ok(lastState().html.includes('&lt;img'));
		assert.ok(!lastState().html.includes('<img'));
		assert.equal(lastState().busy, false);
	});
	check('first scan reports progress before completion', () => assert.ok(store.states.some((s) => /Counting…/.test(s.status))));
	store.calls = []; await panel('writingStats');
	check('warm cache does not refetch note bodies', () => assert.ok(!store.calls.some((c) => c.query.fields?.includes('body'))));
	await panel('copy');
	check('Android copy returns Markdown statistics', () => assert.match(store.clipboard, /Total words:\*\* 615/));
	store.calls = []; await panel('rebuild');
	check('recount discards the cache and reads bodies again', () => assert.ok(store.calls.some((c) => c.query.fields?.includes('body'))));
	const priorPosts = store.posts;
	await panel('deleteEverything');
	check('panel rejects actions outside its allowlist', () => assert.equal(store.posts, priorPosts));
	store.beforeGet = async () => { throw new Error('Simulated API failure'); };
	await panel('rebuild'); store.beforeGet = null;
	check('statistics error releases the busy state', () => { assert.equal(lastState().busy, false); assert.match(lastState().status, /Simulated API failure/); });
	await panel('rebuild');
	check('statistics can be retried after an error', () => assert.match(lastState().status, /Statistics ready/));

	store.notes = []; store.folders = []; store.noteChange();
	await run('dailyDigest');
	check('missing notebook gives a useful error and creates nothing', () => {
		assert.equal(store.posts, priorPosts); assert.match(store.messages.pop()!, /Create a notebook/);
	});

	reset('desktop'); store.settings['recall.runOnStartup'] = false;
	await lifecycle.onStart();
	check('desktop retains toolbar, menu and dialog, without a mobile panel', () => {
		assert.equal(store.menus, 1); assert.equal(store.toolbars, 1); assert.equal(store.dialogs, 1);
		assert.equal(Object.keys(store.panels).length, 0);
	});
	await run('writingStats');
	check('dismissing desktop statistics without a button result is safe', () => assert.equal(store.messages.length, 0));
	store.settings['recall.runOnStartup'] = true;
	timers = 0;
	global.setTimeout = (() => { timers++; return 0; }) as any;
	await lifecycle.onStart(); global.setTimeout = originalTimer;
	check('desktop startup option still schedules a digest', () => assert.equal(timers, 1));

	const notebookId = (n: number) => n.toString(16).padStart(32, '0');
	const A = notebookId(170), C = notebookId(187), G = notebookId(204), B = notebookId(221);
	const OUT = notebookId(238), EMPTY = notebookId(255);
	for (const platform of ['mobile', 'desktop']) {
		reset(platform); store.settings['recall.runOnStartup'] = false;
		await lifecycle.onStart(); store.noteChange();
		store.folders = [
			{ id: A, title: 'Journal', parent_id: '' },
			{ id: C, title: 'Child', parent_id: A },
			{ id: G, title: 'Grandchild', parent_id: C },
			{ id: B, title: 'Journal', parent_id: '' },
			{ id: OUT, title: 'Recall output', parent_id: '' },
			{ id: EMPTY, title: 'Empty', parent_id: '' },
		];
		store.notes = [
			{ ...note('root-a', 'Root A', 'hello 世界', old), parent_id: A },
			{ ...note('child', 'Child note', 'hello 世界', old), parent_id: C },
			{ ...note('grandchild', 'Grandchild note', 'hello 世界', old), parent_id: G },
			{ ...note('root-b', 'Root B', 'hello 世界', old), parent_id: B },
		];
		store.settings['recall.targetNotebookId'] = OUT;
		const digest = () => store.notes.find((n) => n.title.startsWith(DIGEST_PREFIX))!;
		const onDay = () => store.notes.find((n) => n.title.startsWith(ON_THIS_DAY_PREFIX))!;
		const otdPart = () => digest().body.split('## Random Review')[0];
		check(`${platform}: source settings default to whole library and no descendants`, () => {
			assert.equal(store.settings[SOURCE_NOTEBOOK_IDS], '');
			assert.equal(store.settings[INCLUDE_SUB_NOTEBOOKS], false);
		});
		store.calls = []; await run('dailyDigest');
		check(`${platform}: blank source keeps all notebooks without a folder scan`, () => {
			for (const id of ['root-a','child','grandchild','root-b']) assert.ok(otdPart().includes(`(:/${id})`));
			assert.ok(!store.calls.some((call) => call.path[0] === 'folders'));
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = ` ${A.toUpperCase()}, ${A}, `;
		await run('randomNote'); await run('dailyDigest'); await run('onThisDay');
		check(`${platform}: direct source filters all three actions, tolerating case, spaces and duplicates`, () => {
			assert.equal(store.opened[store.opened.length - 3], 'root-a');
			assert.ok(otdPart().includes('(:/root-a)'));
			for (const id of ['child','grandchild','root-b']) {
				assert.ok(!digest().body.includes(`(:/${id})`));
				assert.ok(!onDay().body.includes(`(:/${id})`));
			}
			assert.ok(onDay().body.includes('(:/root-a)'));
		});
		check(`${platform}: summaries stay in the target notebook outside the source scope`, () => {
			assert.equal(store.posts, 2); assert.equal(digest().parent_id, OUT); assert.equal(onDay().parent_id, OUT);
		});
		store.settings[INCLUDE_SUB_NOTEBOOKS] = true;
		store.settings[SOURCE_NOTEBOOK_IDS] = `${A},${C}`;
		await run('dailyDigest');
		check(`${platform}: descendants include all levels and overlapping selections are deduplicated`, () => {
			for (const id of ['root-a','child','grandchild']) assert.equal(otdPart().split(`(:/${id})`).length - 1, 1);
			assert.ok(!digest().body.includes('(:/root-b)'));
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = `${A},${B}`;
		store.settings[INCLUDE_SUB_NOTEBOOKS] = false;
		await run('dailyDigest');
		check(`${platform}: multiple source notebooks are matched by ID, not duplicate names`, () => {
			assert.ok(otdPart().includes('(:/root-a)')); assert.ok(otdPart().includes('(:/root-b)'));
			assert.ok(!digest().body.includes('(:/child)')); assert.ok(!digest().body.includes('(:/grandchild)'));
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = B;
		await run('randomNote'); await run('dailyDigest'); await run('onThisDay');
		check(`${platform}: setting changes take effect without restart or cache invalidation`, () => {
			assert.equal(store.opened[store.opened.length - 3], 'root-b');
			assert.ok(!digest().body.includes('(:/root-a)')); assert.ok(onDay().body.includes('(:/root-b)'));
			assert.equal(store.posts, 2);
		});
		const writes = store.posts + store.puts, openings = store.opened.length;
		store.settings[SOURCE_NOTEBOOK_IDS] = `${A},${notebookId(999)}`;
		await run('dailyDigest'); await run('randomNote');
		check(`${platform}: one unknown source ID stops generation without falling back to all notes`, () => {
			assert.equal(store.posts + store.puts, writes); assert.equal(store.opened.length, openings);
			assert.match(store.messages.pop()!, /Source notebooks not found/);
		});
		for (const value of ['not-a-notebook-id', ', ,']) {
			store.settings[SOURCE_NOTEBOOK_IDS] = value; await run('dailyDigest');
			check(`${platform}: malformed nonempty source '${value}' does not mean all notebooks`, () => {
				assert.equal(store.posts + store.puts, writes); assert.match(store.messages.pop()!, /32-character/);
			});
		}
		store.settings[SOURCE_NOTEBOOK_IDS] = EMPTY; await run('dailyDigest');
		check(`${platform}: an empty source does not overwrite the previous daily summary`, () => {
			assert.equal(store.posts + store.puts, writes); assert.match(store.messages.pop()!, /No notes in the selected/);
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = A; store.settings[INCLUDE_SUB_NOTEBOOKS] = true;
		store.folders.find((folder) => folder.id === C)!.parent_id = B;
		await run('dailyDigest');
		check(`${platform}: moving a sub-notebook removes its entire subtree immediately`, () => {
			assert.ok(otdPart().includes('(:/root-a)'));
			assert.ok(!digest().body.includes('(:/child)')); assert.ok(!digest().body.includes('(:/grandchild)'));
		});
		store.notes.find((n) => n.id === 'root-a')!.parent_id = B;
		await run('randomNote');
		check(`${platform}: moving a note out of scope does not reuse stale cached membership`, () => {
			assert.match(store.messages.pop()!, /No notes in the selected/);
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = 'invalid';
		const scopedStats = await computeStats();
		check(`${platform}: source settings, even invalid ones, never restrict whole-library statistics`, () => {
			assert.equal(scopedStats.noteCount, 4); assert.equal(scopedStats.total.words, 12);
		});
		store.settings[SOURCE_NOTEBOOK_IDS] = '   ';
		await run('dailyDigest');
		check(`${platform}: clearing source IDs restores the whole library and reuses the existing summary`, () => {
			for (const id of ['root-a','child','grandchild','root-b']) assert.ok(otdPart().includes(`(:/${id})`));
			assert.equal(store.posts, 2);
		});
	}
	store.folders = Array.from({ length: 205 }, (_, i) => ({ id: notebookId(i + 1), title: `Book ${i}`, parent_id: i ? notebookId(i) : '' }));
	store.settings[SOURCE_NOTEBOOK_IDS] = notebookId(1);
	store.settings[INCLUDE_SUB_NOTEBOOKS] = true; store.calls = [];
	const deepScope = await sourceNotebookIds();
	check('notebook scope paginates more than 100 folders and handles arbitrarily deep descendants', () => {
		assert.equal(deepScope!.size, 205);
		assert.equal(store.calls.filter((c) => c.path[0] === 'folders').length, 3);
	});
	store.folders[0].parent_id = notebookId(205);
	const cyclicScope = await sourceNotebookIds();
	check('malformed cyclic notebook trees terminate without duplicating IDs', () => assert.equal(cyclicScope!.size, 205));

	console.log(`\n${passed} integration scenarios passed.\n`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
