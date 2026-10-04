// Tests de bout en bout (chat de groupe).
import { boot, connect, seedChat, chatInfo, tap, idle, mock, mockLog, mockClear, setSettings, shot, ok, sleep } from './lib.mjs';

const GID = process.env.GROUP_ID || '1790999000001';
const SERA = 'default_Seraphina.png';
const BOB = 'Bob.png';
const msgs = [
    { is_user: true, mes: 'Salut tout le monde' },
    { name: 'Seraphina', mes: 'Seraphina : bienvenue.', original_avatar: SERA },
    { is_user: true, mes: 'Et toi Bob ?' },
    { name: 'Bob', mes: 'Bob : ravi d’être là.', original_avatar: BOB },
];

const { browser, page, errs } = await boot();
await connect(page);
await page.evaluate(async (gid) => { const g = await import('/scripts/group-chats.js'); await g.openGroupById(gid); }, GID);
await page.waitForTimeout(2500);
const reset = async (patch = {}) => {
    await mockClear();
    await setSettings(page, { mode: 'replace', retries: 1, retryDelay: 0.5, debounceMs: 300, undo: true, keepOthers: true, usePrompt: false, floating: true, stuckSeconds: 60, abortFirst: true, allowOld: true, ...patch });
    await seedChat(page, msgs);
    await page.waitForSelector('#regenplus-float.regenplus-show', { timeout: 5000 });
};
const names = async () => (await chatInfo(page)).msgs.map((m) => m.name).join(',');
ok(await page.evaluate(() => !!SillyTavern.getContext().groupId), 'Groupe ouvert');

// G1 : dernier message (Bob) régénéré plusieurs fois → toujours Bob
await reset();
let allBob = true;
for (let i = 0; i < 4; i++) {
    await tap(page, '#regenplus-float .regenplus-regen');
    await idle(page);
    await sleep(400);
    const n = await names();
    if (n !== 'User,Seraphina,User,Bob') { allBob = false; console.log('   noms :', n); }
}
ok(allBob, 'Groupe/Remplacer : le même personnage (Bob) répond à chaque fois (4 essais)');
let st = await chatInfo(page);
ok(st.len === 4 && st.msgs[3].name === 'Bob' && st.msgs[3].mes !== msgs[3].mes, `Groupe/Remplacer : 4 messages, texte remplacé ("${st.msgs[3].mes}")`);
const av = await page.evaluate(() => SillyTavern.getContext().chat[3].original_avatar);
ok(av === BOB, `Avatar d’origine conservé (${av})`);
await shot(page, '06-groupe-bob');

// G2 : ancien message de Seraphina (index 1)
await reset({});
await mock({ queue: [{ kind: 'ok', text: 'Seraphina REFAIT.' }] });
await page.evaluate(() => globalThis.regeneratePlus.regenerate({ mesId: 1 }));
await idle(page);
await sleep(400);
st = await chatInfo(page);
ok(st.msgs.map((m) => m.name).join(',') === 'User,Seraphina,User,Bob' && st.msgs[1].mes === 'Seraphina REFAIT.' && st.msgs[3].mes === msgs[3].mes && st.len === 4, `Groupe/ancien message : Seraphina refaite, suite intacte (${st.msgs.map((m) => m.mes).join(' | ')})`);
const lg = await mockLog();
ok(lg.length === 1 && !JSON.stringify(lg[0].messages).includes('ravi d’être là'), 'Groupe/ancien message : le contexte s’arrête au message ciblé');

// G3 : brouillon dans le champ de saisie non envoyé
await reset();
await page.fill('#send_textarea', 'mon brouillon important');
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
await sleep(400);
st = await chatInfo(page);
const draft = await page.inputValue('#send_textarea');
ok(draft === 'mon brouillon important' && st.len === 4 && !st.msgs.some((m) => m.mes.includes('brouillon')), `Brouillon conservé et non envoyé (champ="${draft}", len=${st.len})`);
await page.fill('#send_textarea', '');

// G4 : nouveau swipe en groupe
await reset({ mode: 'swipe' });
await mock({ queue: [{ kind: 'ok', text: 'Bob variante.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
st = await chatInfo(page);
ok(st.len === 4 && st.msgs[3].name === 'Bob' && st.msgs[3].swipes === 2 && st.msgs[3].mes === 'Bob variante.', `Groupe/swipe : +1 swipe pour Bob (swipes=${st.msgs[3].swipes})`);

// G5 : erreur → message d’origine restauré (nom/avatar)
await reset({ retries: 0 });
await mock({ queue: ['error'] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
await sleep(400);
st = await chatInfo(page);
const av2 = await page.evaluate(() => SillyTavern.getContext().chat[3]?.original_avatar);
ok(st.len === 4 && st.msgs[3].mes === msgs[3].mes && st.msgs[3].name === 'Bob' && av2 === BOB && st.dom === 4, 'Groupe/erreur 500 : message de Bob restauré');

// G6 : génération bloquée en groupe → Débloquer
await reset({ stuckSeconds: 5 });
await mock({ queue: ['hang'] });
await tap(page, '#regenplus-float .regenplus-regen');
await page.waitForTimeout(1500);
await page.waitForSelector('#regenplus-unlock.regenplus-show', { timeout: 15000 });
await tap(page, '#regenplus-unlock .regenplus-unlock-go');
await page.waitForTimeout(2500);
const gstate = await page.evaluate(async () => { const g = await import('/scripts/group-chats.js'); const s = await import('/script.js'); return { grp: g.is_group_generating, send: s.is_send_press, gen: document.body.dataset.generating }; });
st = await chatInfo(page);
ok(!gstate.grp && !gstate.send && !gstate.gen && st.len === 4 && st.msgs[3].mes === msgs[3].mes, `Groupe/blocage : Débloquer libère tout (${JSON.stringify(gstate)})`);
await mockClear();
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
st = await chatInfo(page);
ok(st.msgs[3].mes !== msgs[3].mes && st.msgs[3].name === 'Bob', 'Groupe : régénération OK après déblocage');

const real = errs.filter((e) => !/Extension update failed|image-metadata|ImageMetadata|Error loading folders|DOM element is not valid/.test(e));
ok(real.length === 0, `Aucune erreur console/page (${real.length}) ${real.join(' ; ').slice(0, 300)}`);
await browser.close();
