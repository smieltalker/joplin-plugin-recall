// Renders the statistics panel to a standalone HTML file so the layout can be
// checked in a browser without launching Joplin. Test-only.
import joplinStub, { store } from './apiStub';
import { computeStats } from '../src/stats';
import { render } from '../src/statsView';
import * as fs from 'fs';

const read = (): Promise<void> => new Promise((resolve) => {
	let buf = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (d) => {
		buf += d;
		const lines = buf.split('\n');
		buf = lines.pop() as string;
		for (const l of lines) {
			if (!l) continue;
			const o = JSON.parse(l);
			if (o.t === 'n') store.notes.push(o.v);
			else if (o.t === 'f') store.folders.push(o.v);
		}
	});
	process.stdin.on('end', () => resolve());
});

// Approximate Joplin's own light and dark themes so both can be eyeballed.
const THEMES: Record<string, string> = {
	light: `--joplin-background-color:#fff;--joplin-color:#32373f;--joplin-divider-color:#dddddd;
	        --joplin-url-color:#155BDA;--joplin-background-color-hover3:#eeeeee;--joplin-font-size:14px;`,
	dark: `--joplin-background-color:#1d2024;--joplin-color:#dddddd;--joplin-divider-color:#3a4047;
	       --joplin-url-color:#5e87e0;--joplin-background-color-hover3:#2b3036;--joplin-font-size:14px;`,
};

(async () => {
	await read();
	const stats = await computeStats();
	const css = fs.readFileSync(process.argv[3], 'utf8'); // path passed in; __dirname points at the build output
	const js = fs.readFileSync(process.argv[4], 'utf8');
	const body = render(stats);
	// 5th arg picks a single theme; omit it for both, stacked.
	const only = process.argv[5];
	const themes = only ? { [only]: THEMES[only] } : THEMES;
	const out = `<!doctype html><meta charset="utf-8"><title>Recall panel preview</title>
<style>
/* Stacked full-width, because the real thing is a 90vw x 80vh dialog. */
body{margin:0;font-family:sans-serif}
.pane{padding:20px 24px;box-sizing:border-box}
.pane.light{background:#fff}
.pane.dark{background:#1d2024}
${css}
</style>
${Object.keys(themes).map((k) => `<div class="pane ${k}" style="${themes[k]}">${body}</div>`).join('')}
<script>window.webviewApi={postMessage:(m)=>console.log('postMessage',m)};</script>
<script>${js}</script>`;
	const dest = process.argv[2];
	fs.writeFileSync(dest, out);
	console.log(`已写出 ${dest}（${Math.round(out.length / 1024)} KB），左浅色右深色`);
})();
