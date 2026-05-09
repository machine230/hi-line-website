/* ─────────────────────────────────────────────────────────────────
   FlightBoard — Beta Feedback Widget
   Usage: call initFeedbackWidget(currentMember) after member loads.
   Requires: _supabase (from supabase-client.js)
   ───────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    let _member = null;
    let _panelOpen = false;
    let _selectedCategory = null;
    let _selectedRating = 0;

    const CATEGORIES = [
        { key: 'bug',       label: '🐛 Bug',         color: '#ff8090' },
        { key: 'confusing', label: '😕 Confusing',   color: '#F5B942' },
        { key: 'idea',      label: '💡 Idea',         color: '#4A9ECC' },
        { key: 'positive',  label: '✅ Works great',  color: '#5DDBA6' },
    ];

    function getPageName() {
        const p = window.location.pathname.split('/').pop().replace('.html', '') || 'home';
        const names = {
            dashboard: 'Dashboard', schedule: 'Schedule', squawks: 'Squawks',
            'post-flight': 'Post-Flight', weather: 'Weather', admin: 'Admin',
        };
        return names[p] || p;
    }

    function injectStyles() {
        if (document.getElementById('fb-widget-styles')) return;
        const style = document.createElement('style');
        style.id = 'fb-widget-styles';
        style.textContent = `
            /* ── Feedback FAB ── */
            #fb-fab {
                position: fixed;
                right: 20px;
                bottom: 24px;
                z-index: 1500;
                width: 48px; height: 48px;
                border-radius: 50%;
                background: var(--amber, #E8A030);
                border: none;
                cursor: pointer;
                font-size: 1.3em;
                line-height: 1;
                box-shadow: 0 4px 18px rgba(232,160,48,0.45);
                transition: transform 0.2s, box-shadow 0.2s;
                display: flex; align-items: center; justify-content: center;
            }
            #fb-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(232,160,48,0.55); }
            #fb-fab.open  { background: rgba(255,255,255,0.12); box-shadow: none; font-size: 1em; }

            @media (max-width: 680px) {
                #fb-fab {
                    bottom: calc(68px + env(safe-area-inset-bottom));
                    right: 14px;
                    width: 44px; height: 44px;
                }
            }

            /* ── Feedback Panel ── */
            #fb-panel {
                position: fixed;
                right: 20px;
                bottom: 84px;
                z-index: 1499;
                width: 300px;
                background: var(--surface, rgba(20,24,36,0.98));
                border: 1px solid var(--border, rgba(255,255,255,0.12));
                border-radius: 16px;
                padding: 20px;
                box-shadow: 0 16px 48px rgba(0,0,0,0.35);
                display: none;
                flex-direction: column;
                gap: 14px;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                animation: fb-slide-up 0.2s ease;
            }
            #fb-panel.open { display: flex; }

            @media (max-width: 680px) {
                #fb-panel {
                    right: 10px;
                    left: 10px;
                    width: auto;
                    bottom: calc(120px + env(safe-area-inset-bottom));
                }
            }

            @keyframes fb-slide-up {
                from { opacity: 0; transform: translateY(12px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            /* ── Panel internals ── */
            .fb-header {
                display: flex; align-items: center;
                justify-content: space-between;
            }
            .fb-title {
                font-family: 'Montserrat', sans-serif;
                font-weight: 900; font-size: 0.9em;
                color: var(--text, rgba(255,255,255,0.93));
                letter-spacing: 0.5px;
            }
            .fb-page-tag {
                font-size: 0.7em;
                color: var(--text-muted, rgba(255,255,255,0.45));
                font-weight: 600;
            }
            .fb-close {
                background: none; border: none; cursor: pointer;
                color: var(--text-muted, rgba(255,255,255,0.45));
                font-size: 1.1em; line-height: 1; padding: 2px 4px;
                transition: color 0.15s;
            }
            .fb-close:hover { color: var(--text, rgba(255,255,255,0.93)); }

            /* Category chips */
            .fb-cats {
                display: flex; flex-wrap: wrap; gap: 6px;
            }
            .fb-cat {
                font-size: 0.75em; font-weight: 700;
                padding: 5px 10px; border-radius: 20px; cursor: pointer;
                border: 1px solid var(--border, rgba(255,255,255,0.12));
                background: transparent;
                color: var(--text-dim, rgba(255,255,255,0.65));
                transition: all 0.15s; white-space: nowrap;
                font-family: inherit;
            }
            .fb-cat.selected {
                border-color: var(--amber, #E8A030);
                background: rgba(232,160,48,0.15);
                color: var(--amber, #E8A030);
            }

            /* Textarea */
            #fb-msg {
                width: 100%; box-sizing: border-box;
                background: var(--input-bg, rgba(255,255,255,0.07));
                border: 1px solid var(--input-border, rgba(255,255,255,0.18));
                border-radius: 10px;
                padding: 10px 12px;
                color: var(--text, rgba(255,255,255,0.93));
                font-family: 'Open Sans', sans-serif;
                font-size: 0.88em; line-height: 1.5;
                resize: vertical; min-height: 72px; max-height: 160px;
                outline: none;
                transition: border-color 0.2s;
            }
            #fb-msg:focus { border-color: var(--sky, #4A9ECC); }
            #fb-msg::placeholder { color: var(--placeholder, rgba(255,255,255,0.35)); }

            /* Star rating */
            .fb-stars {
                display: flex; gap: 4px; align-items: center;
            }
            .fb-star-label {
                font-size: 0.72em;
                color: var(--text-muted, rgba(255,255,255,0.45));
                margin-right: 4px;
            }
            .fb-star {
                font-size: 1.2em; cursor: pointer;
                opacity: 0.35; transition: opacity 0.1s, transform 0.1s;
                line-height: 1; background: none; border: none; padding: 2px;
            }
            .fb-star.lit  { opacity: 1; }
            .fb-star:hover { transform: scale(1.2); }

            /* Submit button */
            #fb-submit {
                width: 100%; padding: 10px;
                border-radius: 10px; border: none;
                background: var(--amber, #E8A030);
                color: #fff;
                font-family: 'Montserrat', sans-serif;
                font-weight: 700; font-size: 0.88em;
                cursor: pointer; transition: background 0.2s, opacity 0.2s;
            }
            #fb-submit:hover   { background: #F0B84A; }
            #fb-submit:disabled { opacity: 0.55; cursor: not-allowed; }

            /* Error */
            #fb-err {
                font-size: 0.78em; color: #ff8090;
                display: none; text-align: center;
            }
            #fb-err.visible { display: block; }

            /* Success */
            #fb-thanks {
                text-align: center; padding: 8px 0;
                font-size: 0.95em;
                color: var(--text, rgba(255,255,255,0.93));
                display: none;
            }
            #fb-thanks.visible { display: block; }
        `;
        document.head.appendChild(style);
    }

    function buildWidget() {
        // FAB button
        const fab = document.createElement('button');
        fab.id = 'fb-fab';
        fab.title = 'Send feedback';
        fab.setAttribute('aria-label', 'Open feedback panel');
        fab.textContent = '💬';
        fab.onclick = togglePanel;

        // Panel
        const panel = document.createElement('div');
        panel.id = 'fb-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Beta feedback');
        panel.innerHTML = `
            <div class="fb-header">
                <div>
                    <div class="fb-title">Beta Feedback</div>
                    <div class="fb-page-tag">📍 ${getPageName()}</div>
                </div>
                <button class="fb-close" onclick="document.getElementById('fb-panel').classList.remove('open');document.getElementById('fb-fab').classList.remove('open');" aria-label="Close">✕</button>
            </div>

            <div class="fb-cats" id="fb-cats">
                ${CATEGORIES.map(c => `<button class="fb-cat" data-key="${c.key}" onclick="window._fbSelectCat('${c.key}')">${c.label}</button>`).join('')}
            </div>

            <textarea id="fb-msg" placeholder="What's on your mind? (required)" maxlength="500"></textarea>

            <div class="fb-stars">
                <span class="fb-star-label">Overall:</span>
                ${[1,2,3,4,5].map(n => `<button class="fb-star" data-n="${n}" onclick="window._fbSetRating(${n})" aria-label="${n} star">⭐</button>`).join('')}
            </div>

            <div id="fb-err"></div>
            <div id="fb-thanks">Thanks! 🙌 Your feedback helps make this better.</div>

            <button id="fb-submit" onclick="window._fbSubmit()">Send Feedback</button>
        `;

        document.body.appendChild(fab);
        document.body.appendChild(panel);

        // Click-outside to close
        document.addEventListener('click', function (e) {
            if (_panelOpen &&
                !panel.contains(e.target) &&
                e.target !== fab) {
                closePanel();
            }
        });
    }

    function togglePanel() {
        _panelOpen ? closePanel() : openPanel();
    }

    function openPanel() {
        _panelOpen = true;
        document.getElementById('fb-panel').classList.add('open');
        document.getElementById('fb-fab').classList.add('open');
        document.getElementById('fb-fab').textContent = '✕';
        document.getElementById('fb-msg').focus();
    }

    function closePanel() {
        _panelOpen = false;
        document.getElementById('fb-panel').classList.remove('open');
        document.getElementById('fb-fab').classList.remove('open');
        document.getElementById('fb-fab').textContent = '💬';
        // Reset form
        _selectedCategory = null;
        _selectedRating = 0;
        document.querySelectorAll('.fb-cat').forEach(b => b.classList.remove('selected'));
        document.querySelectorAll('.fb-star').forEach(b => b.classList.remove('lit'));
        document.getElementById('fb-msg').value = '';
        document.getElementById('fb-err').classList.remove('visible');
        document.getElementById('fb-thanks').classList.remove('visible');
        document.getElementById('fb-submit').style.display = '';
        document.getElementById('fb-submit').disabled = false;
    }

    // Exposed to inline handlers
    window._fbSelectCat = function (key) {
        _selectedCategory = key;
        document.querySelectorAll('.fb-cat').forEach(b => {
            b.classList.toggle('selected', b.dataset.key === key);
        });
    };

    window._fbSetRating = function (n) {
        _selectedRating = n;
        document.querySelectorAll('.fb-star').forEach(b => {
            b.classList.toggle('lit', parseInt(b.dataset.n) <= n);
        });
    };

    window._fbSubmit = async function () {
        const msg = (document.getElementById('fb-msg').value || '').trim();
        const errEl = document.getElementById('fb-err');
        errEl.classList.remove('visible');

        if (!_selectedCategory) {
            errEl.textContent = 'Please pick a category.';
            errEl.classList.add('visible');
            return;
        }
        if (!msg) {
            errEl.textContent = 'Please write a message.';
            errEl.classList.add('visible');
            return;
        }

        const btn = document.getElementById('fb-submit');
        btn.disabled = true;
        btn.textContent = 'Sending…';

        const payload = {
            member_id:   _member?.id   || null,
            member_name: _member?.name || null,
            page:        getPageName(),
            category:    _selectedCategory,
            message:     msg,
            rating:      _selectedRating || null,
        };

        const { error } = await _supabase.from('beta_feedback').insert(payload);

        if (error) {
            btn.disabled = false;
            btn.textContent = 'Send Feedback';
            errEl.textContent = 'Could not send — try again.';
            errEl.classList.add('visible');
            console.error('[feedback]', error.message);
            return;
        }

        // Success
        btn.style.display = 'none';
        document.getElementById('fb-thanks').classList.add('visible');
        setTimeout(closePanel, 2200);
    };

    // ── Public init ─────────────────────────────────────────────
    window.initFeedbackWidget = function (member) {
        _member = member || null;
        injectStyles();
        buildWidget();
    };

})();
