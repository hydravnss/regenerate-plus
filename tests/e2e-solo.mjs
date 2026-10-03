// Tests de bout en bout (chat simple) — SillyTavern réel + faux backend.
import { boot, connect, selectChar, seedChat, chatInfo, tap, idle, mock, mockLog, mockClear, setSettings, shot, ok, sleep } from './lib.mjs';

const OLD = 'Ancienne réponse de Seraphina.';
const base = [{ is_user: true, mes: 'Bonjour Seraphina' }, { mes: OLD }];

const { browser, page, errs } = await boot();
await connect(page);
await selectChar(page);
const reset = async (patch = {}, msgs = base) => {
    await mockClear();
    await setSettings(page, { mode: 'replace', inline: 'last', retries: 2, retryDelay: 0.5, debounceMs: 700, undo: true, keepOthers: true, usePrompt: false, floating: false, stuckSeconds: 60, stuckDetect: true, autoUnblock: false, abortFirst: true, allowOld: true, ...patch });
    await seedChat(page, msgs);
    await page.waitForSelector('.regenplus-row', { timeout: 5000 });
};
const rgTap = () => tap(page, '#chat .mes:last-child .regenplus-regen');

// ---------- 1. Remplacer ----------
await reset();
await mock({ queue: [{ kind: 'ok', text: 'Nouvelle réponse REMPLACÉE.' }] });
await rgTap();
await idle(page);
let st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes === 'Nouvelle réponse REMPLACÉE.', `Remplacer : texte remplacé (len=${st.len}, mes="${st.msgs[1].mes}")`);
ok((st.msgs[1].swipes ?? 1) === 1, `Remplacer : aucun swipe en plus (swipes=${st.msgs[1].swipes})`);
ok(st.msgs[1].prev, 'Remplacer : ancien texte gardé pour annuler');
ok(await page.locator('#chat .mes:last-child .regenplus-undo').isVisible(), 'Bouton « Annuler » visible');
let lg = await mockLog();
ok(lg.length === 1 && !JSON.stringify(lg[0].messages).includes(OLD), 'Le modèle ne voit pas l’ancienne réponse (contexte propre)');
await shot(page, '01-remplace');
await tap(page, '#chat .mes:last-child .regenplus-undo');
await page.waitForTimeout(800);
st = await chatInfo(page);
ok(st.msgs[1].mes === OLD && !st.msgs[1].prev, `Annuler : ancien texte restauré ("${st.msgs[1].mes}")`);
const domTxt = await page.locator('#chat .mes:last-child .mes_text').innerText();
ok(domTxt.includes(OLD), 'Annuler : DOM mis à jour');

// ---------- 2. Nouveau swipe ----------
await reset({ mode: 'swipe' });
await mock({ queue: [{ kind: 'ok', text: 'Variante swipe.' }] });
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].swipes === 2 && st.msgs[1].sid === 1 && st.msgs[1].mes === 'Variante swipe.', `Nouveau swipe : +1 swipe (swipes=${st.msgs[1].swipes}, sid=${st.msgs[1].sid})`);
await shot(page, '02-swipe');
await tap(page, '#chat .mes:last-child .regenplus-undo');
await page.waitForTimeout(1200);
st = await chatInfo(page);
ok(st.msgs[1].swipes === 1 && st.msgs[1].mes === OLD, `Annuler (swipe) : retour à l’ancien texte (swipes=${st.msgs[1].swipes}, mes="${st.msgs[1].mes}")`);

// 2b. swipe depuis un swipe qui n'est pas le dernier : le natif ne ferait que naviguer
await reset({ mode: 'swipe' });
await page.evaluate(async () => {
    const c = SillyTavern.getContext(); const m = c.chat[1];
    m.swipes = [m.mes, 'Deuxième', 'Troisième']; m.swipe_info = m.swipes.map(() => ({ extra: {} })); m.swipe_id = 0;
    await c.printMessages();
});
await page.waitForSelector('.regenplus-row');
await mock({ queue: [{ kind: 'ok', text: 'Quatrième.' }] });
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].swipes === 4 && st.msgs[1].mes === 'Quatrième.', `Swipe depuis le 1er de 3 : génère bien un 4e (swipes=${st.msgs[1].swipes})`);

// 2c. message d'accueil (1er message) : le swipe natif « boucle » au lieu de générer
await reset({ mode: 'swipe' }, [{ mes: 'Accueil de Seraphina.' }]);
await mock({ queue: [{ kind: 'ok', text: 'Accueil régénéré.' }] });
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.msgs[0].mes === 'Accueil régénéré.' && st.msgs[0].swipes === 2, `Accueil (swipe) : génération forcée (mes="${st.msgs[0].mes}", swipes=${st.msgs[0].swipes})`);

// ---------- 3. Remplacer en gardant les autres swipes ----------
await reset({ mode: 'replace' });
await page.evaluate(async () => {
    const c = SillyTavern.getContext(); const m = c.chat[1];
    m.swipes = ['Alpha', 'Beta']; m.swipe_info = [{ extra: {} }, { extra: {} }]; m.swipe_id = 1; m.mes = 'Beta';
    await c.printMessages();
});
await page.waitForSelector('.regenplus-row');
await mock({ queue: [{ kind: 'ok', text: 'Beta remplacé.' }] });
await rgTap();
await idle(page);
st = await chatInfo(page);
const sw = await page.evaluate(() => SillyTavern.getContext().chat[1].swipes);
ok(JSON.stringify(sw) === JSON.stringify(['Alpha', 'Beta remplacé.']), `Remplacer garde les autres swipes : ${JSON.stringify(sw)}`);

// ---------- 4. Continuer ----------
await reset({ mode: 'continue' });
await mock({ queue: [{ kind: 'ok', text: ' Et voici la suite.' }] });
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes.startsWith(OLD) && st.msgs[1].mes.includes('la suite'), `Continuer : texte prolongé ("${st.msgs[1].mes}")`);
await tap(page, '#chat .mes:last-child .regenplus-undo');
await page.waitForTimeout(600);
st = await chatInfo(page);
ok(st.msgs[1].mes === OLD, 'Continuer + Annuler : texte d’origine');

// ---------- 5. Nouvelles tentatives ----------
await reset({ retries: 2, retryDelay: 0.5 });
await mock({ queue: ['empty', 'error', { kind: 'ok', text: 'Enfin une réponse.' }] });
await rgTap();
await idle(page, 40000);
st = await chatInfo(page);
lg = await mockLog();
ok(st.msgs[1].mes === 'Enfin une réponse.' && lg.length === 3, `Retry : vide → erreur 500 → OK (requêtes=${lg.length}, mes="${st.msgs[1].mes}")`);

await reset({ retries: 1, retryDelay: 0.5 });
await mock({ queue: ['empty', 'empty'] });
await rgTap();
await idle(page, 40000);
st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes === OLD && st.dom === 2, `Échecs répétés : ancien texte restauré, message présent (len=${st.len}, mes="${st.msgs[1].mes}")`);
await page.waitForTimeout(300);
const toastTxt = await page.evaluate(() => [...document.querySelectorAll('#toast-container .toast-message')].map((e) => e.textContent).join(' | '));
ok(/Échec de la régénération/.test(toastTxt), `Toast d’échec en français : ${toastTxt.slice(0, 160)}`);
await shot(page, '03-echec-restaure');

await reset({ retries: 0 });
await mock({ queue: ['error'] });
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes === OLD && st.len === 2, 'Erreur 500 seule : ancien texte intact');

// ---------- 6. Anti double tap ----------
await reset({ debounceMs: 900 });
await mock({ queue: [{ kind: 'slow' }], default: 'ok' });
await page.evaluate(() => { const b = document.querySelector('#chat .mes:last-child .regenplus-regen'); b.click(); b.click(); setTimeout(() => b.click(), 120); });
await idle(page, 30000);
lg = await mockLog();
ok(lg.length === 1, `Double/triple tap : 1 seule requête (requêtes=${lg.length})`);

// ---------- 7. Instruction de régénération ----------
await reset({ usePrompt: true, promptText: 'CONSIGNE-DE-TEST réécris. Avant : {{old}}', promptRole: 'system' });
await rgTap();
await idle(page);
lg = await mockLog();
let flat = JSON.stringify(lg[0].messages);
ok(flat.includes('CONSIGNE-DE-TEST') && flat.includes(OLD), 'Instruction injectée avec {{old}}');
await page.waitForTimeout(900);
await mockClear();
await setSettings(page, { usePrompt: false });
await rgTap();
await idle(page);
lg = await mockLog();
ok(lg.length === 1 && !JSON.stringify(lg[0].messages).includes('CONSIGNE-DE-TEST'), 'Instruction retirée après la génération (une seule fois)');

// ---------- 8. Ancien message (non dernier) ----------
await reset({ inline: 'all' }, [{ is_user: true, mes: 'U1' }, { mes: 'Bot un' }, { is_user: true, mes: 'U2' }, { mes: 'Bot deux' }, { is_user: true, mes: 'U3' }, { mes: 'Bot trois' }]);
await mock({ queue: [{ kind: 'ok', text: 'Bot un REFAIT' }] });
await tap(page, '#chat .mes[mesid="1"] .regenplus-regen');
await idle(page);
st = await chatInfo(page);
lg = await mockLog();
ok(st.len === 6 && st.msgs.map((m) => m.mes).join('|') === 'U1|Bot un REFAIT|U2|Bot deux|U3|Bot trois', `Ancien message : remplacé, suite du chat intacte (${st.msgs.map((m) => m.mes).join('|')})`);
ok(!JSON.stringify(lg[0].messages).includes('Bot deux') && JSON.stringify(lg[0].messages).includes('U1'), 'Ancien message : contexte envoyé coupé à ce message');
ok(st.dom === 6, `DOM complet (${st.dom}/6)`);
const order = await page.evaluate(() => [...document.querySelectorAll('#chat > .mes')].map((e) => e.getAttribute('mesid')).join(','));
ok(order === '0,1,2,3,4,5', `Ordre des messages dans le DOM : ${order}`);
const saved = await page.evaluate(async () => { const c = SillyTavern.getContext(); const r = await fetch('/api/chats/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ ch_name: c.characters[c.characterId].name, file_name: c.getCurrentChatId(), avatar_url: c.characters[c.characterId].avatar }) }); const j = await r.json(); return j.length - 1; });
ok(saved === 6, `Fichier de chat sauvegardé complet (${saved} messages)`);
await shot(page, '04-ancien-message');

// ---------- 9. Génération bloquée → Débloquer ----------
await reset({ stuckSeconds: 5 });
await mock({ queue: ['hang'] });
await rgTap();
await page.waitForTimeout(1500);
ok(await page.evaluate(() => document.body.dataset.generating === 'true'), 'Génération en cours (backend muet)');
ok(await page.locator('#regenplus-status.regenplus-show .regenplus-spin').isVisible(), 'Pastille « Régénération… » avec spinner pendant la génération');
await shot(page, '05a-spinner-en-cours');
await page.waitForSelector('#regenplus-unlock.regenplus-show', { timeout: 15000 });
ok(true, 'Bandeau « Débloquer » apparu après 5 s sans activité');
await shot(page, '05-bloque-debloquer');
await tap(page, '#regenplus-unlock .regenplus-unlock-go');
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ gen: document.body.dataset.generating, stop: getComputedStyle(document.querySelector('#mes_stop')).display, send: getComputedStyle(document.querySelector('#send_but')).display, banner: document.getElementById('regenplus-unlock').classList.contains('regenplus-show'), sp: SillyTavern.getContext().swipe.state() }));
st = await chatInfo(page);
ok(!after.gen && after.stop === 'none' && !after.banner, `Débloquer : UI remise à zéro (${JSON.stringify(after)})`);
ok(st.msgs[1].mes === OLD && st.len === 2, 'Débloquer : ancien texte intact');
await mockClear();
await rgTap();
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes !== OLD, 'Régénération possible juste après le déblocage');

// 9b. is_send_press resté à true sans génération (état « bloqué » du natif)
await reset({ stuckSeconds: 5 });
await page.evaluate(async () => { const m = await import('/script.js'); m.setSendButtonState(true); });
ok(await page.evaluate(async () => (await import('/script.js')).is_send_press), 'is_send_press forcé à true (simule le blocage natif)');
await rgTap(); // abortFirst : doit débloquer puis régénérer
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes !== OLD, `Bouton fonctionne même si is_send_press est resté bloqué ("${st.msgs[1].mes}")`);

// 9c. état de swipe natif coincé en « swiping »
await reset({});
await page.evaluate(async () => { const c = SillyTavern.getContext(); await c.swipe.to(null, 'right', { message: c.chat[1], forceMesId: 99, source: 'slash_command' }); });
const stuckSwipe = await page.evaluate(() => SillyTavern.getContext().swipe.state());
ok(stuckSwipe === 'swiping', `État de swipe natif coincé reproduit (${stuckSwipe})`);
await tap(page, '#regenplus_unblock_btn').catch(() => {});
await page.evaluate(() => regeneratePlus.unblock());
await page.waitForTimeout(800);
ok(await page.evaluate(() => SillyTavern.getContext().swipe.state()) === 'none', 'Débloquer répare l’état de swipe coincé');

// ---------- fin ----------
const real = errs.filter((e) => !/Extension update failed|image-metadata|ImageMetadata|Error loading folders|DOM element is not valid/.test(e));
ok(real.length === 0, `Aucune erreur console/page (${real.length}) ${real.join(' ; ').slice(0, 300)}`);
await browser.close();
