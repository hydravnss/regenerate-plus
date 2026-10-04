// Tests de bout en bout (interface) : bouton flottant, déplacement, persistance, slash, menu natif, streaming.
import { boot, connect, selectChar, seedChat, chatInfo, tap, idle, mock, mockLog, mockClear, setSettings, shot, ok, sleep } from './lib.mjs';

const OLD = 'Ancienne réponse de Seraphina.';
const base = [{ is_user: true, mes: 'Bonjour Seraphina' }, { mes: OLD }];
let { browser, page, errs } = await boot();
await connect(page);
await selectChar(page);
const reset = async (patch = {}, msgs = base) => {
    await mockClear();
    await setSettings(page, { enabled: true, mode: 'replace', retries: 1, retryDelay: 0.5, debounceMs: 300, undo: true, interceptBuiltin: false, hideBuiltin: false, floating: true, stuckSeconds: 60, ...patch });
    await seedChat(page, msgs);
};

// ---------- panneau de réglages ----------
await tap(page, '#extensions-settings-button .drawer-toggle');
await page.waitForTimeout(800);
await page.evaluate(() => { document.getElementById('regenplus_settings').scrollIntoView(); });
const hdr = page.locator('#regenplus_settings .inline-drawer-toggle');
await hdr.tap();
await page.waitForTimeout(600);
ok(await page.locator('#regenplus_mode').isVisible(), 'Panneau de réglages affiché (inline-drawer)');
ok(await page.evaluate(() => ['enabled', 'allowOld', 'keepOthers', 'undo', 'toasts'].every((k) => document.getElementById('regenplus_' + k).checked)), 'Cases du panneau synchronisées avec les réglages');
await page.evaluate(() => { document.getElementById('regenplus_settings').scrollIntoView(); });
await shot(page, '07-reglages-haut');
await page.evaluate(() => { document.getElementById('regenplus_floating').scrollIntoView(); });
await shot(page, '07b-reglages-boutons');
// change un réglage via l'UI
await page.selectOption('#regenplus_mode', 'swipe');
ok(await page.evaluate(() => SillyTavern.getContext().extensionSettings.regenerate_plus.mode) === 'swipe', 'Réglage « mode » enregistré depuis le panneau');
await page.selectOption('#regenplus_mode', 'replace');
await tap(page, '#extensions-settings-button .drawer-toggle');
await page.waitForTimeout(500);

// ---------- bouton flottant ----------
await reset({ floating: true, floatX: 50, floatY: 50 });
await page.waitForTimeout(500);
const fl = () => page.evaluate(() => {
    const el = document.getElementById('regenplus-float'); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const f = document.getElementById('form_sheld').getBoundingClientRect();
    return { parent: el.parentElement.tagName, pos: cs.position, z: +cs.zIndex, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, formTop: Math.round(f.top), shown: el.classList.contains('regenplus-show'), transformAncestor: (() => { for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) { const t = getComputedStyle(n).transform; if (t && t !== 'none') return n.tagName; } return null; })() };
});
let f = await fl();
ok(f.shown && f.parent === 'BODY' && f.pos === 'fixed' && f.transformAncestor === null, `Flottant : enfant de <body>, fixed, aucun ancêtre transformé (${JSON.stringify({ parent: f.parent, pos: f.pos, ta: f.transformAncestor })})`);
const zForm = await page.evaluate(() => +getComputedStyle(document.getElementById('form_sheld')).zIndex || 0);
ok(f.bottom <= f.formTop, `Flottant : ne recouvre pas la barre d’envoi (bas=${f.bottom} ≤ haut barre=${f.formTop}) ; z-index ${f.z} (< menus 2000)`);
await shot(page, '08-flottant-50-50');
ok(f.w >= 44 && f.h >= 44, `Cible tactile ≥ 44 px (${f.w}×${f.h})`);

const slide = async (key, v) => { await page.evaluate(([k, val]) => { const el = document.getElementById('regenplus_' + k); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, [key, v]); await page.waitForTimeout(150); };
await slide('floatX', 0); await slide('floatY', 0);
f = await fl();
ok(f.x === 6 && f.y >= 6 && f.y < 120, `Sliders 0 % / 0 % → coin haut-gauche (x=${f.x}, y=${f.y})`);
await slide('floatX', 100); await slide('floatY', 100);
f = await fl();
ok(f.right === f.vw - 6 && f.bottom <= f.formTop && f.formTop - f.bottom < 12, `Sliders 100 % / 100 % → coin bas-droit, au-dessus de la barre (right=${f.right}/${f.vw}, bottom=${f.bottom}, barre=${f.formTop})`);
await shot(page, '08b-flottant-100-100');
await slide('floatX', 20); await slide('floatY', 40);
f = await fl();
const x20 = f.x, y40 = f.y;

// mode Déplacer + glisser
await page.evaluate(() => document.getElementById('regenplus_move_btn').click());
await page.waitForTimeout(400);
ok(await page.evaluate(() => document.getElementById('regenplus-float').classList.contains('regenplus-move') && document.getElementById('regenplus-move-done').classList.contains('regenplus-show')), 'Mode « Déplacer » actif (cadre + bouton Terminer)');
await shot(page, '09-mode-deplacer');
f = await fl();
const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 120, cy - 80, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const f2 = await fl();
const sv = await page.evaluate(() => { const s = SillyTavern.getContext().extensionSettings.regenerate_plus; return [s.floatX, s.floatY]; });
ok(f2.x > f.x + 60 && f2.y < f.y - 40, `Glisser : le bouton a bougé (${f.x},${f.y}) → (${f2.x},${f2.y})`);
ok(sv[0] !== 20 && sv[1] !== 40, `Glisser : position enregistrée en % (${sv[0]} %, ${sv[1]} %)`);
const sliderVals = await page.evaluate(() => [document.getElementById('regenplus_floatX').value, document.getElementById('regenplus_floatY').value]);
ok(Math.abs(sliderVals[0] - sv[0]) < 0.6 && Math.abs(sliderVals[1] - sv[1]) < 0.6, `Sliders synchronisés avec le glisser (${sliderVals})`);
// un tap en mode déplacement ne déclenche pas de régénération
await mockClear();
await page.mouse.click(f2.x + f2.w / 2, f2.y + f2.h / 2);
await sleep(600);
ok((await mockLog()).length === 0, 'Tap en mode Déplacer : aucune régénération');
await tap(page, '#regenplus-move-done');
await page.waitForTimeout(300);
ok(await page.evaluate(() => !document.getElementById('regenplus-float').classList.contains('regenplus-move')), 'Terminer le déplacement');

// persistance après rechargement
await page.waitForTimeout(2500); // saveSettingsDebounced
const before = await page.evaluate(() => ({ ...SillyTavern.getContext().extensionSettings.regenerate_plus }));
await page.reload();
await page.waitForFunction(() => globalThis.regeneratePlus && SillyTavern.getContext().eventSource, null, { timeout: 40000 });
await page.waitForTimeout(2500);
await connect(page);
await selectChar(page);
const after = await page.evaluate(() => ({ ...SillyTavern.getContext().extensionSettings.regenerate_plus }));
ok(after.floatX === before.floatX && after.floatY === before.floatY && after.floating === true && after.mode === 'replace', `Persistance après rechargement (floatX=${after.floatX}, floatY=${after.floatY}, floating=${after.floating})`);
await page.waitForTimeout(800);
const f3 = await fl();
ok(f3.shown && Math.abs(f3.x - f2.x) <= 2 && Math.abs(f3.y - f2.y) <= 2, `Position restaurée à l’écran (${f3.x},${f3.y}) ≈ (${f2.x},${f2.y})`);

// tap sur le flottant = régénère ; mini bouton annuler
await reset({ floating: true });
await page.waitForTimeout(400);
await mock({ queue: [{ kind: 'ok', text: 'Via flottant.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
let st = await chatInfo(page);
ok(st.msgs[1].mes === 'Via flottant.', `Flottant : régénère (${st.msgs[1].mes})`);
ok(await page.locator('#regenplus-float .regenplus-undo').isVisible(), 'Flottant : mini bouton « Annuler » affiché');
await shot(page, '10-flottant-annuler');
await tap(page, '#regenplus-float .regenplus-undo');
await page.waitForTimeout(700);
st = await chatInfo(page);
ok(st.msgs[1].mes === OLD, 'Flottant : annuler restaure l’ancien texte');

// ---------- commande slash ----------
await reset();
await mock({ queue: [{ kind: 'ok', text: 'Via slash swipe.' }] });
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen swipe'));
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].swipes === 2 && st.msgs[1].mes === 'Via slash swipe.', `/regen swipe (swipes=${st.msgs[1].swipes})`);
await page.waitForTimeout(800);
await mock({ queue: [{ kind: 'ok', text: 'Via slash replace.' }] });
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen replace'));
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].swipes === 2 && st.msgs[1].mes === 'Via slash replace.', `/regen replace remplace le swipe courant (swipes=${st.msgs[1].swipes})`);
await page.waitForTimeout(800);
const bad = await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/regen nimportequoi'); return [...document.querySelectorAll('#toast-container .toast-message')].map((e) => e.textContent).join('|'); });
ok(/Mode inconnu/.test(bad), 'Mode inconnu → toast français');
const hasCmd = await page.evaluate(async () => (await import('/scripts/slash-commands/SlashCommandParser.js')).SlashCommandParser.commands.regen?.helpString.includes('Regenerate Plus'));
ok(hasCmd, '/regen enregistré par l’extension');

// ---------- menu natif ✨ ----------
await reset({ interceptBuiltin: true });
await mock({ queue: [{ kind: 'ok', text: 'Via menu intercepté.' }] });
await tap(page, '#options_button');
await page.waitForTimeout(500);
await shot(page, '11-menu-baguette');
await tap(page, '#option_regenerate');
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes === 'Via menu intercepté.' && st.msgs[1].prev, `Menu ✨ intercepté : géré par l’extension (undo dispo=${st.msgs[1].prev})`);
const menuVisible = await page.evaluate(() => getComputedStyle(document.getElementById('options')).display);
ok(menuVisible === 'none', `Menu ✨ refermé (${menuVisible})`);
await tap(page, '#options_button'); await page.waitForTimeout(500);
ok(await page.locator('#options').isVisible(), 'Menu ✨ se rouvre au 1er tap (état interne cohérent)');
await tap(page, '#options_button'); await page.waitForTimeout(300);
await reset({ hideBuiltin: true });
await tap(page, '#options_button'); await page.waitForTimeout(500);
ok(!(await page.locator('#option_regenerate').isVisible()), 'Option « Masquer le Régénérer natif »');
await tap(page, '#options_button');

// ---------- streaming ----------
await connect(page, { stream: true });
await reset({});
await mock({ queue: [{ kind: 'ok', text: 'Réponse en flux continu, assez longue pour être diffusée par petits morceaux.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes.startsWith('Réponse en flux continu'), `Streaming/Remplacer ("${st.msgs[1].mes}")`);
// stop en cours de flux : texte partiel conservé
await reset({});
await mock({ queue: [{ kind: 'slow', text: 'Début de réponse qui sera coupée net par le bouton stop de SillyTavern, donc partielle.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await page.waitForTimeout(2200);
await page.evaluate(() => document.getElementById('mes_stop').click());
await idle(page);
st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes !== OLD && st.msgs[1].mes.length > 3 && st.msgs[1].mes.length < 80, `Streaming/Stop : texte partiel conservé ("${st.msgs[1].mes}")`);
// stop avant le premier jeton : ancien texte restauré
await reset({});
await mock({ queue: ['hang'] });
await tap(page, '#regenplus-float .regenplus-regen');
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById('mes_stop').click());
await idle(page);
await sleep(500);
st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes === OLD, `Streaming/Stop sans jeton : ancien texte restauré ("${st.msgs[1].mes}")`);

// ---------- réinitialisation ----------
await page.evaluate(() => document.getElementById('regenplus_reset').click());
const def = await page.evaluate(() => SillyTavern.getContext().extensionSettings.regenerate_plus);
ok(def.mode === 'replace' && def.floating === true && def.replyIfUserLast === true && def.inline === undefined && def.floatX === 88, 'Réinitialisation des réglages');

const real = errs.filter((e) => !/Extension update failed|image-metadata|ImageMetadata|Error loading folders|DOM element is not valid/.test(e));
ok(real.length === 0, `Aucune erreur console/page (${real.length}) ${real.join(' ; ').slice(0, 400)}`);
await browser.close();
