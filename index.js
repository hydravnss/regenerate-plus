/**
 * Regenerate Plus — extension SillyTavern
 * Un « Régénérer » fiable, pensé pour iPhone Safari et les chats de groupe.
 *
 * Vanilla ES module, aucune étape de build.
 * Chemin attendu : /scripts/extensions/third-party/regenerate-plus/index.js
 *
 * Imports en « namespace » : si un export manque dans une version de SillyTavern,
 * l'extension ne plante pas au chargement (la valeur vaut simplement undefined).
 */
import * as stScript from '../../../../script.js';
import * as stExt from '../../../extensions.js';
import * as stGroups from '../../../group-chats.js';

const MODULE_NAME = 'regenerate_plus';
const LOG = '[Regenerate Plus]';
const TITLE = 'Regenerate Plus';
const PROMPT_KEY = 'regenerate_plus_instruction';
const TAIL_KEY = 'regenerate_plus_tail_backup';

const defaultSettings = Object.freeze({
    enabled: true,
    mode: 'replace', // replace | swipe | continue
    inline: 'last', // last | all | off
    floating: false,
    floatX: 88,
    floatY: 70,
    floatSize: 56,
    interceptBuiltin: false,
    hideBuiltin: false,
    abortFirst: true,
    debounceMs: 700,
    retries: 2,
    retryDelay: 1.5,
    minChars: 2,
    stuckDetect: true,
    stuckSeconds: 60,
    autoUnblock: false,
    undo: true,
    keepOthers: true,
    allowOld: true,
    usePrompt: false,
    promptText: 'Réécris ta dernière réponse différemment : autre formulation, autre angle, sans reprendre les mêmes phrases.\nVersion précédente à éviter :\n{{old}}',
    promptRole: 'system', // system | user
    toasts: true,
});

/* ------------------------------------------------------------------ utilitaires */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE_LABEL = { replace: 'Remplacer', swipe: 'Nouveau swipe', continue: 'Continuer', reply: 'Répondre' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function ctx() {
    try { if (globalThis.SillyTavern?.getContext) return globalThis.SillyTavern.getContext(); } catch { /* ignore */ }
    return stExt.getContext();
}

function getSettings() {
    const store = stExt.extension_settings;
    if (!store[MODULE_NAME] || typeof store[MODULE_NAME] !== 'object') store[MODULE_NAME] = {};
    const s = store[MODULE_NAME];
    for (const [k, v] of Object.entries(defaultSettings)) if (s[k] === undefined) s[k] = v;
    return s;
}
const S = () => getSettings();

function save() {
    try { stScript.saveSettingsDebounced(); } catch (e) { console.warn(LOG, 'sauvegarde des réglages impossible', e); }
}

function notify(type, message, { force = false, title = TITLE, opts } = {}) {
    try {
        if (!force && !S().toasts) return;
        const t = globalThis.toastr;
        if (t && typeof t[type] === 'function') t[type](message, title, opts);
    } catch { /* ne jamais casser le chat */ }
}

const isGen = () => {
    try {
        if (typeof stScript.isGenerating === 'function') return !!stScript.isGenerating();
        return !!(stScript.is_send_press || stGroups.is_group_generating);
    } catch { return false; }
};
const groupFlagStuck = () => { try { return !!stGroups.is_group_generating; } catch { return false; } };
const swipeStateNow = () => { try { return ctx().swipe?.state?.() ?? 'none'; } catch { return 'none'; } };
const chatOpen = () => { const c = ctx(); return (c.characterId !== undefined || !!c.groupId) && c.chat.length > 0; };
const isBotMessage = (m) => !!m && !m.is_user && !m.is_system && !m.extra?.isSmallSys;

/** Texte « valable » ? (au moins N lettres/chiffres, hors « ... » du chargement) */
function textOk(text) {
    const t = String(text ?? '').trim();
    if (!t || t === '...') return false;
    const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
    return letters.length >= clamp(Number(S().minChars) || 1, 1, 50);
}

/* ------------------------------------------------------------------ état global */

/** Exécution en cours : { cancelled, userStopped, wake, mesId, mode } */
let run = null;
let starting = false; // entre le tap et le début réel (arrêt d'une génération précédente)
let lastTap = 0;
let moveMode = false;
let reopenToggles = [];

/* ------------------------------------------------------------------ détection de blocage */

let lastActivity = Date.now();
let genSince = 0;
let autoUnblockDone = false;
const markActivity = () => { lastActivity = Date.now(); };

function startWatchdog() {
    const es = stScript.eventSource;
    const et = stScript.event_types || {};
    for (const name of ['GENERATION_STARTED', 'STREAM_TOKEN_RECEIVED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'GROUP_MEMBER_DRAFTED', 'MESSAGE_SWIPED', 'GENERATION_AFTER_COMMANDS']) {
        if (et[name]) es.on(et[name], markActivity);
    }
    // Fin d'une requête de génération (réponse reçue) = activité réseau
    try {
        const po = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                if (/generate|chat-completions|text-completions|novelai|kobold|horde|openrouter/i.test(e.name)) markActivity();
            }
        });
        po.observe({ type: 'resource', buffered: false });
    } catch { /* PerformanceObserver indisponible : les événements suffisent */ }
    setInterval(watchdogTick, 1000);
}

function watchdogTick() {
    try {
        const s = S();
        const gen = isGen() || swipeStateNow() === 'swiping';
        const now = Date.now();
        if (!gen) {
            genSince = 0;
            autoUnblockDone = false;
            showUnlockBanner(false);
            return;
        }
        if (!genSince) { genSince = now; lastActivity = now; }
        if (!s.enabled || !s.stuckDetect) { showUnlockBanner(false); return; }
        const idle = (now - Math.max(lastActivity, genSince)) / 1000;
        if (idle >= clamp(Number(s.stuckSeconds) || 60, 5, 600)) {
            showUnlockBanner(true, Math.round(idle));
            if (s.autoUnblock && !autoUnblockDone) {
                autoUnblockDone = true;
                notify('warning', 'Génération bloquée : déblocage automatique.', { force: true });
                unblock({ quiet: true });
            }
        } else {
            showUnlockBanner(false);
        }
    } catch (e) { console.warn(LOG, 'watchdog', e); }
}

function ensureBanner() {
    let el = document.getElementById('regenplus-unlock');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'regenplus-unlock';
    el.innerHTML = '<span class="regenplus-unlock-text"></span>'
        + '<button type="button" class="regenplus-btn regenplus-unlock-go" data-act="unblock">🔓 Débloquer</button>'
        + '<button type="button" class="regenplus-unlock-close" data-act="dismiss" aria-label="Fermer">✕</button>';
    document.body.appendChild(el);
    return el;
}
function ensureStatus() {
    let el = document.getElementById('regenplus-status');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'regenplus-status';
    el.innerHTML = '<span class="regenplus-ico regenplus-spin">🔄</span><span class="regenplus-status-text"></span>'
        + '<button type="button" class="regenplus-btn regenplus-status-stop" data-act="unblock">⏹ Stop</button>';
    document.body.appendChild(el);
    return el;
}
function refreshStatus() {
    const el = ensureStatus();
    const on = !!(run || starting) && S().enabled;
    el.classList.toggle('regenplus-show', on);
    if (on) el.querySelector('.regenplus-status-text').textContent = `Régénération (${MODE_LABEL[run?.mode] || '…'})…`;
}
let bannerDismissedFor = 0;
function showUnlockBanner(show, idle = 0) {
    const el = ensureBanner();
    if (show && bannerDismissedFor && Date.now() - bannerDismissedFor < 30000) show = false;
    el.classList.toggle('regenplus-show', !!show);
    if (show) el.querySelector('.regenplus-unlock-text').textContent = `⚠️ Aucune activité depuis ${idle} s`;
}

/** Arrête la génération en cours et remet l'interface « envoi » à zéro (sans toucher à l'exécution Regenerate Plus). */
async function forceIdle() {
    const c = ctx();
    try { c.stopGeneration?.(); } catch (e) { console.warn(LOG, 'stopGeneration', e); }
    await sleep(350);
    let forced = false;
    if (isGen()) {
        try { stScript.setSendButtonState?.(false); } catch { /* ignore */ }
        try { stScript.activateSendButtons?.(); } catch { /* ignore */ }
        forced = true;
    }
    try { delete document.body.dataset.generating; delete document.body.dataset.swiping; } catch { /* ignore */ }
    try { stScript.hideStopButton?.(); } catch { /* ignore */ }
    clearInstruction();
    const repaired = await repairSwipeState(true);
    if (groupFlagStuck()) {
        await sleep(1200);
        if (groupFlagStuck()) {
            notify('warning', 'Le groupe reste en état « génération ». Touche ce message pour recharger la page.', {
                force: true, opts: { timeOut: 0, extendedTimeOut: 0, closeButton: true, onclick: () => location.reload() },
            });
        }
    }
    try { stScript.showSwipeButtons?.(); } catch { /* ignore */ }
    genSince = 0; lastActivity = Date.now();
    showUnlockBanner(false);
    return { forced, repaired };
}

/** « Débloquer » : annule la régénération en cours, arrête tout et remet l'interface à zéro. */
async function unblock({ quiet = false } = {}) {
    if (run) { run.cancelled = true; run.userStopped = true; try { run.wake?.(); } catch { /* ignore */ } }
    const r = await forceIdle();
    refreshAll();
    if (!quiet) notify('success', r.forced || r.repaired ? 'Interface débloquée.' : 'Génération arrêtée.', { force: true });
    return r;
}

/**
 * Le swipe natif peut rester en état « swiping » (ex. échec d'animation) : plus aucun envoi ni swipe ne passe.
 * Un swipe de type « back » vers le swipe courant remet l'état à zéro (endSwipe).
 */
async function repairSwipeState(force = false) {
    try {
        const c = ctx();
        const st = () => swipeStateNow();
        if (st() !== 'swiping') return false;
        if (!force) {
            for (let i = 0; i < 8 && st() === 'swiping'; i++) await sleep(250); // animation légitime en cours ?
            if (st() !== 'swiping') return false;
        }
        const i = c.chat.length - 1;
        const m = c.chat[i];
        if (m && isBotMessage(m)) {
            await c.swipe.to(null, 'left', { source: 'back', message: m, forceMesId: i, forceSwipeId: Number(m.swipe_id ?? 0) });
        }
        try { delete document.body.dataset.swiping; } catch { /* ignore */ }
        return st() !== 'swiping';
    } catch (e) {
        console.warn(LOG, 'réparation du swipe', e);
        return false;
    }
}

/* ------------------------------------------------------------------ instruction « quiet » */

function setInstruction(oldText) {
    const s = S();
    if (!s.usePrompt || !String(s.promptText || '').trim()) return false;
    let text = String(s.promptText);
    text = text.replaceAll('{{old}}', String(oldText ?? '').slice(0, 2000));
    try {
        const roles = stScript.extension_prompt_roles || { SYSTEM: 0, USER: 1 };
        const types = stScript.extension_prompt_types || { IN_CHAT: 1 };
        stScript.setExtensionPrompt(PROMPT_KEY, text, types.IN_CHAT, 0, false, s.promptRole === 'user' ? roles.USER : roles.SYSTEM);
        return true;
    } catch (e) { console.warn(LOG, 'instruction non injectée', e); return false; }
}
function clearInstruction() {
    try {
        const types = stScript.extension_prompt_types || { IN_CHAT: 1 };
        stScript.setExtensionPrompt(PROMPT_KEY, '', types.IN_CHAT, 0);
    } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ messages plus anciens : « queue » détachée */

/**
 * Pour régénérer un message qui n'est pas le dernier, on retire temporairement les messages suivants du chat
 * (le contexte est alors « jusqu'à ce message »), puis on les remet. Une copie est gardée dans localStorage
 * au cas où la page serait fermée pendant ce temps.
 */
function detachTail(N) {
    const c = ctx();
    if (N >= c.chat.length - 1) return null;
    const chatId = c.getCurrentChatId?.() ?? c.chatId;
    const msgs = c.chat.splice(N + 1);
    const els = $('#chat > .mes').filter((_, e) => Number(e.getAttribute('mesid')) > N).detach();
    try { localStorage.setItem(TAIL_KEY, JSON.stringify({ chatId, index: N, msgs, date: Date.now() })); } catch { /* quota */ }
    return { msgs, els, index: N, chatId };
}

async function restoreTail(tail) {
    if (!tail) return;
    const c = ctx();
    const chatId = c.getCurrentChatId?.() ?? c.chatId;
    if (chatId !== tail.chatId) {
        console.warn(LOG, 'le chat a changé pendant la régénération : la fin du chat reste dans la sauvegarde locale et sera remise à l’ouverture');
        return;
    }
    if (c.chat.length !== tail.index + 1) {
        console.warn(LOG, 'longueur du chat inattendue au moment de remettre la fin du chat', c.chat.length, tail.index + 1);
        return;
    }
    c.chat.push(...tail.msgs);
    $('#chat').append(tail.els);
    $('#chat > .mes').removeClass('last_mes').last().addClass('last_mes');
    try { localStorage.removeItem(TAIL_KEY); } catch { /* ignore */ }
    try { c.swipe?.refresh?.(); } catch { /* ignore */ }
    try { await c.saveChat(); } catch (e) { console.warn(LOG, 'sauvegarde après restauration', e); }
}

/** Restaure une fin de chat si la page a été fermée/rechargée pendant une régénération d'un ancien message. */
async function recoverTailBackup() {
    let rec;
    try { rec = JSON.parse(localStorage.getItem(TAIL_KEY) || 'null'); } catch { rec = null; }
    if (!rec) return;
    const c = ctx();
    const chatId = c.getCurrentChatId?.() ?? c.chatId;
    if (!chatId || rec.chatId !== chatId) return;
    if (run) return;
    if (c.chat.length === rec.index + 1 && Array.isArray(rec.msgs) && rec.msgs.length) {
        c.chat.push(...rec.msgs);
        try { await c.saveChat(); } catch { /* ignore */ }
        try { await c.printMessages?.(); } catch { /* ignore */ }
        notify('warning', `${rec.msgs.length} message(s) récupéré(s) après une régénération interrompue.`, { force: true });
    }
    try { localStorage.removeItem(TAIL_KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ résolution cible / locuteur */

function findTarget() {
    const chat = ctx().chat;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        return i;
    }
    return -1;
}

function speakerIndex(msg) {
    const chars = ctx().characters || [];
    let idx = -1;
    if (msg.original_avatar) idx = chars.findIndex((x) => x.avatar === msg.original_avatar);
    if (idx < 0) {
        const group = (ctx().groups || []).find((g) => g.id == ctx().groupId);
        const members = group?.members || [];
        const byName = chars.map((x, i) => ({ x, i })).filter(({ x }) => x.name === msg.name);
        idx = (byName.find(({ x }) => members.includes(x.avatar)) || byName[0])?.i ?? -1;
    }
    return idx;
}

/* ------------------------------------------------------------------ flux de régénération */

function cancellableSleep(ms) {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        if (run) run.wake = () => { clearTimeout(t); resolve(); };
    });
}

async function raceCancel(p) {
    let cancelPromise = new Promise((resolve) => { run.cancelHook = () => resolve('__cancel__'); });
    const prev = run.wake;
    run.wake = () => { run.cancelHook?.(); prev?.(); };
    const res = await Promise.race([Promise.resolve(p).then((v) => ({ v }), (e) => ({ e })), cancelPromise]);
    run.wake = prev;
    if (res === '__cancel__') return { cancelled: true };
    if (res.e) throw res.e;
    return { v: res.v };
}

function makeFlow(mode, N, target) {
    const c = ctx();
    const s = S();
    const isGroup = !!c.groupId;
    const chid = isGroup ? speakerIndex(target) : undefined;
    const gen = (type, opts) => (stScript.Generate || c.generate)(type, opts);
    const prevText = String(target.mes ?? '');

    if (isGroup && mode !== 'reply' && chid < 0) {
        throw new Error('Impossible de retrouver le personnage de ce message dans la liste des personnages.');
    }

    /* ---- Remplacer ---- */
    if (mode === 'replace') {
        const old = target;
        const ensureOld = async () => {
            const chat = ctx().chat;
            if (chat.length === N + 1 && chat[N] !== old) await stScript.deleteLastMessage();
            if (chat.length === N) {
                chat.push(old);
                stScript.addOneMessage(old, { forceId: N, scroll: false });
            }
        };
        return {
            prevText,
            async attempt() {
                await ensureOld();
                setInstruction(prevText);
                if (isGroup) {
                    await stScript.deleteLastMessage();
                    return gen('regenerate', { force_chid: chid });
                }
                stScript.setSendButtonState?.(true); // comme le bouton natif
                return gen('regenerate');
            },
            check() {
                const m = ctx().chat[N];
                return !!m && m !== old && isBotMessage(m) && textOk(m.mes);
            },
            hasPartial() { const m = ctx().chat[N]; return !!m && m !== old && String(m.mes || '').trim().length > 0 && String(m.mes).trim() !== '...'; },
            async cleanupBetween() { await ensureOld(); },
            async rollback() { await ensureOld(); },
            async commit() {
                const chat = ctx().chat;
                const nm = chat[N];
                if (!nm) return;
                nm.extra = nm.extra || {};
                if (s.keepOthers && Array.isArray(old.swipes) && old.swipes.length > 1) {
                    const sid = clamp(Number(old.swipe_id ?? 0), 0, old.swipes.length - 1);
                    nm.swipes = old.swipes.slice();
                    nm.swipes[sid] = nm.mes;
                    nm.swipe_info = Array.isArray(old.swipe_info) ? old.swipe_info.slice() : [];
                    nm.swipe_info[sid] = { send_date: nm.send_date, gen_started: nm.gen_started, gen_finished: nm.gen_finished, extra: structuredClone(nm.extra) };
                    nm.swipe_id = sid;
                }
                if (s.undo) {
                    nm.extra.regenplus_prev = {
                        kind: 'replace',
                        mes: prevText,
                        reasoning: old.extra?.reasoning ?? '',
                        send_date: old.send_date,
                        gen_started: old.gen_started,
                        gen_finished: old.gen_finished,
                        swipeId: Number(nm.swipe_id ?? 0),
                    };
                    if (Array.isArray(nm.swipe_info) && nm.swipe_info[nm.swipe_id]) nm.swipe_info[nm.swipe_id].extra = structuredClone(nm.extra);
                }
                try { stScript.updateMessageBlock(N, nm); } catch { /* ignore */ }
            },
        };
    }

    /* ---- Nouveau swipe ---- */
    if (mode === 'swipe') {
        const m = target;
        const prevId = Number(m.swipe_id ?? 0);
        const prevLen = Array.isArray(m.swipes) ? m.swipes.length : 1;
        const origOver = m.extra?.overswipe_behavior;
        const restoreOver = () => {
            if (!m.extra) return;
            if (origOver === undefined) delete m.extra.overswipe_behavior; else m.extra.overswipe_behavior = origOver;
        };
        const goBack = async () => {
            if (Array.isArray(m.swipes) && Number(m.swipe_id ?? 0) !== prevId && prevId < m.swipes.length) {
                await c.swipe.to(null, 'left', { source: 'back', message: m, forceMesId: N, forceSwipeId: prevId });
            }
        };
        const dropExtra = async () => {
            while (Array.isArray(m.swipes) && m.swipes.length > prevLen) {
                const idx = m.swipes.length - 1;
                if (m.swipes.length <= 1) break;
                await stScript.deleteSwipe(idx, N);
            }
            await goBack();
        };
        return {
            prevText,
            async attempt() {
                if (Array.isArray(m.swipes) && m.swipes.length > prevLen) await dropExtra();
                setInstruction(prevText);
                m.extra = m.extra || {};
                m.extra.overswipe_behavior = 'regenerate'; // force la génération même sur l'accueil / un swipe non final
                try {
                    return await c.swipe.to(null, 'right', {
                        message: m, forceMesId: N, forceSwipeId: Array.isArray(m.swipes) ? m.swipes.length : 1, source: 'slash_command',
                    });
                } finally { restoreOver(); }
            },
            check() {
                return Array.isArray(m.swipes) && m.swipes.length === prevLen + 1 && textOk(m.swipes[m.swipes.length - 1]) && ctx().chat[N] === m;
            },
            hasPartial() { return Array.isArray(m.swipes) && m.swipes.length > prevLen && String(m.swipes[m.swipes.length - 1] || '').trim().length > 0; },
            async cleanupBetween() { await dropExtra(); },
            async rollback() { await dropExtra(); },
            async commit() {
                m.extra = m.extra || {};
                if (s.undo) {
                    m.extra.regenplus_prev = { kind: 'swipe', swipeId: Number(m.swipe_id ?? 0), back: prevId, mes: prevText };
                    if (Array.isArray(m.swipe_info) && m.swipe_info[m.swipe_id]) m.swipe_info[m.swipe_id].extra = structuredClone(m.extra);
                }
            },
        };
    }

    /* ---- Continuer ---- */
    if (mode === 'continue') {
        const m = target;
        const restoreText = () => {
            m.mes = prevText;
            if (Array.isArray(m.swipes)) m.swipes[Number(m.swipe_id ?? 0)] = prevText;
            try { stScript.updateMessageBlock(N, m); } catch { /* ignore */ }
        };
        return {
            prevText,
            async attempt() {
                setInstruction(prevText);
                stScript.setSendButtonState?.(true);
                return gen('continue');
            },
            check() { const cur = ctx().chat[N]; return cur === m && String(cur.mes || '').trim().length > prevText.trim().length + 1; },
            hasPartial() { return String(m.mes || '').length > prevText.length; },
            async cleanupBetween() { if (m.mes !== prevText) restoreText(); },
            async rollback() { if (m.mes !== prevText) restoreText(); },
            async commit() {
                m.extra = m.extra || {};
                if (s.undo) {
                    m.extra.regenplus_prev = { kind: 'replace', mes: prevText, reasoning: m.extra.reasoning ?? '', swipeId: Number(m.swipe_id ?? 0) };
                    if (Array.isArray(m.swipe_info) && m.swipe_info[m.swipe_id]) m.swipe_info[m.swipe_id].extra = structuredClone(m.extra);
                }
            },
        };
    }

    /* ---- Répondre (le dernier message est celui de l'utilisateur) ---- */
    const before = c.chat.length;
    return {
        prevText: '',
        async attempt() {
            setInstruction('');
            if (isGroup) return gen('normal');
            return gen('normal');
        },
        check() { const ch = ctx().chat; return ch.length > before && isBotMessage(ch[ch.length - 1]) && textOk(ch[ch.length - 1].mes); },
        hasPartial() { const ch = ctx().chat; return ch.length > before && String(ch[ch.length - 1]?.mes || '').trim().length > 0; },
        async cleanupBetween() { while (ctx().chat.length > before) await stScript.deleteLastMessage(); },
        async rollback() { while (ctx().chat.length > before) await stScript.deleteLastMessage(); },
        async commit() { /* rien à annuler */ },
    };
}

/**
 * Point d'entrée unique (boutons, menu, /regen).
 * @param {{mesId?:number, mode?:string, source?:string}} opts
 */
async function regenerate(opts = {}) {
    const s = S();
    if (!s.enabled) return { ok: false, reason: 'disabled' };
    const now = Date.now();
    if (now - lastTap < clamp(Number(s.debounceMs) || 0, 0, 5000)) return { ok: false, reason: 'debounce' };
    lastTap = now;
    if (run) { notify('info', 'Une régénération est déjà en cours…'); return { ok: false, reason: 'busy' }; }

    const c = ctx();
    if (!chatOpen()) { notify('warning', 'Ouvre d’abord une discussion.', { force: true }); return { ok: false, reason: 'nochat' }; }
    if (document.querySelector('#curEditTextarea')) {
        notify('warning', 'Termine d’abord l’édition du message avant de régénérer.', { force: true });
        return { ok: false, reason: 'editing' };
    }

    let N = Number.isInteger(opts.mesId) ? opts.mesId : findTarget();
    const msg = c.chat[N];
    if (!msg) { notify('warning', 'Aucun message à régénérer.', { force: true }); return { ok: false, reason: 'nomsg' }; }

    let mode = opts.mode || s.mode;
    if (msg.is_user) {
        if (N !== c.chat.length - 1) { notify('warning', 'On ne régénère que les messages du bot.', { force: true }); return { ok: false, reason: 'user' }; }
        mode = 'reply';
    } else if (msg.is_system || msg.extra?.isSmallSys) {
        notify('warning', 'Ce message système ne peut pas être régénéré.', { force: true });
        return { ok: false, reason: 'system' };
    }
    const isLast = N === c.chat.length - 1;
    if (!isLast && !s.allowOld) {
        notify('warning', 'Régénérer un ancien message est désactivé dans les réglages.', { force: true });
        return { ok: false, reason: 'old' };
    }

    // Génération déjà en cours (ou bloquée) : on l'abandonne d'abord
    starting = true;
    document.body.classList.add('regenplus-running');
    refreshAll();
    if (isGen() || swipeStateNow() === 'swiping') {
        if (!s.abortFirst) {
            starting = false;
            document.body.classList.remove('regenplus-running');
            refreshAll();
            notify('warning', 'Une génération est déjà en cours. Attends la fin ou utilise « Débloquer ».', { force: true });
            return { ok: false, reason: 'generating' };
        }
        try { await forceIdle(); } catch (e) { console.warn(LOG, 'forceIdle', e); }
        if (isGen()) {
            starting = false;
            document.body.classList.remove('regenplus-running');
            refreshAll();
            notify('error', 'Impossible d’arrêter la génération en cours. Utilise « Débloquer » ou recharge la page.', { force: true });
            return { ok: false, reason: 'stuck' };
        }
    } else if (swipeStateNow() !== 'none') {
        try { await repairSwipeState(); } catch (e) { console.warn(LOG, 'repairSwipeState', e); }
    }

    run = { cancelled: false, userStopped: false, wake: null, mesId: N, mode };
    starting = false;
    refreshAll();

    const draftEl = document.getElementById('send_textarea');
    const draft = draftEl ? draftEl.value : '';
    let tail = null;
    let flow = null;
    let ok = false;
    let lastError = null;
    const onStop = () => { if (run) run.userStopped = true; };
    const es = stScript.eventSource;
    const stopEvt = stScript.event_types?.GENERATION_STOPPED;
    if (stopEvt) es.on(stopEvt, onStop);

    try {
        // Le brouillon du champ de saisie serait envoyé comme message par le Générer de groupe natif : on le met de côté.
        if (draftEl && draft) { draftEl.value = ''; draftEl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (!isLast) tail = detachTail(N);
        flow = makeFlow(mode, N, c.chat[N]);

        const total = 1 + clamp(Number(s.retries) || 0, 0, 10);
        for (let attempt = 1; attempt <= total; attempt++) {
            if (run.cancelled) break;
            lastError = null;
            markActivity();
            try {
                await raceCancel(flow.attempt());
            } catch (e) {
                lastError = e;
                console.warn(LOG, `tentative ${attempt} en erreur`, e);
            }
            // laisse ST finir de sauvegarder / débloquer l'UI
            await sleep(60);
            if (run.cancelled || run.userStopped) {
                if (flow.hasPartial()) ok = true;
                break;
            }
            if (flow.check()) { ok = true; break; }
            if (attempt < total) {
                await flow.cleanupBetween();
                const delay = clamp(Number(s.retryDelay) || 0, 0, 30);
                notify('warning', `${lastError ? 'Erreur' : 'Réponse vide'} — nouvelle tentative ${attempt}/${total - 1} dans ${delay} s…`);
                await cancellableSleep(delay * 1000);
                if (run.cancelled) break;
                if (isGen()) await forceIdle();
            }
        }

        if (ok) {
            await flow.commit();
            if (flow.hasPartial() && (run.userStopped || run.cancelled) && !flow.check()) notify('info', 'Génération interrompue : texte partiel conservé.');
        } else {
            await flow.rollback();
            if (run.cancelled || run.userStopped) {
                notify('info', 'Régénération annulée' + (mode === 'replace' ? ' : ancien texte conservé.' : '.'), { force: true });
            } else {
                const why = lastError ? (lastError.message || String(lastError)) : 'réponse vide';
                notify('error', `Échec de la régénération (${why}) après ${total} essai(s).${mode === 'replace' ? ' Ancien texte restauré.' : ''}`, { force: true });
            }
        }
    } catch (e) {
        lastError = e;
        console.error(LOG, 'erreur inattendue', e);
        try { await flow?.rollback(); } catch (e2) { console.error(LOG, 'rollback impossible', e2); }
        notify('error', `Régénération impossible : ${e.message || e}`, { force: true });
    } finally {
        if (stopEvt) es.off?.(stopEvt, onStop);
        clearInstruction();
        try { await restoreTail(tail); } catch (e) { console.error(LOG, 'restauration de la fin du chat', e); }
        const draftNow = document.getElementById('send_textarea');
        if (draftNow && draft && !draftNow.value) { draftNow.value = draft; draftNow.dispatchEvent(new Event('input', { bubbles: true })); }
        // sécurité : ne jamais laisser l'UI en « génération » à cause de nous
        if (isGen() && !groupFlagStuck()) {
            try { stScript.setSendButtonState?.(false); stScript.activateSendButtons?.(); } catch { /* ignore */ }
        }
        try { stScript.showSwipeButtons?.(); } catch { /* ignore */ }
        run = null;
        document.body.classList.remove('regenplus-running');
        refreshAll();
    }
    return { ok, mode, mesId: N };
}

/* ------------------------------------------------------------------ annulation (restauration de l'ancien texte) */

function hasUndo(m) {
    const p = m?.extra?.regenplus_prev;
    if (!p) return false;
    return Number(m.swipe_id ?? 0) === Number(p.swipeId ?? 0);
}

async function undo(mesId) {
    const c = ctx();
    const m = c.chat[mesId];
    if (!m || !hasUndo(m)) { notify('info', 'Rien à annuler pour ce message.', { force: true }); return false; }
    if (isGen() || run) { notify('warning', 'Attends la fin de la génération pour annuler.', { force: true }); return false; }
    const p = m.extra.regenplus_prev;
    try {
        if (p.kind === 'swipe' && Array.isArray(m.swipes) && m.swipes.length > 1) {
            await stScript.deleteSwipe(p.swipeId, mesId);
            if (Number(m.swipe_id ?? 0) !== p.back && p.back < m.swipes.length) {
                await c.swipe.to(null, 'left', { source: 'back', message: m, forceMesId: mesId, forceSwipeId: p.back });
            }
            if (m.extra) delete m.extra.regenplus_prev;
        } else {
            const sid = Number(m.swipe_id ?? 0);
            m.mes = p.mes;
            if (Array.isArray(m.swipes)) m.swipes[sid] = p.mes;
            m.extra.reasoning = p.reasoning ?? m.extra.reasoning;
            if (p.send_date) m.send_date = p.send_date;
            if (p.gen_started) m.gen_started = p.gen_started;
            if (p.gen_finished) m.gen_finished = p.gen_finished;
            delete m.extra.regenplus_prev;
            if (Array.isArray(m.swipe_info) && m.swipe_info[sid]) {
                m.swipe_info[sid].extra = structuredClone(m.extra);
                m.swipe_info[sid].send_date = m.send_date;
            }
            stScript.updateMessageBlock(mesId, m);
        }
        await c.saveChat();
        refreshAll();
        notify('success', 'Ancienne réponse restaurée.', { force: true });
        return true;
    } catch (e) {
        console.error(LOG, 'annulation impossible', e);
        notify('error', `Annulation impossible : ${e.message || e}`, { force: true });
        return false;
    }
}

/* ------------------------------------------------------------------ boutons dans les messages */

function buildRow() {
    const row = document.createElement('div');
    row.className = 'regenplus-row';
    row.innerHTML = '<button type="button" class="regenplus-btn regenplus-regen" data-act="regen"><span class="regenplus-ico">🔄</span><span class="regenplus-lbl">Régénérer</span></button>'
        + '<button type="button" class="regenplus-btn regenplus-undo" data-act="undo" hidden><span class="regenplus-ico">↩️</span><span class="regenplus-lbl">Annuler</span></button>';
    return row;
}

let inlineTimer = null;
function scheduleInline() {
    if (inlineTimer) return;
    inlineTimer = setTimeout(() => { inlineTimer = null; try { refreshInline(); } catch (e) { console.warn(LOG, 'inline', e); } }, 60);
}

function refreshInline() {
    const s = S();
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    const chat = ctx().chat;
    const lastIdx = chat.length - 1;
    chatEl.querySelectorAll(':scope > .mes').forEach((el) => {
        const id = Number(el.getAttribute('mesid'));
        const m = chat[id];
        const bot = isBotMessage(m);
        const lastUser = !!m && m.is_user && id === lastIdx && !run && !starting && !isGen();
        const eligible = s.enabled && s.inline !== 'off' && !!m && (bot || lastUser) && (s.inline === 'all' || id === lastIdx);
        let row = el.querySelector(':scope > .mes_block > .regenplus-row');
        if (!eligible) { row?.remove(); return; }
        const block = el.querySelector(':scope > .mes_block');
        if (!block) return;
        if (!row) {
            row = buildRow();
            const text = block.querySelector(':scope > .mes_text');
            if (text) text.after(row); else block.append(row);
        }
        const regenBtn = row.querySelector('.regenplus-regen');
        const lbl = regenBtn.querySelector('.regenplus-lbl');
        const want = lastUser ? 'Générer la réponse' : 'Régénérer';
        if (lbl.textContent !== want) lbl.textContent = want;
        const undoBtn = row.querySelector('.regenplus-undo');
        const showUndo = s.undo && bot && hasUndo(m);
        if (undoBtn.hidden === showUndo) undoBtn.hidden = !showUndo;
        const busy = (!!run && run.mesId === id) || (starting && id === lastIdx);
        regenBtn.classList.toggle('regenplus-busy', busy);
        row.classList.toggle('regenplus-dim', (!!run || starting) && !busy);
    });
}

/* ------------------------------------------------------------------ bouton flottant */

function ensureFloat() {
    let el = document.getElementById('regenplus-float');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'regenplus-float';
    el.innerHTML = '<div class="regenplus-move-label">Déplacer</div>'
        + '<button type="button" class="regenplus-btn regenplus-fbtn regenplus-regen" data-act="regen" aria-label="Régénérer"><span class="regenplus-ico">🔄</span></button>'
        + '<button type="button" class="regenplus-btn regenplus-fbtn regenplus-undo" data-act="undo" aria-label="Annuler la régénération" hidden><span class="regenplus-ico">↩️</span></button>';
    document.body.appendChild(el); // sous <body> : hors de tout ancêtre transformé
    const done = document.createElement('button');
    done.id = 'regenplus-move-done';
    done.type = 'button';
    done.textContent = '✔ Terminer le déplacement';
    done.addEventListener('click', () => setMoveMode(false));
    document.body.appendChild(done);
    bindDrag(el);
    return el;
}

function floatBounds(el) {
    const w = el.offsetWidth || 56;
    const h = el.offsetHeight || 56;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const form = document.getElementById('form_sheld');
    let formTop = vh;
    if (form && form.offsetParent !== null) {
        const r = form.getBoundingClientRect();
        if (r.height > 0 && r.top > 0) formTop = r.top;
    }
    const bar = document.getElementById('top-bar');
    const barBottom = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().bottom : 0;
    const minL = 6;
    const maxL = Math.max(minL, vw - w - 6);
    const minT = Math.max(6, barBottom + 6);
    const maxT = Math.max(minT, Math.min(vh, formTop) - h - 6);
    return { minL, maxL, minT, maxT, w, h };
}

function layoutFloat() {
    const el = ensureFloat();
    const s = S();
    el.style.setProperty('--regenplus-size', `${clamp(Number(s.floatSize) || 56, 40, 96)}px`);
    const show = s.enabled && (moveMode || (s.floating && chatOpen()));
    el.classList.toggle('regenplus-show', !!show);
    el.classList.toggle('regenplus-move', moveMode);
    document.getElementById('regenplus-move-done')?.classList.toggle('regenplus-show', moveMode);
    const b = floatBounds(el);
    el.style.left = `${Math.round(b.minL + clamp(Number(s.floatX), 0, 100) / 100 * (b.maxL - b.minL))}px`;
    el.style.top = `${Math.round(b.minT + clamp(Number(s.floatY), 0, 100) / 100 * (b.maxT - b.minT))}px`;
    const chat = ctx().chat;
    const m = chat[chat.length - 1];
    const undoBtn = el.querySelector('.regenplus-undo');
    const showUndo = s.undo && isBotMessage(m) && hasUndo(m);
    if (undoBtn.hidden === showUndo) undoBtn.hidden = !showUndo;
    el.querySelector('.regenplus-regen').classList.toggle('regenplus-busy', !!run || starting);
}

function bindDrag(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (!moveMode) return;
        e.preventDefault();
        const b = floatBounds(el);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0, b };
        el.classList.add('regenplus-dragging');
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.preventDefault();
        el.style.left = `${clamp(drag.left + e.clientX - drag.x, drag.b.minL, drag.b.maxL)}px`;
        el.style.top = `${clamp(drag.top + e.clientY - drag.y, drag.b.minT, drag.b.maxT)}px`;
    });
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const b = drag.b;
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const s = S();
        s.floatX = b.maxL > b.minL ? Math.round(clamp((left - b.minL) / (b.maxL - b.minL), 0, 1) * 1000) / 10 : 0;
        s.floatY = b.maxT > b.minT ? Math.round(clamp((top - b.minT) / (b.maxT - b.minT), 0, 1) * 1000) / 10 : 0;
        drag = null;
        el.classList.remove('regenplus-dragging');
        syncControls();
        save();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

function setMoveMode(on) {
    moveMode = !!on;
    if (moveMode) {
        reopenToggles = [];
        document.querySelectorAll('.drawer-content.openDrawer:not(.pinnedOpen)').forEach((panel) => {
            const toggle = panel.parentElement?.querySelector(':scope > .drawer-toggle');
            if (toggle) { toggle.click(); reopenToggles.push(toggle); }
        });
    } else {
        for (const t of reopenToggles) { try { t.click(); } catch { /* ignore */ } }
        reopenToggles = [];
    }
    $('#regenplus_move_btn').toggleClass('regenplus-active', moveMode).text(moveMode ? 'Terminer' : 'Déplacer');
    layoutFloat();
}

/* ------------------------------------------------------------------ rafraîchissement global */

function refreshAll() {
    try { document.body.classList.toggle('regenplus-hide-builtin', !!(S().enabled && S().hideBuiltin)); } catch { /* ignore */ }
    try { refreshInline(); } catch (e) { console.warn(LOG, e); }
    try { layoutFloat(); } catch (e) { console.warn(LOG, e); }
    try { refreshStatus(); } catch (e) { console.warn(LOG, e); }
}

/* ------------------------------------------------------------------ clics (délégation) */

function onDocClick(e) {
    const s = S();
    // Intercepte le « Régénérer » natif du menu baguette
    const builtin = e.target?.closest?.('#option_regenerate');
    if (builtin && s.enabled && s.interceptBuiltin) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const opts = document.getElementById('options');
        if (opts && getComputedStyle(opts).display !== 'none') document.getElementById('options_button')?.click();
        regenerate({ source: 'menu' });
        return;
    }
    const btn = e.target?.closest?.('.regenplus-btn[data-act], .regenplus-unlock-close[data-act]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (moveMode) return;
    const act = btn.dataset.act;
    const mes = btn.closest('.mes');
    const mesId = mes ? Number(mes.getAttribute('mesid')) : undefined;
    if (act === 'regen') regenerate({ mesId, source: mes ? 'inline' : 'float' });
    else if (act === 'undo') undo(Number.isInteger(mesId) ? mesId : ctx().chat.length - 1);
    else if (act === 'unblock') unblock();
    else if (act === 'dismiss') { bannerDismissedFor = Date.now(); showUnlockBanner(false); }
}

/* ------------------------------------------------------------------ réglages (UI) */

const FIELDS = [
    { section: 'Général' },
    { key: 'enabled', type: 'check', label: 'Activer Regenerate Plus' },
    { key: 'mode', type: 'select', label: 'Mode de régénération', options: [['replace', 'Remplacer — écrase le texte, sans swipe en plus'], ['swipe', 'Nouveau swipe — ajoute une variante'], ['continue', 'Continuer — prolonge le message']] },
    { key: 'allowOld', type: 'check', label: 'Autoriser la régénération des anciens messages', hint: 'Le contexte envoyé s’arrête alors à ce message (les suivants sont mis de côté puis remis).' },
    { key: 'keepOthers', type: 'check', label: 'Mode Remplacer : garder les autres swipes du message' },
    { key: 'undo', type: 'check', label: 'Garder l’ancien texte pour « Annuler la régénération »' },

    { section: 'Boutons' },
    { key: 'inline', type: 'select', label: 'Bouton dans les messages', options: [['last', 'Dernier message seulement'], ['all', 'Tous les messages du bot'], ['off', 'Aucun']] },
    { key: 'floating', type: 'check', label: 'Bouton flottant' },
    { key: 'floatX', type: 'range', label: 'Horizontal', min: 0, max: 100, step: 0.5, unit: '%' },
    { key: 'floatY', type: 'range', label: 'Vertical', min: 0, max: 100, step: 0.5, unit: '%' },
    { key: 'floatSize', type: 'range', label: 'Taille du bouton flottant', min: 40, max: 96, step: 2, unit: ' px' },
    { type: 'buttons', buttons: [['regenplus_move_btn', 'fa-up-down-left-right', 'Déplacer'], ['regenplus_pos_reset', 'fa-rotate-left', 'Position par défaut']] },
    { key: 'interceptBuiltin', type: 'check', label: 'Le « Régénérer » du menu ✨ utilise Regenerate Plus', hint: 'Remplace le comportement du bouton natif (menu baguette).' },
    { key: 'hideBuiltin', type: 'check', label: 'Masquer le « Régénérer » natif du menu ✨' },

    { section: 'Robustesse' },
    { key: 'abortFirst', type: 'check', label: 'Interrompre la génération en cours avant de régénérer' },
    { key: 'debounceMs', type: 'range', label: 'Anti double-tap', min: 0, max: 2000, step: 50, unit: ' ms' },
    { key: 'retries', type: 'range', label: 'Nouvelles tentatives si vide / erreur', min: 0, max: 5, step: 1, unit: '' },
    { key: 'retryDelay', type: 'range', label: 'Délai entre deux tentatives', min: 0, max: 10, step: 0.5, unit: ' s' },
    { key: 'minChars', type: 'range', label: 'Lettres/chiffres minimum pour une réponse valable', min: 1, max: 20, step: 1, unit: '' },
    { key: 'stuckDetect', type: 'check', label: 'Détecter une génération bloquée (bouton « Débloquer »)' },
    { key: 'stuckSeconds', type: 'range', label: 'Bloquée après', min: 10, max: 300, step: 5, unit: ' s sans activité' },
    { key: 'autoUnblock', type: 'check', label: 'Débloquer automatiquement' },
    { type: 'buttons', buttons: [['regenplus_unblock_btn', 'fa-unlock', 'Débloquer maintenant']] },

    { section: 'Instruction de régénération' },
    { key: 'usePrompt', type: 'check', label: 'Ajouter une instruction à chaque régénération', hint: 'Injectée une seule fois (setExtensionPrompt) puis retirée. {{old}} = ancienne réponse.' },
    { key: 'promptRole', type: 'select', label: 'Rôle de l’instruction', options: [['system', 'Système'], ['user', 'Utilisateur']] },
    { key: 'promptText', type: 'text', label: 'Texte de l’instruction' },

    { section: 'Divers' },
    { key: 'toasts', type: 'check', label: 'Afficher les notifications (nouvelles tentatives, etc.)' },
    { type: 'buttons', buttons: [['regenplus_reset', 'fa-trash-arrow-up', 'Réinitialiser les réglages']] },
];

function settingsHtml() {
    const rows = FIELDS.map((f) => {
        if (f.section) return `<div class="regenplus-section">${f.section}</div>`;
        if (f.type === 'buttons') {
            return `<div class="regenplus-buttons">${f.buttons.map(([id, icon, label]) => `<div class="menu_button" id="${id}"><i class="fa-solid ${icon}"></i>&nbsp;${label}</div>`).join('')}</div>`;
        }
        const id = `regenplus_${f.key}`;
        const hint = f.hint ? `<small class="regenplus-hint">${f.hint}</small>` : '';
        if (f.type === 'check') return `<label class="checkbox_label" for="${id}"><input type="checkbox" id="${id}" data-key="${f.key}"><span>${f.label}</span></label>${hint}`;
        if (f.type === 'select') return `<label for="${id}">${f.label}</label><select id="${id}" class="text_pole" data-key="${f.key}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${hint}`;
        if (f.type === 'range') return `<label for="${id}">${f.label} : <b id="${id}_val"></b></label><input type="range" id="${id}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}">`;
        if (f.type === 'text') return `<label for="${id}">${f.label}</label><textarea id="${id}" class="text_pole textarea_compact" rows="4" data-key="${f.key}"></textarea>${hint}`;
        return '';
    }).join('');
    return `<div class="regenplus-settings inline-drawer" id="regenplus_settings">
  <div class="inline-drawer-toggle inline-drawer-header"><b>🔄 Regenerate Plus</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
  <div class="inline-drawer-content">${rows}
  <small class="regenplus-hint">Utilise l’API, le persona et le contexte actuels : rien n’est changé en dehors de l’instruction optionnelle ci-dessus. Commande : <code>/regen [replace|swipe|continue]</code>.</small>
  </div></div>`;
}

function syncControls() {
    const s = S();
    for (const f of FIELDS) {
        if (!f.key) continue;
        const el = document.getElementById(`regenplus_${f.key}`);
        if (!el) continue;
        if (f.type === 'check') el.checked = !!s[f.key];
        else if (el.value !== String(s[f.key])) el.value = s[f.key];
        if (f.type === 'range') {
            const out = document.getElementById(`regenplus_${f.key}_val`);
            if (out) out.textContent = `${s[f.key]}${f.unit || ''}`;
        }
    }
}

function bindSettings() {
    const root = document.getElementById('regenplus_settings');
    if (!root) return;
    root.addEventListener('input', (e) => {
        const el = e.target;
        const key = el?.dataset?.key;
        if (!key) return;
        const f = FIELDS.find((x) => x.key === key);
        const s = S();
        if (f.type === 'check') s[key] = !!el.checked;
        else if (f.type === 'range') s[key] = Number(el.value);
        else s[key] = el.value;
        syncControls();
        save();
        refreshAll();
    });
    $('#regenplus_move_btn').on('click', () => setMoveMode(!moveMode));
    $('#regenplus_pos_reset').on('click', () => { const s = S(); s.floatX = defaultSettings.floatX; s.floatY = defaultSettings.floatY; syncControls(); save(); layoutFloat(); });
    $('#regenplus_unblock_btn').on('click', () => unblock());
    $('#regenplus_reset').on('click', () => {
        const store = stExt.extension_settings;
        store[MODULE_NAME] = { ...defaultSettings };
        syncControls(); save(); refreshAll();
        notify('success', 'Réglages réinitialisés.', { force: true });
    });
    syncControls();
}

/* ------------------------------------------------------------------ commande slash */

async function registerSlash() {
    try {
        const [{ SlashCommandParser }, { SlashCommand }, { SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE }, { SlashCommandEnumValue }] = await Promise.all([
            import('../../../slash-commands/SlashCommandParser.js'),
            import('../../../slash-commands/SlashCommand.js'),
            import('../../../slash-commands/SlashCommandArgument.js'),
            import('../../../slash-commands/SlashCommandEnumValue.js'),
        ]);
        const callback = async (named, value) => {
            const v = String(value ?? '').trim().toLowerCase();
            const map = { replace: 'replace', remplacer: 'replace', swipe: 'swipe', continue: 'continue', continuer: 'continue' };
            if (v && !map[v]) { notify('warning', 'Mode inconnu. Utilise : replace, swipe ou continue.', { force: true }); return ''; }
            const mes = named?.mes !== undefined && named.mes !== '' ? Number(named.mes) : undefined;
            const prevTap = lastTap;
            lastTap = 0; // une commande n'est pas un double-tap
            const r = await regenerate({ mode: map[v], mesId: Number.isInteger(mes) ? mes : undefined, source: 'slash' });
            if (!r?.ok && r?.reason === 'debounce') lastTap = prevTap;
            return '';
        };
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'regen',
            aliases: ['regenplus'],
            callback,
            returns: 'chaîne vide',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({ name: 'mes', description: 'index du message (0 = premier) ; par défaut le dernier', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
            ],
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'mode : replace (remplacer), swipe (nouveau swipe) ou continue ; par défaut le mode des réglages',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                    enumList: [
                        new SlashCommandEnumValue('replace', 'Remplacer le texte'),
                        new SlashCommandEnumValue('swipe', 'Ajouter un swipe'),
                        new SlashCommandEnumValue('continue', 'Continuer le message'),
                    ],
                }),
            ],
            helpString: '<div>Regenerate Plus : régénère le dernier message du bot (ou <code>mes=N</code>). <code>/regen replace</code>, <code>/regen swipe</code>, <code>/regen continue</code>. Remplace l’alias <code>/regen</code> natif ; <code>/regenerate</code> reste le natif.</div>',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'unblock',
            aliases: ['debloquer'],
            callback: async () => { await unblock(); return ''; },
            helpString: '<div>Regenerate Plus : arrête la génération et remet l’interface à zéro (envoi, boutons, état de swipe).</div>',
        }));
    } catch (e) {
        console.warn(LOG, 'commande /regen non enregistrée', e);
    }
}

/* ------------------------------------------------------------------ démarrage */

function startObservers() {
    const chatEl = document.getElementById('chat');
    if (chatEl) new MutationObserver(scheduleInline).observe(chatEl, { childList: true, subtree: true });
    const form = document.getElementById('form_sheld');
    if (form && globalThis.ResizeObserver) new ResizeObserver(() => layoutFloat()).observe(form);
    window.addEventListener('resize', () => layoutFloat());
    window.visualViewport?.addEventListener('resize', () => layoutFloat());
    window.addEventListener('orientationchange', () => setTimeout(layoutFloat, 300));
    const es = stScript.eventSource;
    const et = stScript.event_types || {};
    for (const name of ['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_RECEIVED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
        if (et[name]) es.on(et[name], () => { scheduleInline(); layoutFloat(); });
    }
    if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, () => setTimeout(() => { recoverTailBackup().catch(() => {}); }, 400));
}

jQuery(async () => {
    try {
        getSettings();
        $('#extensions_settings2').append(settingsHtml());
        bindSettings();
        document.addEventListener('click', onDocClick, true);
        ensureFloat();
        ensureBanner();
        startObservers();
        startWatchdog();
        await registerSlash();
        refreshAll();
        setTimeout(() => { refreshAll(); recoverTailBackup().catch(() => {}); }, 1500);
        globalThis.regeneratePlus = { regenerate, undo, unblock, getSettings, refresh: refreshAll, version: '1.0.0' };
        console.log(LOG, 'chargé');
    } catch (e) {
        console.error(LOG, 'initialisation impossible', e);
    }
});
