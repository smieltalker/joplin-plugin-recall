import joplin from 'api';
import { STATS_PREFIX } from './constants';

export const STATS_NOTE_SETTING = 'recall.statsNoteId';

/**
 * Keep a single rolling stats note instead of piling up a new one each run.
 *
 * The note id is remembered in a setting rather than looked up by title every
 * time: a title search has to match an emoji and spaces inside a quoted query,
 * and any miss silently creates a duplicate on every run. Title search is kept
 * only as a fallback for notes created before the id was recorded, or when the
 * user deletes the note and we need to notice.
 */
export async function upsertStatsNote(body: string): Promise<string> {
	const remembered = (await joplin.settings.value(STATS_NOTE_SETTING)) as string;
	if (remembered) {
		try {
			await joplin.data.get(['notes', remembered], { fields: ['id'] });
			await joplin.data.put(['notes', remembered], null, { body });
			return remembered;
		} catch (_) {
			// Deleted or purged since last time — fall through and make a new one.
		}
	}

	try {
		const search = await joplin.data.get(['search'], { query: `title:"${STATS_PREFIX}"`, fields: ['id', 'title'] });
		const existing = (search.items || []).find((it: { title: string }) => it.title === STATS_PREFIX);
		if (existing) {
			await joplin.data.put(['notes', existing.id], null, { body });
			await joplin.settings.setValue(STATS_NOTE_SETTING, existing.id);
			return existing.id;
		}
	} catch (_) {
		// Search is best-effort; creating a note below is still correct.
	}

	const targetNotebookId = (await joplin.settings.value('recall.targetNotebookId')) as string;
	const payload: { title: string; body: string; parent_id?: string } = { title: STATS_PREFIX, body };
	if (targetNotebookId) payload.parent_id = targetNotebookId;
	const created = await joplin.data.post(['notes'], null, payload);
	await joplin.settings.setValue(STATS_NOTE_SETTING, created.id);
	return created.id;
}
