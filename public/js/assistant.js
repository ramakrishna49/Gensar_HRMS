// "Ask Gensar" - floating HR assistant widget.
// Self-contained: injects its own markup and styles, talks to
// POST /api/assistant/query via apiCall() from js/auth.js.
(function () {
    if (window.__gensarAssistant) return;
    window.__gensarAssistant = true;

    const style = document.createElement('style');
    style.textContent = `
        #gaBubble { position: fixed; right: 20px; bottom: 20px; z-index: 9998;
            width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
            background: linear-gradient(135deg, var(--primary), var(--primary-light));
            color: #fff; font-size: 1.4rem; box-shadow: 0 6px 18px rgba(0,0,0,.25);
            display: flex; align-items: center; justify-content: center;
            transition: transform .15s ease; }
        #gaBubble:hover { transform: scale(1.08); }
        #gaPanel { position: fixed; right: 20px; bottom: 86px; z-index: 9999;
            width: min(360px, calc(100vw - 32px)); height: min(480px, calc(100vh - 140px));
            background: var(--bg-card); border: 1px solid var(--border-light);
            border-radius: var(--radius-lg, 14px); box-shadow: 0 12px 40px rgba(0,0,0,.28);
            display: none; flex-direction: column; overflow: hidden; }
        #gaPanel.open { display: flex; }
        .ga-head { padding: 12px 14px; background: linear-gradient(135deg, var(--primary), var(--primary-light));
            color: #fff; display: flex; align-items: center; gap: 10px; }
        .ga-head i { font-size: 1.1rem; }
        .ga-title { font-weight: 600; font-size: .95rem; flex: 1; }
        .ga-sub { font-size: .72rem; opacity: .85; }
        .ga-close { background: rgba(255,255,255,.15); border: none; color: #fff; width: 28px; height: 28px;
            border-radius: 50%; cursor: pointer; font-size: 1rem; }
        #gaMsgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .ga-msg { max-width: 85%; padding: 9px 12px; border-radius: 12px; font-size: .86rem; line-height: 1.45;
            white-space: pre-wrap; overflow-wrap: anywhere; }
        .ga-bot { align-self: flex-start; background: var(--bg-main, rgba(99,102,241,.09)); color: var(--text-primary);
            border-bottom-left-radius: 4px; }
        .ga-user { align-self: flex-end; background: var(--primary); color: #fff; border-bottom-right-radius: 4px; }
        .ga-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .ga-act { font-size: .76rem; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--primary);
            color: var(--primary); text-decoration: none; background: transparent; cursor: pointer;
            transition: all .12s ease; }
        .ga-act:hover { background: var(--primary); color: #fff; }
        .ga-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
        .ga-chip { font-size: .74rem; padding: 5px 10px; border-radius: 999px; cursor: pointer;
            border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); }
        .ga-chip:hover { border-color: var(--primary); color: var(--primary); }
        .ga-inputrow { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border-light);
            background: var(--bg-card); }
        #gaInput { flex: 1; border: 1px solid var(--border-light); border-radius: 999px; padding: 8px 14px;
            font-size: .85rem; background: var(--bg-main, transparent); color: var(--text-primary); outline: none; }
        #gaInput:focus { border-color: var(--primary); }
        #gaSend { width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer;
            background: var(--primary); color: #fff; font-size: .9rem; }
        .ga-typing { align-self: flex-start; color: var(--text-secondary); font-size: .78rem; padding: 2px 6px; }
        @media (max-width: 520px) {
            #gaPanel.open { right: 16px; left: 16px; width: auto; }
        }
    `;
    document.head.appendChild(style);

    const bubble = document.createElement('button');
    bubble.id = 'gaBubble';
    bubble.type = 'button';
    bubble.title = 'Ask Gensar';
    bubble.innerHTML = '<i class="fas fa-robot"></i>';

    const panel = document.createElement('div');
    panel.id = 'gaPanel';
    panel.innerHTML = `
        <div class="ga-head">
            <i class="fas fa-robot"></i>
            <div style="flex:1;">
                <div class="ga-title">Ask Gensar</div>
                <div class="ga-sub">HR assistant</div>
            </div>
            <button class="ga-close" type="button" title="Close">&times;</button>
        </div>
        <div id="gaMsgs"></div>
        <div class="ga-chips" id="gaChips"></div>
        <div class="ga-inputrow">
            <input id="gaInput" type="text" placeholder="Ask me anything... e.g. my leave balance?" autocomplete="off">
            <button id="gaSend" type="button"><i class="fas fa-paper-plane"></i></button>
        </div>
    `;

    function wire() {
        // Must run AFTER the panel is appended to the document, otherwise
        // #gaInput/#gaSend lookups return null and typing never sends.
        bubble.addEventListener('click', () => toggle());
        panel.querySelector('.ga-close').addEventListener('click', () => toggle(false));
        const input = panel.querySelector('#gaInput');
        const send = panel.querySelector('#gaSend');
        send.addEventListener('click', () => ask(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') ask(input.value);
        });
    }

    function mount() {
        document.body.appendChild(bubble);
        document.body.appendChild(panel);
        wire();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    const msgs = () => document.getElementById('gaMsgs');
    const chipsBox = () => document.getElementById('gaChips');

    function scrollBottom() {
        const box = msgs();
        box.scrollTop = box.scrollHeight;
    }

    function addMsg(text, who) {
        const el = document.createElement('div');
        el.className = 'ga-msg ga-' + who;
        el.textContent = text;
        msgs().appendChild(el);
        scrollBottom();
        return el;
    }

    function renderActions(actions) {
        if (!actions || !actions.length) return;
        const last = msgs().lastElementChild;
        const wrap = document.createElement('div');
        wrap.className = 'ga-actions';
        for (const a of actions) {
            const link = document.createElement('a');
            link.className = 'ga-act';
            link.href = a.url || '#';
            link.innerHTML = '<i class="fas fa-arrow-right" style="margin-right:5px;"></i>' + escapeHtml(a.label || 'Open');
            wrap.appendChild(link);
        }
        last.appendChild(wrap);
        scrollBottom();
    }

    function renderChips(chips) {
        chipsBox().innerHTML = '';
        if (!chips || !chips.length) return;
        for (const c of chips) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ga-chip';
            b.textContent = c;
            b.onclick = () => ask(c);
            chipsBox().appendChild(b);
        }
    }

    let busy = false;

    async function ask(question) {
        const q = String(question || '').trim();
        if (!q || busy) return;

        // Clear the input as soon as the message is accepted.
        const input = panel.querySelector('#gaInput');
        if (input) input.value = '';

        addMsg(q, 'user');
        renderChips([]);
        busy = true;

        const typing = document.createElement('div');
        typing.className = 'ga-typing';
        typing.textContent = 'Thinking...';
        msgs().appendChild(typing);
        scrollBottom();

        const data = await apiCall('/assistant/query', 'POST', { message: q });

        typing.remove();
        busy = false;

        if (data && data.success) {
            addMsg(data.reply || 'Sorry, try again.', 'bot');
            renderActions(data.actions);
            renderChips(data.chips);
        } else {
            addMsg((data && data.message) || 'Something went wrong. Please try again.', 'bot');
        }

        if (input) input.focus();
    }

    function toggle(open) {
        const willOpen = open !== undefined ? open : !panel.classList.contains('open');
        panel.classList.toggle('open', willOpen);
        if (willOpen && msgs().children.length === 0) {
            // Opening line is always in English; after this, replies follow
            // whichever language the employee asks in.
            addMsg("Hi! I'm Gensar HR Assistant 🤖 I can help with leave balances, attendance, holidays, payslips and more. What would you like to know?", 'bot');
            renderChips(['Leave balance', 'My attendance', 'Next holidays', 'Request status']);
            document.getElementById('gaInput').focus();
        }
    }

})();
