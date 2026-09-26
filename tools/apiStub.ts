// Test double for the Joplin plugin API. Feeds computeStats() from an in-memory
// store so the aggregation can be exercised against a real library without
// launching Joplin. Test-only: webpack bundles from src/, never tools/.

interface Row { [k: string]: any }

export const store = {
	notes: [] as Row[],
	folders: [] as Row[],
	settings: {} as Record<string, any>,
	calls: 0,
	html: '',
	clipboard: '',
	messages: [] as string[],
};

function page(items: Row[], fields: string[], limit: number, pageNo: number) {
	const start = (pageNo - 1) * limit;
	const slice = items.slice(start, start + limit).map((it) => {
		const o: Row = {};
		for (const f of fields) o[f] = it[f];
		return o;
	});
	return { items: slice, has_more: start + limit < items.length };
}

const joplin = {
	data: {
		async get(path: string[], query: Row = {}) {
			store.calls++;
			const fields: string[] = query.fields || [];
			if (path[0] === 'notes' && path.length === 1) {
				return page(store.notes, fields, query.limit || 100, query.page || 1);
			}
			if (path[0] === 'notes' && path.length === 2) {
				const hit = store.notes.find((x) => x.id === path[1]);
				if (!hit) throw new Error('not found');
				const o: Row = {};
				for (const f of fields) o[f] = hit[f];
				return o;
			}
			if (path[0] === 'folders') {
				return page(store.folders, fields, query.limit || 100, query.page || 1);
			}
			return { items: [], has_more: false };
		},
		async put(_path: string[], _query: Row | null, _body: Row) { /* not exercised here */ },
		async post(_path: string[], _query: Row | null, body: Row) { return { ...body, id: 'stub-note-id' }; },
	},
	settings: {
		async value(k: string) { return store.settings[k] ?? ''; },
		async setValue(k: string, v: any) { store.settings[k] = v; },
	},
	views: {
		dialogs: {
			async create(id: string) { return id; },
			async setHtml(_h: string, html: string) { store.html = html; return html; },
			async addScript(_h: string, _p: string) { /* noop */ },
			async setButtons(_h: string, b: Row[]) { return b; },
			async setFitToContent(_h: string, status: boolean) { return status; },
			// The harnesses only render; nothing here ever opens a real dialog.
			async open(_h: string) { return { id: 'close' as string, formData: undefined as any }; },
			async showToast(_t: Row) { /* noop */ },
			async showMessageBox(m: string) { store.messages.push(m); return 0; },
		},
	},
	commands: { async execute(_name: string, ..._args: any[]) { /* noop */ } },
	clipboard: { async writeText(t: string) { store.clipboard = t; } },
};

export default joplin;
