// Title prefixes for the notes this plugin generates. Shared so that both the
// random picker and the statistics pass can exclude Recall's own output —
// otherwise the digest notes would be counted as writing.
export const ON_THIS_DAY_PREFIX = '📅 On This Day';
export const DIGEST_PREFIX = '🗓 Daily Recall';

// Joplin's visible creation date can differ after import or manual date edits.
// Internal created_time is for the application's bookkeeping/sync.
export const createdAt = (note: { created_time: number; user_created_time?: number }): number =>
	note.user_created_time || note.created_time || 0;
