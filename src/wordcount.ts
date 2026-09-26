// Word counting that actually works for CJK.
//
// Every other Joplin word-count plugin tokenises with /\b\w+\b/, where \w is
// ASCII-only: a 500-character Chinese note reports 0 words. Here, Han and kana
// are counted per character (the convention in Chinese and Japanese
// publishing) and everything else — Latin, Cyrillic, Hangul — per
// whitespace-delimited word. Markdown syntax, URLs, attachment links and code
// blocks are stripped first so they don't inflate the total.

export interface Counts {
	words: number;    // headline figure: cjk + latin
	cjk: number;      // Han / Hiragana / Katakana characters
	cjkPunct: number; // full-width punctuation, reported separately
	latin: number;    // word-like tokens in every other script
	numbers: number;  // standalone numeric runs, informational only
	code: number;     // characters inside fenced code blocks, excluded from words
}

export const emptyCounts = (): Counts =>
	({ words: 0, cjk: 0, cjkPunct: 0, latin: 0, numbers: 0, code: 0 });

export function addCounts(a: Counts, b: Counts): Counts {
	return {
		words: a.words + b.words,
		cjk: a.cjk + b.cjk,
		cjkPunct: a.cjkPunct + b.cjkPunct,
		latin: a.latin + b.latin,
		numbers: a.numbers + b.numbers,
		code: a.code + b.code,
	};
}

// --- stripping -----------------------------------------------------------
// Order matters: fences first (so markdown inside them is never seen), then
// anything carrying a URL, then the residual syntax characters.

const RE_FENCE = /(?:^|\n)[ \t]*(```|~~~)[\s\S]*?(?:\n[ \t]*\1[^\n]*|$)/g;
const RE_B64 = /data:[^;]+;base64,[A-Za-z0-9+/=]+/g;
const RE_RESOURCE = /!?\[[^\]]*\]\(:\/[0-9a-f]{32}\)/g; // Joplin attachment / image
const RE_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const RE_HTML = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]{1,400}>/g;
const RE_LINK = /\[([^\]]*)\]\([^)]*\)/g; // keep the link text, drop the target
const RE_URL = /https?:\/\/\S+|www\.\S+/g;
const RE_INLINE_CODE = /`[^`\n]{1,200}`/g;
const RE_TABLE_RULE = /^[\s|:\-+]+$/gm;
const RE_MD_SYMBOL = /[#>*_~`|\\]|^[ \t]*[-+](?=\s)/gm;
const RE_WS = /\s+/g;

export interface Stripped {
	text: string;
	codeChars: number;
}

export function stripMarkdown(body: string): Stripped {
	if (!body) return { text: '', codeChars: 0 };

	let codeChars = 0;
	const withoutFences = body.replace(RE_FENCE, (block) => {
		codeChars += block.replace(RE_WS, '').length;
		return '\n';
	});

	const text = withoutFences
		.replace(RE_B64, ' ')
		.replace(RE_RESOURCE, ' ')
		.replace(RE_IMAGE, ' ')
		.replace(RE_HTML, ' ')
		.replace(RE_LINK, '$1')
		.replace(RE_URL, ' ')
		.replace(RE_INLINE_CODE, ' ')
		.replace(RE_TABLE_RULE, '')
		.replace(RE_MD_SYMBOL, ' ')
		.replace(RE_WS, ' ')
		.trim();

	return { text, codeChars };
}

// --- counting ------------------------------------------------------------
// Built with `new RegExp` so the Unicode property escapes survive regardless of
// the `target` a contributor's tsconfig happens to be set to.

const RE_CJK = new RegExp('[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3005\\u3006\\u30fc]', 'gu');
const RE_CJK_PUNCT = new RegExp('[\\u3000-\\u303f\\uff01-\\uff65\\u2018\\u2019\\u201c\\u201d\\u2026\\u2014]', 'gu');
// Word-like token in any remaining script. Must open with a letter, so bare
// numbers are reported on their own rather than padding the word count.
const RE_WORD = new RegExp("[\\p{L}][\\p{L}\\p{M}\\p{N}'’\\-]*", 'gu');
const RE_NUMBER = /\d+(?:[.,]\d+)*/g;

const tally = (s: string, re: RegExp): number => {
	const m = s.match(re);
	return m ? m.length : 0;
};

export function countText(text: string, codeChars = 0): Counts {
	const cjk = tally(text, RE_CJK);
	const cjkPunct = tally(text, RE_CJK_PUNCT);
	// Remove the per-character scripts before looking for words, so nothing is
	// counted twice and Hangul still tokenises normally.
	const rest = text.replace(RE_CJK, ' ');
	const latin = tally(rest, RE_WORD);
	const numbers = tally(rest, RE_NUMBER);
	return { words: cjk + latin, cjk, cjkPunct, latin, numbers, code: codeChars };
}

/** Count one note body, markdown and all. */
export function countBody(body: string): Counts {
	const { text, codeChars } = stripMarkdown(body);
	return countText(text, codeChars);
}
