// Self-contained assertions for the counting rules. Run with `npm test`.
//
// The CJK cases are the reason this plugin exists: the tokeniser used by the
// other Joplin word-count plugins, /\b\w+\b/, returns 0 for all of them.

import { countBody, stripMarkdown, countText } from '../src/wordcount';

let failures = 0;

function eq(label: string, actual: unknown, expected: unknown) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// The algorithm every other plugin uses, for comparison.
const asciiWordCount = (s: string) => (s.trim().match(/\b\w+\b/g) || []).length;

console.log('\nCJK — where the ASCII tokeniser fails\n');

const zh = '今天下午去看了房子，中介说学区还不错，但是价格超预算了。';
eq('Chinese: 25 Han characters', countBody(zh).cjk, 25);
eq('Chinese: words == Han count', countBody(zh).words, 25);
eq('Chinese: full-width punctuation counted apart', countBody(zh).cjkPunct, 3);
eq('  (the /\\b\\w+\\b/ tokeniser would report)', asciiWordCount(zh), 0);

const mixed = '读完这本书花了三天，里面讲的 survivorship bias 很有意思。';
eq('Mixed: Han characters', countBody(mixed).cjk, 17);
eq('Mixed: Latin words', countBody(mixed).latin, 2);
eq('Mixed: total', countBody(mixed).words, 19);

eq('Japanese kana counted per character', countBody('これはテストです').cjk, 8);
eq('Korean tokenises as words, not characters', countBody('오늘은 좋은 날이다').latin, 3);
eq('Korean is not counted as CJK characters', countBody('오늘은 좋은 날이다').cjk, 0);
eq('Cyrillic tokenises as words', countBody('Привет мир').latin, 2);

console.log('\nEnglish — must still match the conventional count\n');

const en = 'Today I went to see the apartment and the agent said it was fine.';
eq('English: 14 words', countBody(en).words, 14);
eq('  (matches the ASCII tokeniser)', asciiWordCount(en), 14);
eq("Contractions stay one word", countBody("don't stop believing").words, 3);
eq('Hyphenated stays one word', countBody('state-of-the-art design').words, 2);

console.log('\nMarkdown and Joplin syntax must not inflate the count\n');

eq('Headings drop the #', countBody('# Title\n\nBody text here').words, 4);
eq('Attachment links vanish entirely', countBody('![](:/0123456789abcdef0123456789abcdef)').words, 0);
eq('Link text is kept, URL is dropped', countBody('see [the docs](https://example.com/a/b) now').words, 4);
eq('Bare URLs are dropped', countBody('read https://example.com/very/long/path today').words, 2);
eq('Inline code is dropped', countBody('run `npm install --save` first').words, 2);
eq('Bullet markers are dropped', countBody('- one\n- two\n- three').words, 3);
eq('Emphasis markers are dropped', countBody('**bold** and _italic_ text').words, 4);
eq('HTML tags are dropped', countBody('<div class="x">hello</div> world').words, 2);

const fenced = 'Before\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\nAfter';
eq('Fenced code excluded from words', countBody(fenced).words, 2);
eq('Fenced code reported separately', countBody(fenced).code > 0, true);

eq('Table separator rows are dropped', countBody('| a | b |\n|---|---|\n| c | d |').words, 4);
eq('Empty body is zero, not NaN', countBody('').words, 0);
eq('Null-ish body is safe', countBody(undefined as unknown as string).words, 0);

console.log('\nStripping keeps prose intact\n');
eq('Prose survives stripping', stripMarkdown('# 标题\n\n正文内容').text, '标题 正文内容');
eq('countText is usable on its own', countText('hello 世界').words, 3);

console.log(failures ? `\n${failures} assertion(s) failed\n` : '\nAll assertions passed\n');
process.exit(failures ? 1 : 0);
