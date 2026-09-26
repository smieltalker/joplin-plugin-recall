// Emits a synthetic Joplin library in the NDJSON shape the harnesses read, so
// screenshots and layout checks never contain anyone's real notes.
//
//   node tools/demoData.js | node .harness-build/tools/previewHarness.js \
//     out.html src/webview/stats.css src/webview/stats.js dark
//
// Deterministic: same seed every run, so the screenshot is reproducible.

let seed = 20260926;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
// Pareto-ish length: mostly short entries, a thin tail of long ones. A bounded
// curve would pile every top-10 note onto the cap and the "longest notes" list
// would read as ten identical numbers.
const tailed = (scale, cap) => Math.min(cap, Math.ceil(Math.pow(1 - rnd(), -0.8) * scale));

const id = (() => { let i = 0; return () => (++i).toString(16).padStart(32, '0'); })();

const TREE = {
	Journal: ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
	Writing: ['Essays', 'Fiction', 'Drafts'],
	Notes: ['Reading', 'Film', 'Ideas'],
	Inbox: [],
};

const folders = [];
const byYear = {};
const misc = [];
for (const [parentName, children] of Object.entries(TREE)) {
	const parent = { id: id(), title: parentName, parent_id: '' };
	folders.push(parent);
	if (!children.length) { misc.push(parent); continue; }
	for (const c of children) {
		const child = { id: id(), title: c, parent_id: parent.id };
		folders.push(child);
		if (parentName === 'Journal') byYear[c] = child; else misc.push(child);
	}
}

const ZH = '今天的风把窗帘吹起来像一面旗子街角那家店换了招牌咖啡还是原来的味道回家路上想起很多年前的一个下午我们在旧书店翻到同一本书笑了很久雨停之后空气里有泥土的气息她说想去看海于是我们真的去了浪很大冷得发抖却一直没舍得走这些年好像什么都没变又好像什么都变了';
const EN = 'the quiet morning light across the kitchen table a slow week of reading and not much else I keep coming back to the same paragraph and cannot say why it holds me ';
const ESSAY_ZH = ['雨停之后', '旧书店的下午', '一个普通的周三', '关于时间的笔记', '海边，第二次', '换季', '深夜的厨房', '不擅长告别', '散步的理由', '窗外那棵树', '重读旧信', '两种安静'];
const ESSAY_EN = ['On rereading', 'Notes from a slow week', 'The kitchen table', 'Sea, again', 'What I keep', 'Small hours', 'A short defence of walking'];

const rows = folders.map((f) => ({ t: 'f', v: f }));

const START = new Date(2018, 0, 1).getTime();
const END = new Date(2026, 8, 20).getTime();
let n = 0;
for (let day = START; day <= END; day += 86400000) {
	const d = new Date(day);
	const year = d.getFullYear();
	// Writes more as the years go on, with real gaps and the odd burst.
	const chance = 0.10 + (year - 2018) * 0.030;
	if (rnd() > chance) continue;
	const burst = rnd() < 0.10 ? between(2, 3) : 1;

	for (let k = 0; k < burst; k++) {
		const journal = rnd() < 0.62 && byYear[String(year)];
		const folder = journal ? byYear[String(year)] : pick(misc);
		const zh = rnd() < 0.8;
		const reps = tailed(zh ? 1.1 : 1.5, zh ? 220 : 280);
		const stamp = `${year}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

		const title = journal
			? (rnd() < 0.55 ? stamp : `${stamp} ${pick(ESSAY_ZH)}`)
			: (zh ? pick(ESSAY_ZH) : pick(ESSAY_EN));

		const body = zh
			? `${ZH.slice(0, between(20, 60))}。\n\n${ZH.repeat(reps)}。\n`
			: `${EN.repeat(reps)}.\n`;

		const created = day + between(0, 86399999);
		rows.push({ t: 'n', v: {
			id: id(),
			parent_id: folder.id,
			title,
			body,
			created_time: created,
			updated_time: created + between(0, 86400000),
		} });
		n++;
	}
}

for (const row of rows) process.stdout.write(JSON.stringify(row) + '\n');
process.stderr.write(`demo library: ${n} notes, ${folders.length} notebooks\n`);
