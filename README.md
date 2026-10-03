# Regenerate Plus (SillyTavern)

**FR** — Un « Régénérer » **fiable**, pensé pour **iPhone / Safari** et les **chats de groupe**. Gros boutons tactiles dans les messages, bouton flottant déplaçable, remplacement propre du texte (ou nouveau swipe), même personnage en groupe, anti double-tap, détection et déblocage des générations bloquées, nouvelles tentatives automatiques, et **annulation** (retour à l'ancien texte).

**EN** — A reliable *Regenerate* for mobile and group chats: big touch targets, floating draggable button, clean *replace* (or new swipe), same speaker in groups, debounce, stuck-generation detection/unblock, auto-retry on empty/error, undo. French UI.

Testée sur **SillyTavern 1.19.0** (WebKit iPhone 14 Pro émulé) avec un faux backend OpenAI-compatible — voir [Ce qui a été testé](#ce-qui-a-été-testé).

## Installation

SillyTavern → **Extensions** → **Install extension** → colle l'URL :

```
https://github.com/hydravnss/regenerate-plus
```

Puis recharge la page. Réglages : **Extensions → 🔄 Regenerate Plus**.

## Utilisation

| Où | Quoi |
|---|---|
| **Sous le dernier message du bot** (ou sous tous, au choix) | Boutons **🔄 Régénérer** et **↩️ Annuler** (≥ 46 px de haut). Si le dernier message est le tien : **🔄 Générer la réponse**. |
| **Bouton flottant** (option) | Rond, libre sur l'écran. Réglages **Horizontal / Vertical 0–100 %** ou bouton **Déplacer** puis glisser avec le doigt, **Terminer** pour valider. Il ne recouvre jamais la barre d'envoi. |
| **Pastille « Régénération… »** | Spinner + **⏹ Stop** pendant que ça tourne. |
| **Bandeau « Débloquer »** | Apparaît si rien ne bouge depuis N secondes. |
| **Commande** | `/regen`, `/regen replace`, `/regen swipe`, `/regen continue`, `/regen mes=3 swipe`. `/unblock` = débloquer. |
| **Menu ✨** | Option : le « Régénérer » natif du menu utilise Regenerate Plus (ou le masquer). Rien n'est retiré par défaut. |

### Modes

1. **Remplacer** (défaut) — le message ciblé est refait et **son texte est remplacé**, sans swipe en plus. Les *autres* swipes du message sont gardés (option). L'ancien texte reste disponible via **↩️ Annuler**.
2. **Nouveau swipe** — ajoute une variante, **même quand le swipe affiché n'est pas le dernier** et même sur le **message d'accueil** (le swipe natif ne fait alors que naviguer / boucler). **Annuler** supprime la variante et revient au swipe précédent.
3. **Continuer** — prolonge le message (annulable).

### Chat de groupe

Le **personnage qui a écrit le message** est forcé (`force_chid`, retrouvé via `original_avatar`) : on ne tire plus un autre perso au hasard. Le brouillon du champ de saisie est mis de côté puis remis (le natif l'enverrait comme message).

### Anciens messages

Tu peux régénérer **n'importe quel message du bot**. Le contexte envoyé s'arrête alors à ce message : les messages suivants sont **retirés du chat le temps de la génération puis remis** (et sauvegardés). Une copie est gardée dans `localStorage` : si la page se ferme pendant ce temps, la fin du chat est récupérée à la réouverture. Désactivable (« Autoriser la régénération des anciens messages »).

### Instruction de régénération (option)

Texte ajouté **une seule fois** pour la génération (`setExtensionPrompt`, rôle système ou utilisateur), puis retiré. `{{old}}` = ancienne réponse, utile pour « Réécris ta dernière réponse différemment ». L'API, le persona, les presets et le contexte restent ceux en cours : rien d'autre n'est modifié.

## Ce qui déconne dans le « Régénérer » natif (et ce que l'extension change)

Constats faits sur le code de SillyTavern 1.19.0 (`public/script.js`, `public/scripts/group-chats.js`), les points marqués ✅ ont aussi été **reproduits** dans une vraie instance (script `tests/constat-natif.mjs`).

1. ✅ **Le message est supprimé avant la génération.** `Generate('regenerate')` fait `chat.length--` + `removeLastMessage()` *avant* d'appeler l'API : si l'API renvoie une erreur (500, timeout…), **le message disparaît**. → Regenerate Plus garde l'original et le **remet** en cas d'échec.
2. ✅ **Groupes : le mauvais personnage (ou plusieurs) répond.** `regenerateGroup()` supprime tout le « lot » (même `gen_id`) puis relance l'activation *naturelle* : sur 8 essais, la moitié ont fait répondre **Bob + Seraphina** au lieu de Bob seul. → personnage forcé, un seul message remplacé.
3. ✅ **Groupes : le brouillon est envoyé.** Le texte tapé dans le champ de saisie part comme **message utilisateur** pendant un Régénérer de groupe (`generateGroupWrapper` lit `#send_textarea`). → brouillon mis de côté puis restauré.
4. ✅ **Clic sans effet, sans message.** Le menu fait `if (is_send_press == false) {…}` : si le drapeau est resté à `true` (génération morte, requête pendante), **rien ne se passe et aucune notification**. → abandon propre de la génération en cours, bouton **Débloquer** (`stopGeneration` + `setSendButtonState(false)` + `activateSendButtons`), détection automatique.
5. **État de swipe coincé.** Si un swipe sort en erreur (ex. élément DOM introuvable), `swipeState` reste à `swiping` : plus de swipe, et `sendTextareaMessage` retourne **silencieusement** (`if (swipeState !== NONE) return`). L'état est réparé par **Débloquer** (swipe de type `back` vers le swipe courant). *(état reproduit à la main dans les tests ; la cause native précise n'a pas été attendue en conditions réelles)*
6. **Swipe droit ≠ régénérer.** Depuis un swipe qui n'est pas le dernier, la flèche droite **navigue** au lieu de générer ; sur un message d'accueil « pristine », elle **boucle** (`OVERSWIPE_BEHAVIOR.PRISTINE_GREETING`). Seul le **dernier** message est swipeable (`isMessageSwipeable`). → mode « Nouveau swipe » force l'ajout d'un swipe, sur n'importe quel message.
7. **Swipe raté.** Après un échec, ST revient au *dernier* swipe existant plutôt qu'à celui qui était affiché. → l'extension revient au swipe d'origine.
8. **iPhone : clavier qui ressort.** Après un tap sur *Régénérer* dans le menu ✨, la logique « focus-keeping » refocalise `#send_textarea` (le clavier iOS remonte, la page saute). Les boutons de l'extension ne touchent pas au focus. Le menu ✨ demande aussi 2 taps sur des cibles petites. *(lecture du code uniquement, non reproduit sur iPhone réel)*
9. **Pas d'anti-rebond côté bouton.** Seul le drapeau `is_send_press` protège contre les doubles taps, et il est posé *après* des `await` (non reproduit). → anti double-tap réglable (700 ms) et une seule exécution à la fois.
10. **Aucune nouvelle tentative** si le modèle renvoie du vide ou une erreur (comportement du natif non reproduit pour le vide). → nouvelles tentatives automatiques (N, délai réglable) puis restauration de l'ancien texte.

## Réglages (tous en français)

Activer · mode · anciens messages · garder les autres swipes · annulation · bouton dans les messages (dernier / tous / aucun) · bouton flottant (+ Horizontal, Vertical, taille, Déplacer, position par défaut) · menu ✨ (utiliser / masquer) · interrompre la génération en cours · anti double-tap · tentatives et délai · seuil « réponse vide » · détection de blocage (délai) · déblocage automatique · **Débloquer maintenant** · instruction de régénération · notifications · **Réinitialiser**.

Les réglages sont enregistrés dans `extension_settings.regenerate_plus`.

## Notes

- `/regen` **remplace l'alias natif** `/regen` (qui pointait vers `/regenerate`). `/regenerate` reste le natif ; `/regenplus` est un alias de l'extension.
- Détection de blocage : « aucune activité » = ni jeton de streaming, ni message reçu, ni réponse réseau de génération depuis N secondes (60 s par défaut ; baisse-le prudemment avec un modèle lent en non-streaming).
- Bouton flottant : `position: fixed`, enfant direct de `<body>`, `z-index: 31` (devant le chat, derrière menus et popups) ; sa zone verticale s'arrête au-dessus de la barre d'envoi, y compris si une autre extension la déplace.

## Ce qui a été testé

Automatisé (`tests/`, SillyTavern 1.19.0 réel + faux backend OpenAI-compatible `tests/mock-openai.mjs`, Playwright **WebKit iPhone 14 Pro émulé**, taps tactiles) : Remplacer, Nouveau swipe, Continuer, annulation, swipe depuis un swipe non final et sur l'accueil, conservation des autres swipes, nouvelles tentatives (vide, 500), restauration après échecs, anti double-tap, instruction injectée une seule fois, ancien message (contexte coupé, suite du chat et fichier sauvegardé intacts), groupes (même personnage ×4, ancien message, brouillon, swipe, erreur, blocage), génération bloquée → Débloquer (solo et groupe), `is_send_press` bloqué, état de swipe coincé, streaming (+ Stop avec/sans jeton), bouton flottant (position, sliders 0–100 %, glisser, persistance après rechargement), `/regen`, menu ✨ intercepté / masqué, absence d'erreur console.

**Non testé** : vrai iPhone / vrai Safari iOS (clavier, barre d'adresse, safe-area), vrai Mistral API (flux réel, erreurs 429/5xx réelles), thème « iMessage Dark » réel (seulement les variables CSS de ST), autres sources d'API, extensions tierces qui écoutent les événements de message.

```bash
# prérequis : une instance ST (http://localhost:8010) avec l'extension, puis
node tests/mock-openai.mjs 9100 &
node tests/e2e-solo.mjs && node tests/e2e-group.mjs && node tests/e2e-ui.mjs
node tests/constat-natif.mjs   # comportements du Régénérer natif (sans l'extension)
```

## Licence

MIT
