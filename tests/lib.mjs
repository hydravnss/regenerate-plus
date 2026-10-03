// Utilitaires de test (Playwright WebKit, iPhone 14 Pro) pour Regenerate Plus.
// Prérequis : une instance SillyTavern (défaut http://localhost:8010) avec l'extension installée,
// et le faux backend `node tests/mock-openai.mjs 9100`.
const pwPath = process.env.PW_PATH || '/workspace/pw/node_modules/playwright/index.mjs';
const { webkit, devices } = await import(pwPath);

export const ST = process.env.ST_URL || 'http://localhost:8010/';
export const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:9100';
export const SHOTS = process.env.SHOTS || '/workspace/st-test-shots';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mock(ctl) {
    const r = await fetch(`${MOCK}/_ctl`, { method: 'POST', body: JSON.stringify(ctl) });
    return r.json();
}
export const mockLog = async () => (await fetch(`${MOCK}/_log`)).json();
export const mockClear = async () => { await fetch(`${MOCK}/_log`, { method: 'DELETE' }); await mock({ queue: [], default: 'ok' }); };

export async function boot({ viewport } = {}) {
    const browser = await webkit.launch();
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'], hasTouch: true, ...(viewport ? { viewport } : {}) });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => { errs.push('PAGEERROR ' + e.message.slice(0, 300)); console.log('PAGEERROR', e.message.slice(0, 300)); });
    page.on('console', (m) => {
        if (m.type() === 'error' && !/interactive-widget|Failed to load resource|Extension update failed|image-metadata|ImageMetadata|Error loading folders/.test(m.text())) { errs.push('CONSOLE ' + m.text().slice(0, 300)); console.log('CONSOLE', m.text().slice(0, 300)); }
    });
    await page.goto(ST);
    await page.waitForFunction(() => globalThis.regeneratePlus && globalThis.SillyTavern?.getContext()?.eventSource, null, { timeout: 40000 });
    await page.waitForTimeout(2500);
    return { browser, context, page, errs };
}

export const ok = (cond, msg) => { console.log(cond ? 'OK   ' : 'ECHEC', msg); if (!cond) process.exitCode = 1; return cond; };

export const shot = (page, name) => page.screenshot({ path: `${SHOTS}/regen-${name}.png` });

/** Sélectionne un personnage par nom (chat simple). */
export async function selectChar(page, name = 'Seraphina') {
    await page.evaluate(async (n) => {
        const c = SillyTavern.getContext();
        await c.selectCharacterById(c.characters.findIndex((x) => x.name === n));
    }, name);
    await page.waitForTimeout(2000);
}

/** Vide le chat courant puis y met les messages donnés ({is_user,name,mes}) et l'affiche. */
export async function seedChat(page, msgs) {
    await page.evaluate(async (list) => {
        const c = SillyTavern.getContext();
        c.chat.length = 0;
        const now = Date.now();
        list.forEach((m, i) => {
            c.chat.push({
                name: m.name || (m.is_user ? c.name1 : c.name2),
                is_user: !!m.is_user, is_system: false,
                send_date: new Date(now + i * 1000).toISOString(),
                mes: m.mes, extra: {},
                ...(m.original_avatar ? { original_avatar: m.original_avatar, force_avatar: m.force_avatar } : {}),
            });
        });
        await c.printMessages();
        await c.saveChat();
    }, msgs);
    await page.waitForTimeout(800);
}

export const chatInfo = (page) => page.evaluate(() => {
    const c = SillyTavern.getContext();
    return {
        len: c.chat.length,
        msgs: c.chat.map((m) => ({ name: m.name, user: !!m.is_user, mes: m.mes, swipes: m.swipes ? m.swipes.length : undefined, sid: m.swipe_id, prev: !!m.extra?.regenplus_prev })),
        dom: document.querySelectorAll('#chat > .mes').length,
        gen: SillyTavern.getContext().eventSource && (document.body.dataset.generating === 'true'),
    };
});

/** Clique « comme au doigt » (tap tactile). */
export async function tap(page, selector) {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.tap();
}

/** Attend que le run Regenerate Plus soit fini et que ST soit inactif. */
export async function idle(page, timeout = 30000) {
    await page.waitForFunction(() => !document.body.classList.contains('regenplus-running') && !document.querySelector('#stop_but:not([style*="none"]):not(.displayNone)') , null, { timeout }).catch(() => {});
    await page.waitForTimeout(500);
}

export async function setSettings(page, patch) {
    await page.evaluate((p) => { Object.assign(SillyTavern.getContext().extensionSettings.regenerate_plus, p); globalThis.regeneratePlus.refresh(); }, patch);
}

/** Connecte ST au faux backend (Chat Completion → Custom). */
export async function connect(page, { stream = false } = {}) {
    await page.evaluate(async (stream) => {
        const c = SillyTavern.getContext();
        c.chatCompletionSettings.stream_openai = stream;
        $('#api_button_openai').trigger('click');
    }, stream);
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 });
}
