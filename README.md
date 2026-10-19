# Recall — a Joplin plugin

Rediscover your own notes, and see how much you've actually written.

- **Open a random note** — one click (or toolbar button) jumps you to a random
  note. Great for serendipitous review.
- **On This Day** — surfaces notes you created on *this calendar day in previous
  years*, the way photo apps show "memories". Joplin has no built-in equivalent.
- **Daily Recall digest** — generates a single note combining *On This Day* plus
  a handful of random notes, with clickable links. Optionally built automatically
  on startup on desktop.
- **Writing statistics** — the word count of your whole library: totals, a
  12-month heatmap, and breakdowns by year and by notebook.

## Writing statistics

![The writing statistics dialog](docs/writing-stats.png)

<sub>Screenshot generated from a synthetic library (`node tools/demoData.js`), not
from anyone's real notes.</sub>

Every other Joplin word-count plugin counts the *current* note, and all of them
tokenise with `/\b\w+\b/`, where `\w` is ASCII-only. A 500-character Chinese
note reports **0 words**. Recall counts the whole library, and counts CJK
correctly:

| Text | `/\b\w+\b/` | Recall |
| --- | ---: | ---: |
| `今天下午去看了房子，中介说学区还不错。` | 0 | 17 |
| `读完这本书花了三天，里面讲的 survivorship bias 很有意思。` | 2 | 19 |
| `これはテストです` | 0 | 8 |
| `Today I went to see the apartment.` | 7 | 7 |

**How it counts.** Han characters, hiragana and katakana count per character —
the convention in Chinese and Japanese publishing. Every other script,
including Hangul and Cyrillic, counts per word. Before counting, markdown
syntax, URLs, attachment links, HTML tags and inline code are stripped, and
fenced code blocks are excluded entirely and reported separately. Full-width
punctuation is reported on its own line rather than folded into the total.
Recall's own generated notes are never counted.

**Performance.** Counts are cached per note and only recomputed when a note's
`updated_time` changes. On a 3,400-note library the first run reads every body
in ~70 paged API calls; later runs re-read nothing and only refresh the
metadata. The cache lives in a plugin setting (~220 KB at that size) and can be
rebuilt from the panel.

**Where it lives.** On desktop, open **Tools → Recall → Writing statistics**
for an occasional-use dialog. On Android, open **plugin panels → Recall** and
choose **Writing statistics**. Both let you copy the figures as Markdown or
rebuild the cache.

## Usage

Install Recall from Joplin’s plugin directory, or download the `.jpl` from
[GitHub Releases](https://github.com/smieltalker/joplin-plugin-recall/releases/latest)
and use **Settings → Plugins → Advanced → Install from file**. Fully restart
Joplin after installing or upgrading so all settings appear.

**Desktop (Joplin 3.0+):** a **die icon** in the note toolbar opens a random
note; **Tools → Recall** contains every action.

**Android (Joplin 3.4+):** finish syncing, then open **plugin panels → Recall**.
The panel provides Random note, On This Day, Daily Recall and Writing statistics.
Automatic startup generation is disabled on mobile; generate reviews manually
after syncing. Physical-device feedback covers Joplin 3.7.8 on Android 16 and 17;
the declared minimum version has not been tested on a device. iOS has not been
validated, and Joplin restricts iOS installation to recommended plugins.

## Settings

Settings → Recall:

| Setting | Default | What it does |
| --- | --- | --- |
| Random notes in Daily Recall | 3 | How many random notes the digest includes |
| Exclude completed to-dos | on | Skip finished to-dos when picking notes |
| Source notebook IDs | _(empty)_ | Comma-separated notebook IDs to review; empty = all notebooks |
| Include sub-notebooks | off | Include all descendants of the selected source notebooks |
| Target notebook ID | _(empty)_ | Where generated notes are stored; empty = default |
| Generate Daily Recall on startup | off | Auto-build the digest when Joplin starts (desktop only) |

The "On This Day" and "Daily Recall" notes are **upserted per day** —
re-running updates the same note instead of creating duplicates.

## Building from source

```bash
npm install
npm test            # counting assertions, including the CJK cases above
npm run dist        # produces publish/com.github.smieltalker.recall.jpl
```

Install the resulting `.jpl` via Joplin → Settings → Plugins → gear icon →
*Install from file*.

### Checking the counter against your own library

`tools/` holds two harnesses that run the real code against a real library with
the plugin API stubbed out (`tools/apiStub.ts`), so you can check both the
numbers and the layout without launching Joplin:

```bash
npm run harness

# numbers: totals, per-year and per-notebook breakdowns, cache behaviour
<dump> | node .harness-build/tools/statsHarness.js

# layout: renders the dialog to a standalone HTML file
# (a 5th argument of "light" or "dark" picks one theme; omit it for both)
<dump> | node .harness-build/tools/previewHarness.js out.html \
          src/webview/stats.css src/webview/stats.js
```

`<dump>` can be `node tools/demoData.js`, which emits a deterministic synthetic
library — that is how the screenshot above is produced, so no real notes are
involved:

```bash
node tools/demoData.js | node .harness-build/tools/previewHarness.js \
  docs/preview.html src/webview/stats.css src/webview/stats.js dark
```

To check it against your own library instead, pipe NDJSON on stdin out of a
read-only query against `database.sqlite` — one
`{"t":"n","v":{...note fields...}}` line per note and one
`{"t":"f","v":{...folder fields...}}` per notebook. Piping rather than dumping
to a file keeps your notes off disk.

## License

MIT

## Mobile behaviour

The mobile statistics page reports scan progress. **Copy Markdown** copies the
figures; **Recount** clears the count cache and scans again. The first scan reads
all local note bodies, so a large library can take longer on a phone. Counts
reflect notes currently available on that device, not notes still waiting to sync.

**Generation and sync.** Automatic startup generation is disabled on mobile,
even if the desktop startup setting is on. Generate manually after syncing.
A sync that starts while Recall is running prevents a subsequent mobile summary
write, and repeated taps on one device cannot create overlapping summaries.
This is not a cross-device lock: independently generating on two offline devices
can still produce duplicate daily summaries after sync. Recall updates existing
daily summaries by exact title. With no target notebook ID, a new mobile summary
uses the current notebook, or the first available notebook if none is selected.

**Testing:** `npm test` checks counting rules; `npm run test:plugin` checks mobile
and desktop registration, generation, sync races, repeated taps, statistics,
cache reuse, errors, and retry behaviour using an in-memory API double.
These tests do not simulate Android's native WebView or prove device performance.
The offline preview and statistics harnesses remain available with `npm run harness`.

Date-based features now use Joplin's visible Created date (`user_created_time`),
falling back to internal `created_time` when unavailable. Imported or manually
backdated notes are therefore reviewed and grouped under their original dates.
This can change historical year/month/day breakdowns from version 1.0.1, without
changing the whole-library word total or modifying the source notes.


## Notebook sources

In **Settings → Recall**, set **Source notebook IDs (optional)** to one or more
notebook IDs separated by commas. On desktop, right-click a notebook and choose
**Copy notebook ID**. IDs identify the same synced notebook across devices;
configure Recall's source settings on each device where you use it.

- Leave source IDs empty to review the whole library (the existing default).
- Turn on **Include sub-notebooks** to include all descendant levels; default is off.
- These settings apply to Random note, On This Day, and both sections of Daily Recall.
- **Writing statistics always cover the whole library.**
- **Target notebook ID** still controls where newly generated summaries are saved.
  Existing summaries are updated in place, including when saved outside the source scope.
- Settings and notebook moves take effect on the next action without restarting.
- Malformed or unknown source IDs show an error; a source with no eligible notes
  shows a message. Neither falls back to all notebooks or overwrites a daily note
  with an empty-scope result. Sync first if a selected notebook is not yet available.
- Whitespace, duplicate IDs, uppercase hex IDs, and a trailing comma are accepted.

## Validation

Version 1.1.1 passes 30 counting assertions and 57 plugin integration scenarios.
The final beta was installed and exercised in Joplin’s mobile web app, including
an upgrade from 1.1.0, notebook scopes and whole-library statistics. A community
tester [reported success](https://github.com/smieltalker/joplin-plugin-recall/issues/2#issuecomment-6269921708)
on Android 16 and 17 with Joplin 3.7.8, and on Ubuntu 26.04 with Joplin 3.7.21.
That report does not enumerate every native interaction or filter edge case.
Real multi-device sync and iOS behaviour have not been verified.
