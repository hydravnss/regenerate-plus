// Constats sur le « Régénérer » NATIF de SillyTavern (sans l'extension), pour documenter les points fragiles.
import { boot, connect, selectChar, seedChat, chatInfo, idle, mock, mockClear, setSettings, ok, sleep } from './lib.mjs';
const GID = process.env.GROUP_ID || '1790999000001';
const SERA = 'default_Seraphina.png', BOB = 'Bob.png';
const { browser, page } = await boot();
await connect(page);
await setSettings(page, { enabled: false });
const native = () => page.evaluate(() => { $('#option_regenerate').trigger('click'); });

// A. Solo : erreur 500 → l'ancien message est supprimé AVANT la génération
await selectChar(page);
await mockClear();
await seedChat(page, [{ is_user: true, mes: 'Bonjour' }, { mes: 'Ma belle réponse' }]);
await mock({ queue: ['error'] });
await native();
await sleep(2500);
let st = await chatInfo(page);
console.log(`A. natif + erreur 500 : ${st.len} message(s) restant(s) →`, st.msgs.map((m) => m.mes));

// B. Solo : is_send_press bloqué → clic natif sans aucun effet ni message
await mockClear();
await seedChat(page, [{ is_user: true, mes: 'Bonjour' }, { mes: 'Ma belle réponse' }]);
await page.evaluate(async () => (await import('/script.js')).setSendButtonState(true));
await native();
await sleep(1500);
st = await chatInfo(page);
const toasts = await page.evaluate(() => document.querySelectorAll('#toast-container .toast').length);
console.log(`B. natif + is_send_press bloqué : texte = "${st.msgs[1].mes}", toasts affichés = ${toasts} (aucune réaction)`);
await page.evaluate(async () => { const s = await import('/script.js'); s.setSendButtonState(false); s.activateSendButtons(); });

// C. Solo : message d'accueil — le swipe natif boucle au lieu de générer
await mockClear();
await seedChat(page, [{ mes: 'Accueil' }]);
await page.evaluate(async () => { const c = SillyTavern.getContext(); const m = c.chat[0]; m.swipes = ['Accueil', 'Accueil alt']; m.swipe_info = [{ extra: {} }, { extra: {} }]; m.swipe_id = 1; m.mes = 'Accueil alt'; await c.printMessages(); });
await page.evaluate(() => $('.last_mes .swipe_right').trigger('click'));
await sleep(2500);
const logC = await (await fetch('http://127.0.0.1:9100/_log')).json();
st = await chatInfo(page);
console.log(`C. swipe natif droite depuis le dernier swipe de l'accueil : swipe_id=${st.msgs[0].sid}, swipes=${st.msgs[0].swipes}, requêtes envoyées=${logC.length} (boucle au lieu de générer)`);

// D. Groupe : qui répond ? + brouillon
await page.evaluate(async (gid) => { const g = await import('/scripts/group-chats.js'); await g.openGroupById(gid); }, GID);
await page.waitForTimeout(2500);
const msgs = [
    { is_user: true, mes: 'Salut tout le monde' },
    { name: 'Seraphina', mes: 'Seraphina : bienvenue.', original_avatar: SERA },
    { is_user: true, mes: 'Et toi Bob ?' },
    { name: 'Bob', mes: 'Bob : ravi d’être là.', original_avatar: BOB },
];
const who = [];
for (let i = 0; i < 8; i++) {
    await mockClear();
    await seedChat(page, msgs);
    await native();
    await idle(page, 20000);
    await sleep(800);
    st = await chatInfo(page);
    who.push(st.msgs.slice(3).map((m) => m.name).join('+') || '(rien)');
}
console.log('D1. groupe, natif, on régénère le message de Bob, 8 essais → répondent :', who.join(' / '));

await mockClear();
await seedChat(page, msgs);
await page.fill('#send_textarea', 'mon brouillon important');
await native();
await idle(page, 20000);
await sleep(800);
st = await chatInfo(page);
console.log(`D2. groupe, natif, brouillon dans le champ : messages = ${JSON.stringify(st.msgs.map((m) => m.name + ': ' + m.mes.slice(0, 30)))} ; champ = "${await page.inputValue('#send_textarea')}"`);
await browser.close();
