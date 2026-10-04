// Tests 1.1.0 : plus de boutons sous les avatars ; le bouton raccourci ne vise que le bot ; jamais le message utilisateur ; groupes ; migration.
import { boot, connect, selectChar, seedChat, chatInfo, tap, idle, mock, mockLog, mockClear, setSettings, ok, sleep, SHOTS } from './lib.mjs';

const GID = process.env.GROUP_ID || '1790999000001';
const SERA = 'default_Seraphina.png';
const BOB = 'Bob.png';
const shot2 = (page, name) => page.screenshot({ path: `${SHOTS}/regen2-${name}.png` });
const U1 = 'Bonjour, MESSAGE-UTILISATEUR-1';
const U2 = 'Deuxième message, MESSAGE-UTILISATEUR-2 (le dernier)';
const OLD = 'Ancienne réponse de Seraphina.';

const { browser, page, errs } = await boot();
await connect(page);
await selectChar(page);
const reset = async (patch = {}, msgs) => {
    await mockClear();
    await setSettings(page, { enabled: true, mode: 'replace', floating: true, replyIfUserLast: true, retries: 1, retryDelay: 0.5, debounceMs: 300, undo: true, keepOthers: true, allowOld: true, usePrompt: false, interceptBuiltin: false, hideBuiltin: false, floatX: 88, floatY: 70, stuckSeconds: 60, ...patch });
    await seedChat(page, msgs);
    await page.waitForTimeout(500);
};
const userTexts = async () => (await chatInfo(page)).msgs.filter((m) => m.user).map((m) => m.mes);
const noInline = () => page.evaluate(() => ({
    rows: document.querySelectorAll('.regenplus-row').length,
    btnsInChat: document.querySelectorAll('#chat .regenplus-btn, .mes .regenplus-btn, .mes .avatar .regenplus-btn').length,
    visibleRows: [...document.querySelectorAll('.regenplus-row')].filter((e) => e.offsetParent !== null).length,
    labels: [...document.querySelectorAll('#chat .mes')].filter((e) => /Régénérer|Annuler|Générer la réponse/.test(e.innerText)).length,
}));

// ---------- 1. pas de boutons sous les avatars ----------
await reset({}, [{ is_user: true, mes: U1 }, { mes: OLD }]);
let n = await noInline();
ok(n.rows === 0 && n.btnsInChat === 0 && n.labels === 0, `Aucun bouton sous les avatars / dans les messages (${JSON.stringify(n)})`);
ok(await page.evaluate(() => document.querySelector('#regenplus-float').classList.contains('regenplus-show')), 'Bouton raccourci flottant affiché');
await shot2(page, '01-sans-boutons-sous-avatar');
// aussi avec plusieurs messages, y compris en 'all' hérité de l'ancien réglage
await reset({ inline: 'all' }, [{ is_user: true, mes: 'U1' }, { mes: 'Bot un' }, { is_user: true, mes: 'U2' }, { mes: 'Bot deux' }]);
n = await noInline();
ok(n.rows === 0 && n.btnsInChat === 0 && n.labels === 0, `Même avec un ancien réglage inline=all injecté : rien sous les messages (${JSON.stringify(n)})`);
await shot2(page, '02-4-messages-sans-boutons');

// ---------- 2. panneau de réglages ----------
await tap(page, '#extensions-settings-button .drawer-toggle');
await page.waitForTimeout(800);
await page.evaluate(() => { document.getElementById('regenplus_settings').scrollIntoView(); });
await page.locator('#regenplus_settings .inline-drawer-toggle').tap();
await page.waitForTimeout(600);
ok(await page.evaluate(() => !document.getElementById('regenplus_inline') && !!document.getElementById('regenplus_floating') && !!document.getElementById('regenplus_replyIfUserLast')), 'Réglages : plus d’option « Bouton dans les messages » ; options bouton raccourci + « dernier message = le mien »');
ok(await page.evaluate(() => document.getElementById('regenplus_floating').checked && document.getElementById('regenplus_replyIfUserLast').checked), 'Réglages : bouton raccourci activé par défaut');
await page.evaluate(() => { document.getElementById('regenplus_floating').scrollIntoView({ block: 'start' }); });
await page.waitForTimeout(300);
await shot2(page, '03-reglages');
await tap(page, '#extensions-settings-button .drawer-toggle');
await page.waitForTimeout(500);

// ---------- 3. le bouton raccourci remplace uniquement la réponse du bot ----------
await reset({}, [{ is_user: true, mes: U1 }, { mes: OLD }]);
await mock({ queue: [{ kind: 'ok', text: 'Réponse du bot REFAITE.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
let st = await chatInfo(page);
ok(st.len === 2 && st.msgs[1].mes === 'Réponse du bot REFAITE.' && st.msgs[0].mes === U1 && st.msgs[0].user, `Raccourci : seule la réponse du bot est remplacée (user="${st.msgs[0].mes}", bot="${st.msgs[1].mes}")`);
ok((await mockLog()).length === 1, 'Raccourci : une seule requête');
await shot2(page, '04-bot-regenere');
await tap(page, '#regenplus-float .regenplus-undo');
await page.waitForTimeout(800);
st = await chatInfo(page);
ok(st.msgs[1].mes === OLD && st.msgs[0].mes === U1, 'Annuler (raccourci) : ancienne réponse du bot restaurée, message utilisateur intact');

// ---------- 4. dernier message = utilisateur ----------
const withUser = [{ is_user: true, mes: U1 }, { mes: OLD }, { is_user: true, mes: U2 }];
await reset({}, withUser);
ok(await page.evaluate(() => document.querySelector('#regenplus-float .regenplus-regen').dataset.target) === 'reply'
    && /Générer/.test(await page.evaluate(() => document.querySelector('#regenplus-float .regenplus-regen').getAttribute('aria-label'))), 'Dernier = utilisateur : le bouton est en mode « Générer la réponse du bot »');
await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach((e) => e.remove()));
await shot2(page, '05-dernier-message-utilisateur');
await mock({ queue: [{ kind: 'ok', text: 'Réponse à ton 2e message.' }] });
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
st = await chatInfo(page);
ok(st.len === 4 && st.msgs[2].mes === U2 && st.msgs[2].user && st.msgs[0].mes === U1 && st.msgs[1].mes === OLD && !st.msgs[3].user && st.msgs[3].mes === 'Réponse à ton 2e message.',
    `Dernier = utilisateur : une réponse est ajoutée APRÈS, rien n’est remplacé (${st.msgs.map((m) => (m.user ? 'U:' : 'B:') + m.mes.slice(0, 18)).join(' | ')})`);
let lg = await mockLog();
ok(lg.length === 1 && JSON.stringify(lg[0].messages).includes('MESSAGE-UTILISATEUR-2'), 'Dernier = utilisateur : le modèle reçoit bien ton message');
await shot2(page, '06-reponse-ajoutee');
// puis le raccourci vise la réponse du bot (le dernier), pas l'utilisateur
await mock({ queue: [{ kind: 'ok', text: 'Réponse refaite (2).' }] });
await sleep(400);
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
st = await chatInfo(page);
ok(st.len === 4 && st.msgs[3].mes === 'Réponse refaite (2).' && st.msgs[2].mes === U2 && st.msgs[2].user, 'Ensuite : le raccourci remplace la réponse du bot, pas le message utilisateur');

// option « se cacher »
await reset({ replyIfUserLast: false }, withUser);
ok(await page.evaluate(() => !document.querySelector('#regenplus-float').classList.contains('regenplus-show')), 'replyIfUserLast=false : bouton caché quand le dernier message est le mien');
await mockClear();
const r0 = await page.evaluate(() => globalThis.regeneratePlus.regenerate({}));
await sleep(600);
ok(r0.ok === false && r0.reason === 'user-last' && (await mockLog()).length === 0 && (await userTexts()).join('|') === `${U1}|${U2}`, `replyIfUserLast=false : regenerate() ne fait rien (${r0.reason})`);
await shot2(page, '07-bouton-cache');

// ---------- 5. gardes-fous : jamais un message utilisateur, même par /regen ou l'API ----------
await reset({}, withUser);
const before = JSON.stringify((await chatInfo(page)).msgs);
const attempts = [];
for (const mode of [undefined, 'replace', 'swipe', 'continue']) {
    for (const idx of [0, 2]) {
        await sleep(350);
        attempts.push(await page.evaluate(([i, m]) => globalThis.regeneratePlus.regenerate({ mesId: i, mode: m }), [idx, mode]));
    }
}
ok(attempts.every((a) => a.ok === false && a.reason === 'user'), `API : regenerate({mesId: <message utilisateur>}) refusé dans tous les modes (${attempts.map((a) => a.reason).join(',')})`);
const toasts = [];
for (const cmd of ['/regen mes=2', '/regen mes=0', '/regen mes=2 swipe', '/regen mes=0 continue', '/regenplus mes=2 replace']) {
    await sleep(350);
    await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach((e) => e.remove()));
    await page.evaluate((c) => SillyTavern.getContext().executeSlashCommandsWithOptions(c), cmd);
    await sleep(400);
    toasts.push(await page.evaluate(() => [...document.querySelectorAll('#toast-container .toast-message')].map((e) => e.textContent).join('|')));
}
await sleep(800);
ok((await mockLog()).length === 0, '/regen mes=<utilisateur> (5 variantes, tous modes) : aucune requête envoyée au modèle');
ok(JSON.stringify((await chatInfo(page)).msgs) === before, '/regen & API : chat strictement inchangé (textes, nombre, swipes)');
ok(toasts.every((t) => /jamais le tien/.test(t)), `Chaque /regen mes=<utilisateur> affiche le toast « jamais le tien » (${toasts.map((t) => t.slice(0, 20)).join(' ; ')})`);
// undo sur un message utilisateur
ok(await page.evaluate(async () => { const c = SillyTavern.getContext(); c.chat[2].extra = { regenplus_prev: { kind: 'replace', mes: 'INJECTE', swipeId: 0 } }; const r = await globalThis.regeneratePlus.undo(2); return r === false && c.chat[2].mes.includes('MESSAGE-UTILISATEUR-2'); }), 'undo(<message utilisateur>) refusé même avec un état d’annulation injecté');
// garde interne : makeFlow ne sait pas viser un message is_user (le chat contient un is_user à la fin, mode replace explicite via mesId impossible) → vérifié ci-dessus
// /regen sans mes avec dernier = bot → bot
await reset({}, [{ is_user: true, mes: U1 }, { mes: OLD }]);
await mock({ queue: [{ kind: 'ok', text: '/regen vise le bot.' }] });
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen'));
await idle(page);
st = await chatInfo(page);
ok(st.msgs[1].mes === '/regen vise le bot.' && st.msgs[0].mes === U1, '/regen (sans mes) : remplace la réponse du bot, jamais le message utilisateur');
// /regen sans mes avec dernier = utilisateur → génère la réponse
await reset({}, withUser);
await mock({ queue: [{ kind: 'ok', text: '/regen répond.' }] });
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen'));
await idle(page);
st = await chatInfo(page);
ok(st.len === 4 && st.msgs[2].mes === U2 && st.msgs[3].mes === '/regen répond.', '/regen (dernier = utilisateur) : réponse ajoutée, message utilisateur intact');

// message système après la réponse du bot : la cible reste le bot
await reset({}, [{ is_user: true, mes: U1 }, { mes: OLD }]);
await page.evaluate(async () => { const c = SillyTavern.getContext(); c.chat.push({ name: 'System', is_user: false, is_system: true, mes: 'Info système', send_date: new Date().toISOString(), extra: {} }); await c.printMessages(); });
await page.waitForTimeout(500);
ok(await page.evaluate(() => { const t = globalThis.regeneratePlus.findTarget(); return t.index === 1 && !t.userLast; }), 'Cible par défaut : dernier message du bot (les messages système sont ignorés)');

// ---------- 6. migration des anciens réglages ----------
const mig = await page.evaluate(() => {
    const store = SillyTavern.getContext().extensionSettings;
    const out = {};
    for (const [name, old] of [['last', { inline: 'last', floating: false }], ['all', { inline: 'all', floating: false }], ['off', { inline: 'off', floating: false }], ['lastfloat', { inline: 'last', floating: true, floatX: 12 }]]) {
        store.regenerate_plus = { ...old };
        const s = globalThis.regeneratePlus.getSettings();
        out[name] = { inline: s.inline, floating: s.floating, migrated: s.migrated110, floatX: s.floatX, mode: s.mode };
    }
    return out;
});
ok(['last', 'all'].every((k) => mig[k].inline === undefined && mig[k].floating === true && mig[k].migrated === true), `Migration : inline last/all → supprimé (= none), bouton raccourci activé pour garder un bouton (${JSON.stringify([mig.last, mig.all])})`);
ok(mig.off.inline === undefined && mig.off.floating === false, 'Migration : inline=off + flottant désactivé → reste désactivé (choix respecté)');
ok(mig.lastfloat.floating === true && mig.lastfloat.floatX === 12, 'Migration : réglages flottant existants conservés');
// persistance réelle : on écrit d'anciens réglages dans settings.json puis on recharge
await page.evaluate(async () => { const c = SillyTavern.getContext(); c.extensionSettings.regenerate_plus = { inline: 'all', floating: false, mode: 'swipe', floatX: 33 }; c.saveSettingsDebounced(); });
await page.waitForTimeout(3000);
await page.reload();
await page.waitForFunction(() => globalThis.regeneratePlus && SillyTavern.getContext().eventSource, null, { timeout: 40000 });
await page.waitForTimeout(2500);
const mig2 = await page.evaluate(() => ({ ...SillyTavern.getContext().extensionSettings.regenerate_plus }));
ok(mig2.inline === undefined && mig2.floating === true && mig2.mode === 'swipe' && mig2.floatX === 33 && mig2.version !== 'x', `Migration après rechargement de la page (settings.json) : ${JSON.stringify({ inline: mig2.inline, floating: mig2.floating, mode: mig2.mode, floatX: mig2.floatX })}`);
ok(await page.evaluate(() => globalThis.regeneratePlus.version) === '1.1.0', 'Version exposée : 1.1.0');
await page.evaluate(() => { SillyTavern.getContext().extensionSettings.regenerate_plus.mode = 'replace'; SillyTavern.getContext().saveSettingsDebounced(); });

// ---------- 7. groupes ----------
await connect(page);
await page.evaluate(async (gid) => { const g = await import('/scripts/group-chats.js'); await g.openGroupById(gid); }, GID);
await page.waitForTimeout(2500);
const gmsgs = [
    { is_user: true, mes: 'Salut tout le monde (U1)' },
    { name: 'Seraphina', mes: 'Seraphina : bienvenue.', original_avatar: SERA },
    { is_user: true, mes: 'Et toi Bob ? (U2)' },
    { name: 'Bob', mes: 'Bob : ravi d’être là.', original_avatar: BOB },
];
ok(await page.evaluate(() => !!SillyTavern.getContext().groupId), 'Groupe ouvert');
await reset({}, gmsgs);
n = await noInline();
ok(n.rows === 0 && n.btnsInChat === 0 && n.labels === 0, 'Groupe : aucun bouton sous les avatars');
await shot2(page, '08-groupe-sans-boutons');
let all = true;
for (let i = 0; i < 3; i++) {
    await mock({ queue: [{ kind: 'ok', text: `Bob refait ${i}.` }] });
    await tap(page, '#regenplus-float .regenplus-regen');
    await idle(page);
    await sleep(400);
    st = await chatInfo(page);
    if (st.msgs.map((m) => m.name).join(',') !== 'User,Seraphina,User,Bob' || st.msgs[3].mes !== `Bob refait ${i}.` || st.msgs[0].mes !== gmsgs[0].mes || st.msgs[2].mes !== gmsgs[2].mes) { all = false; console.log('   ', JSON.stringify(st.msgs)); }
}
ok(all, 'Groupe : le raccourci régénère le dernier message de personnage (Bob) ×3 ; messages utilisateur intacts');
ok(await page.evaluate(() => SillyTavern.getContext().chat[3].original_avatar) === BOB, 'Groupe : avatar d’origine conservé');
await shot2(page, '09-groupe-bob-regenere');
// groupe, dernier message = utilisateur
await reset({}, [...gmsgs, { is_user: true, mes: 'Dernier message utilisateur du groupe (U3)' }]);
await mock({ queue: [{ kind: 'ok', text: 'Quelqu’un répond au groupe.' }] });
const gb = (await chatInfo(page)).msgs.map((m) => m.mes).join('|');
await tap(page, '#regenplus-float .regenplus-regen');
await idle(page);
await sleep(500);
st = await chatInfo(page);
ok(st.len === 6 && st.msgs.slice(0, 5).map((m) => m.mes).join('|') === gb && !st.msgs[5].user, `Groupe, dernier = utilisateur : réponse ajoutée, 5 premiers messages inchangés (len=${st.len}, ${st.msgs[5]?.name})`);
await shot2(page, '10-groupe-reponse-ajoutee');
await reset({}, [...gmsgs, { is_user: true, mes: 'U3' }]);
await mockClear();
const gb2 = JSON.stringify((await chatInfo(page)).msgs);
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen mes=4'));
await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/regen mes=0'));
await sleep(1000);
ok((await mockLog()).length === 0 && JSON.stringify((await chatInfo(page)).msgs) === gb2, 'Groupe : /regen mes=<utilisateur> refusé, chat inchangé');

const real = errs.filter((e) => !/Extension update failed|image-metadata|ImageMetadata|Error loading folders|DOM element is not valid/.test(e));
ok(real.length === 0, `Aucune erreur console/page (${real.length}) ${real.join(' ; ').slice(0, 400)}`);
await browser.close();
