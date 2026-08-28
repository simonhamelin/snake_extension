# Snake Anywhere

Une extension Chrome (Manifest V3) qui pose une partie de Snake par-dessus
**n'importe quelle page web**, pas seulement YouTube.

## Installation

1. Ouvre `chrome://extensions`
2. Active **Mode développeur** (en haut à droite)
3. **Charger l'extension non empaquetée** → choisis le dossier `snake-anywhere`
4. Ouvre un site quelconque et fais **Ctrl+Shift+Y**

> Les onglets déjà ouverts au moment de l'installation doivent être rechargés
> une fois (F5) : le content script n'y a pas encore été injecté.

Fonctionne aussi sur Edge, Brave, Opera et tout navigateur Chromium.

## Commandes

| Touche | Effet |
| --- | --- |
| `Ctrl+Shift+Y` | Ouvrir / fermer le jeu |
| `↑ ↓ ← →` ou `ZQSD` / `WASD` | Diriger le serpent |
| `Espace` | Démarrer, pause, rejouer |
| `Échap` | Quitter et rendre la page |

Le raccourci se change dans `chrome://extensions/shortcuts` (aussi accessible
depuis le popup).

## Modes

Six presets dans le popup. Chacun n'écrit que ce qui le caractérise, le reste
revient aux valeurs par défaut — un mode ne traîne donc jamais un réglage du
précédent.

| Mode | Ce qu'il fait |
| --- | --- |
| **Discret** | Tout par défaut : invisible sur la page, un seul jeton |
| **Classique** | Grille et cadre affichés, page assombrie |
| **Arcade** | Rapide, 3 jetons, jetons dorés, halo, cyan |
| **Chaos** | Vitesse démente, 6 jetons, beaucoup d'obstacles, murs traversants, petites cases |
| **Zen** | Lent, sans accélération, murs traversants, on traverse son corps, grandes cases rondes |
| **Disco** | Serpent arc-en-ciel, halo, flou, 3 jetons |

## Réglages

Dix-sept paramètres, tous stockés en local et appliqués à chaud — le jeu n'a pas
besoin d'être relancé.

### Jeu

- **Vitesse** — tranquille / normale / rapide / démente
- **Accélère avec le score** — chaque jeton raccourcit le tick, jusqu'à un plancher
- **Murs mortels** — décoché, le serpent ressort de l'autre côté
- **Traverser son corps** — mode sans mort par auto-collision
- **Jetons simultanés** — 1 à 8
- **Croissance par jeton** — 1 à 4 segments
- **Jetons dorés** — valent 5 points et le double de croissance, mais expirent en
  8 s avec un arc de décompte autour d'eux. Un seul à la fois, sinon la partie
  devient une loterie
- **Obstacles** — aucun / quelques-uns / beaucoup

### Apparence

- **Couleur du serpent** — huit nuances, un mode arc-en-ciel, ou n'importe quelle
  couleur au sélecteur
- **Couleur des jetons**
- **Taille des cases** — petites (18px) / moyennes (26) / grandes (34)
- **Forme** — arrondie / carrée / ronde
- **Halo lumineux** — traînée sur le serpent, plus intense vers la tête
- **Afficher le score** — décoché, plus aucun élément d'interface
- **Grille et cadre** — coupés par défaut
- **Flou d'arrière-plan** — coupé par défaut
- **Assombrir la page** — 6 % par défaut

### Le mode discret par défaut

Par défaut la page reste lisible : pas de flou, pas de quadrillage, pas de cadre,
un voile à peine perceptible. Trois conséquences.

**Le serpent doit tenir sur fond clair comme sur fond sombre.** Sans voile pour
créer le contraste, rien n'est semi-transparent : la couleur choisie est convertie
en HSL et le corps fonce vers la queue en **luminosité**, pas en opacité, avec un
liseré sombre autour de chaque case. Un dégradé en `rgba` aurait donné une queue
invisible sur une page blanche.

**Aucun trait ne se pose sur la page.** Les murs sont les bords de la fenêtre.
Activer la grille rallume le quadrillage **et** le cadre.

**La page ne réagit plus aux clics** pendant une partie, même si elle a l'air
normale. C'est voulu — le jeu est modal. `Échap` rend la main immédiatement.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | MV3, content script sur `<all_urls>`, une seule permission : `storage` |
| `content.js` | Le jeu complet — overlay, boucle, rendu canvas |
| `background.js` | Service worker : relaie le raccourci clavier vers l'onglet actif |
| `popup.*` | Réglages et lancement à la souris |

Quelques points qui méritent d'être connus si tu touches au code :

**Shadow DOM fermé.** L'overlay vit dans un `attachShadow({ mode: "closed" })`.
Sans ça, le CSS agressif de certains sites (`* { transition }`, `img { width }`,
resets globaux) déforme le jeu, et inversement le jeu risquerait de fuir sur la
page. Le conteneur est en `position: static` et ne participe donc pas au flux.

**Capture des touches.** Le listener est posé avec `capture: true` sur `window`,
donc il passe **avant** les raccourcis de la page (le `j`/`k`/`espace` de
YouTube, le `/` de GitHub…). `preventDefault()` sur les flèches empêche aussi le
scroll pendant la partie.

**Deux dispositions clavier.** Les lettres sont lues via `e.key`, pas `e.code` :
sur AZERTY ce sont bien Z/Q/S/D qui répondent, sur QWERTY W/A/S/D. Les deux
jeux cohabitent sans conflit.

**File de virages.** Les changements de direction sont mis en file (max 2) au
lieu d'écraser `dir` immédiatement. Sinon, deux touches dans le même tick
(droite puis haut alors qu'on va à gauche) provoquent un demi-tour sur soi-même
et une mort inexplicable.

**Obstacles jamais mortels au tirage.** Le semis évite la ligne médiane (le
couloir de départ) et les cases occupées par le serpent. Changer le réglage en
pleine partie retire donc le risque de faire apparaître un bloc sous la tête.

**Le temps s'arrête vraiment en pause.** Les jetons dorés portent un horodatage
de naissance ; à la reprise, celui-ci est décalé de la durée d'arrêt. Sans ça,
mettre en pause dix secondes ferait expirer le jeton doré à l'instant du retour.

**Boucle à pas fixe.** `requestAnimationFrame` accumule le temps écoulé et joue
des pas de durée fixe, avec un budget de 4 pas maximum par frame. Un onglet
laissé en arrière-plan ne rejoue donc pas cent pas d'un coup au retour — et il
se met en pause tout seul sur `visibilitychange`.

## Limites connues

- **Pages internes du navigateur** (`chrome://`, Web Store, visionneuse PDF,
  `about:`) : Chrome interdit toute injection. Le popup le détecte et grise le
  bouton. Aucune extension ne peut contourner ça.
- **Iframes** : le script ne tourne que dans le document principal
  (`all_frames: false`). Si le focus clavier est dans une iframe (un éditeur
  embarqué, une pub), les touches n'arrivent pas au jeu. Cliquer une fois sur
  l'overlay récupère le focus.
- **`file://`** : nécessite d'autoriser « Accès aux URL de fichier » dans la
  fiche de l'extension.

## Publication sur le Chrome Web Store

Si tu veux la distribuer : compte développeur à 5 $ une fois, puis un ZIP du
dossier. Prépare-toi à justifier `<all_urls>` dans le formulaire — c'est le
point qui rallonge la revue. L'argument est simple et vrai ici : le jeu doit
pouvoir s'ouvrir sur la page où l'utilisateur se trouve, et l'extension ne lit
ni n'envoie aucune donnée de page (aucune permission réseau, aucun `host`
distant, tout reste en `storage.local`).
