// Runs computeStats() over a real library piped in as NDJSON, to check the
// aggregation end to end. Usage: <dump> | node statsHarness.js
import joplinStub, { store } from './apiStub';
import { computeStats } from '../src/stats';

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

const n = (x: number) => x.toLocaleString();

(async () => {
	await read();
	console.log(`  载入 ${n(store.notes.length)} 条笔记 / ${n(store.folders.length)} 个笔记本\n`);

	let t0 = Date.now();
	store.calls = 0;
	const cold = await computeStats();
	const coldMs = Date.now() - t0;
	const coldCalls = store.calls;

	t0 = Date.now();
	store.calls = 0;
	const warm = await computeStats();
	const warmMs = Date.now() - t0;

	console.log(`  冷启动  ${n(cold.total.words)} 字   重新读取 ${n(cold.rescanned)} 条正文   ${coldCalls} 次 API   ${coldMs}ms`);
	console.log(`  热缓存  ${n(warm.total.words)} 字   重新读取 ${n(warm.rescanned)} 条正文   ${store.calls} 次 API   ${warmMs}ms`);
	console.log(`  缓存体积 ${n(Math.round((store.settings['recall.statsCache'] || '').length / 1024))} KB\n`);

	console.log(`  笔记 ${n(cold.noteCount)}（有正文 ${n(cold.withBody)}）`);
	console.log(`  构成: 汉字 ${n(cold.total.cjk)} + 其他语言词 ${n(cold.total.latin)}；剥离代码 ${n(cold.total.code)} 字符`);
	console.log(`  今年 ${n(cold.thisYear)} / 本月 ${n(cold.thisMonth)} / 本周 ${n(cold.thisWeek)} / 今天 ${n(cold.today)}\n`);

	console.log('  按年:');
	for (const y of cold.byYear) console.log(`    ${y.key}  ${String(n(y.words)).padStart(9)} 字  ${String(y.notes).padStart(4)} 条`);
	console.log('\n  笔记本 Top 8:');
	for (const b of cold.byNotebook.slice(0, 8)) console.log(`    ${String(n(b.words)).padStart(9)} 字 ${String(b.notes).padStart(4)} 条  ${b.key}`);
	console.log('\n  最长 3 篇:');
	for (const l of cold.longest.slice(0, 3)) console.log(`    ${String(n(l.words)).padStart(7)} 字  ${l.title}`);

	const days = Object.keys(cold.byDay).length;
	console.log(`\n  热力图: ${n(days)} 个有写作的日子`);

	const yearSum = cold.byYear.reduce((a, b) => a + b.words, 0);
	const bookSum = cold.byNotebook.reduce((a, b) => a + b.words, 0);
	const daySum = Object.keys(cold.byDay).reduce((a, k) => a + cold.byDay[k], 0);
	console.log(`\n  一致性校验（三个维度必须都等于总数 ${n(cold.total.words)}）:`);
	console.log(`    按年合计     ${n(yearSum)}  ${yearSum === cold.total.words ? 'OK' : '不一致'}`);
	console.log(`    按笔记本合计 ${n(bookSum)}  ${bookSum === cold.total.words ? 'OK' : '不一致'}`);
	console.log(`    按天合计     ${n(daySum)}  ${daySum === cold.total.words ? 'OK' : '不一致'}`);
	console.log(`    冷热一致     ${cold.total.words === warm.total.words ? 'OK' : '不一致'}`);
})();
