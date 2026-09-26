import joplin from 'api';
import { STATS_PREFIX } from './constants';

/** Keep a single rolling stats note instead of piling up a new one each run. */
export async function upsertStatsNote(body: string): Promise<string> {
	const targetNotebookId = (await joplin.settings.value('recall.targetNotebookId')) as string;
	const search = await joplin.data.get(['search'], { query: `title:"${STATS_PREFIX}"`, fields: ['id', 'title'] });
	const existing = (search.items || []).find((it: { title: string }) => it.title === STATS_PREFIX);
	if (existing) {
		await joplin.data.put(['notes', existing.id], null, { body });
		return existing.id;
	}
	const payload: { title: string; body: string; parent_id?: string } = { title: STATS_PREFIX, body };
	if (targetNotebookId) payload.parent_id = targetNotebookId;
	const created = await joplin.data.post(['notes'], null, payload);
	return created.id;
}
