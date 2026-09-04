/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/a11y.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: A11Y JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    if (typeof MutationObserver === 'undefined') return;
    function label(el) {
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.alt != null) return;
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'button') el.setAttribute('aria-label', (el.textContent || el.innerText || 'Button').trim());
        else if (tag === 'input' && el.placeholder) el.setAttribute('aria-label', el.placeholder);
        else if (tag === 'img') el.setAttribute('alt', '');
    }
    function scan(node) {
        if (node && node.querySelectorAll) {
            node.querySelectorAll('button:not([aria-label]):not([aria-labelledby]), input:not([aria-label]):not([aria-labelledby]):not([placeholder=""]), img:not([alt])').forEach(label);
        }
    }
    var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            Array.prototype.forEach.call(m.addedNodes, function (n) { scan(n); });
        });
    });
    document.addEventListener('DOMContentLoaded', function () {
        scan(document.body);
        obs.observe(document.body, { childList: true, subtree: true });
    });
})();

// 919-keyboard-shortcuts-for-firewall-rules: shared keyboard shortcut utility.
// Registers a document keydown listener for each { key, action } mapping and
// returns a cleanup function. Ignores shortcuts when the user is typing in an
// input, textarea, or contenteditable element.
window.useKeyboardShortcut = function (shortcuts) {
    function handler(e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        for (var i = 0; i < shortcuts.length; i++) {
            if (e.key === shortcuts[i].key || (shortcuts[i].key === '?' && e.shiftKey && e.key === '/')) {
                e.preventDefault();
                shortcuts[i].action(e);
                break;
            }
        }
    }
    document.addEventListener('keydown', handler);
    return function () { document.removeEventListener('keydown', handler); };
};
