// Integration-test API double: persistent notes, real command dispatch and
// injected sync races. Deliberately rejects desktop-only APIs on mobile.
type Row = Record<string, any>;
export const lifecycle = { onStart: async () => {} };
export const store = {
	platform: 'mobile', notes: [] as Row[], folders: [] as Row[], settings: {} as Row,
	commands: {} as Record<string, () => Promise<void>>, messages: [] as string[],
	panels: {} as Record<string, { html: string; handler?: (m: any) => Promise<void> }>,
	states: [] as Row[], opened: [] as string[], menus: 0, toolbars: 0, dialogs: 0,
	posts: 0, puts: 0, clipboard: '', syncStart: () => {}, syncComplete: (_e: any) => {}, noteChange: () => {},
	beforeGet: null as null | ((path: string[], query: Row) => Promise<void>),
	beforePost: null as null | (() => Promise<void>),
	selectedFolderId: '', calls: [] as { path: string[]; query: Row }[],
};

export function reset(platform: string): void {
	Object.assign(store, {
		platform, notes: [], folders: [{ id: 'book', title: 'Notebook', parent_id: '' }],
		settings: { 'recall.runOnStartup': true }, commands: {}, messages: [], panels: {},
		states: [], opened: [], menus: 0, toolbars: 0, dialogs: 0, posts: 0, puts: 0,
		clipboard: '', beforeGet: null, beforePost: null, selectedFolderId: '', calls: [],
	});
}

function fields(row: Row, requested?: string[]): Row {
	return requested ? Object.fromEntries(requested.map((k) => [k, row[k]])) : { ...row };
}
function paged(rows: Row[], query: Row): Row {
	if (query.order_by) rows = rows.slice().sort((a, b) => String(a[query.order_by]).localeCompare(String(b[query.order_by])));
	const limit = query.limit || 100, start = ((query.page || 1) - 1) * limit;
	return { items: rows.slice(start, start + limit).map((r) => fields(r, query.fields)), has_more: start + limit < rows.length };
}
function desktopOnly(): void {
	if (store.platform === 'mobile') throw new Error('Desktop-only API called on mobile');
}

const api = {
	versionInfo: async () => ({ platform: store.platform }),
	plugins: { register(plugin: { onStart: () => Promise<void> }) { lifecycle.onStart = plugin.onStart; } },
	settings: {
		async registerSection(_id: string, _s: Row) {},
		async registerSettings(settings: Row) {
			for (const [k, s] of Object.entries(settings)) if (!(k in store.settings)) store.settings[k] = s.value;
		},
		async value(k: string) { return store.settings[k]; },
		async setValue(k: string, v: unknown) { store.settings[k] = v; },
	},
	workspace: {
		async onSyncStart(cb: () => void) { store.syncStart = cb; },
		async onSyncComplete(cb: (e: any) => void) { store.syncComplete = cb; },
		async onNoteChange(cb: () => void) { store.noteChange = cb; },
		async selectedFolder() { return store.folders.find((f) => f.id === store.selectedFolderId) || null; },
	},
	commands: {
		async register(command: Row) { store.commands[command.name] = command.execute; },
		async execute(name: string, ...args: any[]) {
			if (name === 'openNote') { store.opened.push(args[0]); return; }
			if (name === 'dismissPluginPanels') return;
			if (!store.commands[name]) throw new Error(`Unknown command ${name}`);
			await store.commands[name]();
		},
	},
	data: {
		async get(path: string[], query: Row = {}): Promise<any> {
			store.calls.push({ path, query });
			if (store.beforeGet) await store.beforeGet(path, query);
			// Simulate a lagging full-text index after creation.
			if (path[0] === 'search') return { items: [], has_more: false };
			const rows = path[0] === 'folders' ? store.folders : store.notes;
			if (path.length === 1) return paged(rows, query);
			const row = rows.find((r) => r.id === path[1]);
			if (!row) throw new Error('Not found');
			return fields(row, query.fields);
		},
		async post(_p: string[], _q: null, body: Row) {
			if (store.beforePost) await store.beforePost();
			store.posts++;
			const note = { id: `generated-${store.posts}`, created_time: Date.now(), updated_time: Date.now(), ...body };
			store.notes.push(note); return note;
		},
		async put(path: string[], _q: null, body: Row) {
			store.puts++;
			Object.assign(store.notes.find((n) => n.id === path[1])!, body);
		},
	},
	views: {
		menus: { async create(..._args: any[]) { desktopOnly(); store.menus++; } },
		toolbarButtons: { async create(..._args: any[]) { desktopOnly(); store.toolbars++; } },
		dialogs: {
			async create(id: string) { desktopOnly(); store.dialogs++; return id; },
			async addScript(..._args: any[]) {}, async setFitToContent(..._args: any[]) {},
			async setButtons(..._args: any[]) {}, async setHtml(..._args: any[]) {},
			async open(..._args: any[]): Promise<any> { return null; },
			async showToast(..._args: any[]) {},
			async showMessageBox(message: string) { store.messages.push(message); return 0; },
		},
		panels: {
			async create(id: string) { store.panels[id] = { html: '' }; return id; },
			async setHtml(id: string, html: string) { store.panels[id].html = html; },
			async addScript(..._args: any[]) {}, async show(..._args: any[]) {},
			async onMessage(id: string, cb: (m: any) => Promise<void>) { store.panels[id].handler = cb; },
			postMessage(_id: string, message: Row) { store.states.push(message); },
		},
	},
	clipboard: { async writeText(text: string) { store.clipboard = text; } },
};
export default api;
