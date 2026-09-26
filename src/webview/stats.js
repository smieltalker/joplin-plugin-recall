// Webview side of the statistics dialog.
//
// Joplin dialogs have no message channel back to the plugin (unlike panels), so
// everything interactive is a dialog button. The only job left here is the
// heatmap: it can be wider than the dialog, and the recent end is the
// interesting one, so start it scrolled fully right.
let seenHeat = null;
function scrollHeatmapToToday() {
	const heat = document.querySelector('.heat');
	if (!heat || heat === seenHeat) return;
	seenHeat = heat;
	heat.scrollLeft = heat.scrollWidth;
}
scrollHeatmapToToday();
document.addEventListener('DOMContentLoaded', scrollHeatmapToToday);
new MutationObserver(scrollHeatmapToToday).observe(document.documentElement, { childList: true, subtree: true });
