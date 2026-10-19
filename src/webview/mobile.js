/* global webviewApi */
// This file lives under webview/ so it cannot shadow mobileView.ts in webpack.
(function () {
	let waiting = false;
	function setBusy(value) {
		document.querySelectorAll('button[data-action]').forEach(function (button) {
			button.disabled = value;
		});
		document.querySelector('main').setAttribute('aria-busy', String(value));
	}
	function init() {
		document.body.classList.add('recall-mobile');
		webviewApi.onMessage(function (event) {
			const state = event.message;
			if (!state || state.type !== 'state') return;
			document.querySelector('[role="status"]').textContent = state.status;
			const root = document.getElementById('statistics');
			if (root.innerHTML !== state.html) {
				// HTML comes from Recall's renderer, which escapes all note titles.
				root.innerHTML = state.html;
				const heat = root.querySelector('.heat');
				if (heat) heat.scrollLeft = heat.scrollWidth;
			}
			document.querySelector('.stats-actions').hidden = !state.html;
			setBusy(waiting || state.busy);
		});
		document.addEventListener('click', async function (event) {
			const button = event.target.closest('button[data-action]');
			if (!button || button.disabled || waiting) return;
			waiting = true;
			setBusy(true);
			try {
				await webviewApi.postMessage({ action: button.dataset.action });
			} catch (err) {
				document.querySelector('[role="status"]').textContent = 'Recall could not complete this action. Please try again.';
			} finally {
				waiting = false;
				setBusy(false);
				// Also restores state after a closed/reopened plugin-panel WebView.
				await webviewApi.postMessage({ action: 'ready' });
			}
		});
		void webviewApi.postMessage({ action: 'ready' });
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
})();
