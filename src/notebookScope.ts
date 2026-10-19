import joplin from 'api';

export const SOURCE_NOTEBOOK_IDS = 'recall.sourceNotebookIds';
export const INCLUDE_SUB_NOTEBOOKS = 'recall.includeSubNotebooks';

// null means unrestricted. An invalid nonempty setting must never silently
// become unrestricted, or unrelated/private notes could enter a review.
export async function sourceNotebookIds(): Promise<Set<string> | null> {
	const raw = String((await joplin.settings.value(SOURCE_NOTEBOOK_IDS)) || '').trim();
	if (!raw) return null;
	const tokens = raw.split(',').map((id) => id.trim()).filter(Boolean);
	if (!tokens.length || tokens.some((id) => !/^[0-9a-f]{32}$/i.test(id))) {
		throw new Error('Source notebook IDs must be 32-character notebook IDs separated by commas. Check Settings → Recall, or leave the setting empty to use all notebooks.');
	}
	const selected = new Set(tokens.map((id) => id.toLowerCase()));
	const folders: { id: string; parent_id: string }[] = [];
	for (let page = 1; ; page++) {
		const result = await joplin.data.get(['folders'], {
			fields: ['id', 'parent_id'], limit: 100, page, order_by: 'id', order_dir: 'ASC',
		});
		folders.push(...result.items);
		if (!result.has_more) break;
	}
	const known = new Set(folders.map((folder) => folder.id));
	const missing = Array.from(selected).filter((id) => !known.has(id));
	if (missing.length) {
		throw new Error(`Source notebooks not found: ${missing.join(', ')}. Finish syncing, or correct the IDs in Settings → Recall.`);
	}
	if (await joplin.settings.value(INCLUDE_SUB_NOTEBOOKS)) {
		const children = new Map<string, string[]>();
		for (const folder of folders) {
			if (!children.has(folder.parent_id)) children.set(folder.parent_id, []);
			children.get(folder.parent_id)!.push(folder.id);
		}
		const pending = Array.from(selected);
		for (let i = 0; i < pending.length; i++) {
			for (const child of children.get(pending[i]) || []) {
				if (selected.has(child)) continue;
				selected.add(child);
				pending.push(child);
			}
		}
	}
	return selected;
}
