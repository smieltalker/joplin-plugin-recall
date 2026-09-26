import joplin from 'api';
import { Counts, countBody, emptyCounts, addCounts } from './wordcount';
import { ON_THIS_DAY_PREFIX, DIGEST_PREFIX, STATS_PREFIX } from './constants';

// -------------------------------------------------------------------------
// Whole-library statistics.
//
// Reading 3,000+ note bodies through the data API takes seconds, so counts are
// cached per note and only recomputed when a note's updated_time moves. The
// metadata pass (no bodies) runs every time, which keeps notebook and date
// breakdowns correct when a note is moved or retitled without being edited.
// -------------------------------------------------------------------------

export const CACHE_SETTING = 'recall.statsCache';
const CACHE_VERSION = 2;

// [updated_time, words, cjk, cjkPunct, latin, code] — positional to keep the
// serialised cache small; it lives in a plugin setting.
type Entry = [number, number, number, number, number, number];
interface CacheFile { v: number; e: Record<string, Entry> }

// Past this many stale notes, paging through every body is fewer round trips
// than fetching the changed ones one at a time.
const BULK_THRESHOLD = 150;
const PAGE_SIZE = 100;

interface NoteRow {
	id: string;
	parent_id: string;
	title: string;
	created_time: number;
	updated_time: number;
}

export interface Bucket { key: string; words: number; notes: number }

export interface Stats {
	total: Counts;
	noteCount: number;
	withBody: number;
	byYear: Bucket[];
	byNotebook: Bucket[];
	byDay: Record<string, number>;
	today: number;
	thisWeek: number;
	thisMonth: number;
	thisYear: number;
	longest: { id: string; title: string; words: number }[];
	generatedAt: number;
	rescanned: number; // bodies re-read this run; 0 means a fully warm cache
}

type Progress = (msg: string) => void;

// --- cache ---------------------------------------------------------------

async function loadCache(): Promise<Record<string, Entry>> {
	try {
		const raw = (await joplin.settings.value(CACHE_SETTING)) as string;
		if (!raw) return {};
		const parsed = JSON.parse(raw) as CacheFile;
		if (!parsed || parsed.v !== CACHE_VERSION || !parsed.e) return {};
		return parsed.e;
	} catch (_) {
		return {}; // a corrupt cache is not worth surfacing; just rebuild it
	}
}

async function saveCache(e: Record<string, Entry>): Promise<void> {
	try {
		await joplin.settings.setValue(CACHE_SETTING, JSON.stringify({ v: CACHE_VERSION, e }));
	} catch (_) {
		// Losing the cache only costs time on the next run.
	}
}

export async function clearCache(): Promise<void> {
	await joplin.settings.setValue(CACHE_SETTING, '');
}

const toCounts = (e: Entry): Counts =>
	({ words: e[1], cjk: e[2], cjkPunct: e[3], latin: e[4], numbers: 0, code: e[5] });

// --- fetching ------------------------------------------------------------

async function fetchPaged<T>(path: string[], fields: string[]): Promise<T[]> {
	const out: T[] = [];
	let page = 1;
	for (;;) {
		const res = await joplin.data.get(path, { fields, limit: PAGE_SIZE, page });
		out.push(...res.items);
		if (!res.has_more) break;
		page++;
	}
	return out;
}

/** Full notebook path, e.g. "日记 / 2024", so sibling notebooks stay distinct. */
function notebookPaths(folders: { id: string; title: string; parent_id: string }[]): Record<string, string> {
	const byId: Record<string, { title: string; parent_id: string }> = {};
	for (const f of folders) byId[f.id] = { title: f.title, parent_id: f.parent_id };

	const paths: Record<string, string> = {};
	const resolve = (id: string, depth = 0): string => {
		if (!byId[id] || depth > 12) return '';
		if (paths[id]) return paths[id];
		const { title, parent_id } = byId[id];
		const parent = parent_id ? resolve(parent_id, depth + 1) : '';
		const full = parent ? `${parent} / ${title}` : title;
		paths[id] = full;
		return full;
	};
	for (const f of folders) resolve(f.id);
	return paths;
}

// --- main ----------------------------------------------------------------

export async function computeStats(onProgress: Progress = () => {}): Promise<Stats> {
	onProgress('Reading note list…');
	const notes = await fetchPaged<NoteRow>(
		['notes'],
		['id', 'parent_id', 'title', 'created_time', 'updated_time'],
	);
	const folders = await fetchPaged<{ id: string; title: string; parent_id: string }>(
		['folders'],
		['id', 'title', 'parent_id'],
	);
	const paths = notebookPaths(folders);

	// Recall's own generated notes are not writing.
	const subjects = notes.filter((n) => {
		const t = n.title || '';
		return !t.startsWith(ON_THIS_DAY_PREFIX) && !t.startsWith(DIGEST_PREFIX) && !t.startsWith(STATS_PREFIX);
	});

	const cache = await loadCache();
	const stale = subjects.filter((n) => {
		const hit = cache[n.id];
		return !hit || hit[0] !== n.updated_time;
	});

	if (stale.length) {
		onProgress(`Counting ${stale.length.toLocaleString()} new or edited note${stale.length === 1 ? '' : 's'}…`);
		const staleIds = new Set(stale.map((n) => n.id));

		if (stale.length >= BULK_THRESHOLD) {
			// Page through everything: far fewer round trips than one call each.
			let page = 1;
			let seen = 0;
			for (;;) {
				const res = await joplin.data.get(['notes'], {
					fields: ['id', 'body', 'updated_time'],
					limit: PAGE_SIZE,
					page,
				});
				for (const row of res.items as { id: string; body: string; updated_time: number }[]) {
					if (!staleIds.has(row.id)) continue;
					const c = countBody(row.body || '');
					cache[row.id] = [row.updated_time, c.words, c.cjk, c.cjkPunct, c.latin, c.code];
					seen++;
				}
				onProgress(`Counting… ${Math.min(seen, stale.length).toLocaleString()} / ${stale.length.toLocaleString()}`);
				if (!res.has_more) break;
				page++;
			}
		} else {
			let done = 0;
			for (const n of stale) {
				try {
					const row = await joplin.data.get(['notes', n.id], { fields: ['body'] });
					const c = countBody(row.body || '');
					cache[n.id] = [n.updated_time, c.words, c.cjk, c.cjkPunct, c.latin, c.code];
				} catch (_) {
					// Note vanished mid-run; skip it.
				}
				if (++done % 25 === 0) onProgress(`Counting… ${done} / ${stale.length}`);
			}
		}
	}

	// Drop entries for notes that no longer exist, so the cache can't grow without bound.
	const live = new Set(subjects.map((n) => n.id));
	for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
	await saveCache(cache);

	onProgress('Aggregating…');

	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfWeek = startOfDay - ((now.getDay() + 6) % 7) * 86400000; // weeks start Monday
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

	let total = emptyCounts();
	let withBody = 0;
	let today = 0, thisWeek = 0, thisMonth = 0, thisYear = 0;
	const years: Record<string, Bucket> = {};
	const books: Record<string, Bucket> = {};
	const byDay: Record<string, number> = {};
	const longest: { id: string; title: string; words: number }[] = [];

	for (const n of subjects) {
		const entry = cache[n.id];
		if (!entry) continue;
		const c = toCounts(entry);
		total = addCounts(total, c);
		if (c.words > 0) withBody++;

		const created = n.created_time || 0;
		const y = String(new Date(created).getFullYear());
		(years[y] ||= { key: y, words: 0, notes: 0 });
		years[y].words += c.words;
		years[y].notes++;

		const book = paths[n.parent_id] || '(no notebook)';
		(books[book] ||= { key: book, words: 0, notes: 0 });
		books[book].words += c.words;
		books[book].notes++;

		const d = new Date(created);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		byDay[key] = (byDay[key] || 0) + c.words;

		if (created >= startOfDay) today += c.words;
		if (created >= startOfWeek) thisWeek += c.words;
		if (created >= startOfMonth) thisMonth += c.words;
		if (created >= startOfYear) thisYear += c.words;

		longest.push({ id: n.id, title: n.title || '(untitled)', words: c.words });
	}

	longest.sort((a, b) => b.words - a.words);

	return {
		total,
		noteCount: subjects.length,
		withBody,
		byYear: Object.values(years).sort((a, b) => a.key.localeCompare(b.key)),
		byNotebook: Object.values(books).sort((a, b) => b.words - a.words),
		byDay,
		today, thisWeek, thisMonth, thisYear,
		longest: longest.slice(0, 10),
		generatedAt: Date.now(),
		rescanned: stale.length,
	};
}
