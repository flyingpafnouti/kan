# Issues

Suivi d'issues minimaliste en Kanban (To do / In progress / Done), synchronisé entre appareils via Supabase. Application web en anglais, installable sur téléphone (PWA), hébergée sur GitHub Pages.

## Mise en place Supabase

1. Projet utilisé : celui de cine (`gnayyrrvlpgkdfifauuw`). Les tables `projects`, `issues` et `notes` cohabitent avec `film_marks`.
2. SQL Editor : coller et exécuter `supabase/schema.sql`. Sur une base existante, exécuter à la place les fichiers de `supabase/migrations/` pas encore appliqués, dans l'ordre.
3. Compte : le même que pour cine.
4. Les inscriptions restent ouvertes car le projet est partagé avec cine. Un inconnu peut donc créer un compte, mais la RLS ne lui laisse voir que ses notes et les projets dont il est membre.
5. Authentication > URL Configuration : laisser la Site URL de cine. La connexion se fait par mot de passe, sans lien envoyé par mail, donc cette URL ne sert pas ici.

## Développement local

```
npm install
npm run dev
```

L'URL du projet Supabase et la clé publishable sont dans `.env` (valeurs publiques, versionnées). Pour pointer ailleurs en local, créer un `.env.local`.

`npm run dev` (http://localhost:5173/kan/) écoute aussi sur le réseau local : ouvrir l'URL « Network » sur le téléphone (même Wi-Fi) pour tester.

## Déploiement GitHub Pages

Dépôt : `flyingpafnouti/kan`, site : https://flyingpafnouti.github.io/kan/

1. Settings > Pages > Source : « GitHub Actions » (une seule fois).
2. Chaque push sur `main` redéploie. Si le dépôt change de nom, changer `base` dans `vite.config.ts`.

## Installation sur le téléphone

Ouvrir l'URL GitHub Pages, se connecter, puis :
- Android (Chrome) : menu > « Ajouter à l'écran d'accueil ».
- iPhone (Safari) : Partager > « Sur l'écran d'accueil ».

L'application s'ouvre alors en plein écran sur le dernier projet consulté.

## Utilisation

- PC : taper au clavier n'importe où sur le tableau commence une nouvelle issue, glisser-déposer entre colonnes. `/` ouvre la recherche, Échap ferme la fiche ou revient aux projets ; Retour arrière revient aussi aux projets.
- Lecture et édition d'une issue : même interrupteur Read / Edit et même raccourci Alt + E que pour les notes, mais la fiche s'ouvre en Edit.
- Clavier : les flèches choisissent un projet ou une issue, Entrée l'ouvre. Sur le tableau, Alt + ↑ / ↓ déplace l'issue choisie dans sa colonne et Alt + ← / → change son statut. Dans la fiche, Alt + ↑ / ↓ (ou les chevrons à côté du titre) passe à l'issue précédente ou suivante de la colonne, même avec le curseur dans le texte, et Alt + ← / → change son statut. Alt + ← / → ne fait jamais revenir en arrière dans le navigateur. Le récapitulatif s'ouvre avec `?` ou le lien « Keyboard shortcuts » en bas de la page des projets.
- Téléphone et tablette : une colonne à la fois, glisser le doigt à gauche ou à droite pour changer. Bouton `+`, Entrée enregistre et laisse le champ ouvert pour la suivante. Appui long pour réordonner. Loupe en haut pour la recherche.
- Dictée : dans la fiche, le micro sous les notes enregistre, un second appui arrête et ajoute la transcription aux notes (Groq, Whisper Large V3, en français). La clé API Groq est demandée au premier usage et enregistrée dans les métadonnées du compte Supabase, donc partagée entre appareils. Une clé refusée est effacée et redemandée. Nécessite HTTPS : absent avec le serveur de dev ouvert sur le réseau local.
- Post-traitement : l'étincelle à côté du micro ouvre une bulle où saisir un prompt. Le micro de la bulle fonctionne comme les autres et remplace ce qui y était écrit : le prompt est effacé au premier appui, la transcription arrive après le second. La flèche, ou Ctrl + Entrée, envoie le prompt à GPT-OSS 120B (Groq, même clé), qui réécrit toute la note, ou les notes de l'issue, ou le brouillon du champ « New note ». « Undo » dans le message de confirmation rétablit le texte d'avant. Le prompt reste enregistré dans les métadonnées du compte, comme la clé, et limité à 2 000 caractères. Si la réécriture échoue, le texte ne change pas.
- Notes : l'onglet « Notes », à côté de « Projects » (ou ← / → au clavier), garde les idées pas encore formulées en issue, la plus récente en haut. Sur téléphone, le gros micro en bas enregistre, un second appui arrête et la transcription devient une nouvelle carte. Sur PC, taper au clavier n'importe où commence une note, Entrée l'enregistre, Maj + Entrée va à la ligne. Dans la fiche d'une note, « To issue… » la transforme en issue en haut du To do du projet choisi : la première ligne, ou la première phrase, devient le titre, le reste les notes de l'issue. Une note vidée est supprimée à la fermeture.
- Images : coller ou glisser une image dans la fiche d'une note l'ajoute, au curseur si le texte est en édition, à la fin sinon. Elle est réduite à 1600 px et compressée dans le navigateur (WebP, JPEG sur Safari), ce qui retire aussi ses métadonnées, puis envoyée dans le bucket privé `note-images` de Supabase Storage. La note ne contient qu'un lien `note-image:`, et la fiche ne se ferme pas tant que l'envoi n'est pas terminé. Ajouter une image demande une connexion. Une image déjà vue reste affichable hors ligne sur cet appareil, jusqu'à la déconnexion. Limite : 2 Mo après compression. Chaque compte ne lit que ses images : une note transformée en issue d'un projet partagé affiche « Image » à la place chez les autres membres. Supprimer une note ou retirer un lien laisse le fichier dans le bucket.
- Lecture et édition : l'interrupteur Read / Edit de la fiche d'une note choisit le mode, Read à l'ouverture, et Alt + E bascule de l'un à l'autre. Read affiche le rendu, Edit le texte source. Une note vide s'ouvre directement sur le champ de saisie. En Read, les images sont centrées et un clic sur l'une d'elles l'affiche en plein écran. Un clic ou Échap revient à la note. La poignée au coin d'une image (au survol, toujours visible sur écran tactile) la redimensionne, et un double-clic sur elle rend la taille d'origine. La largeur est gardée dans le lien, sous la forme `![image|480](…)`, donc sur tous les appareils.
- Types de notes : l'interrupteur Pro / Perso au-dessus de la liste choisit les notes affichées, et le choix est gardé sur l'appareil. Une nouvelle note prend le type affiché, Pro par défaut. Celui en bas de la fiche déplace la note vers l'autre type. La recherche (/) porte sur toutes les notes, indique le type de chacune, et ouvrir un résultat affiche son type.
- La liste des projets est triée par dernière modification : création, modification ou suppression d'une issue, renommage du projet. Le partage ne compte pas.
- « All issues », en haut de la liste des projets, réunit les issues de tous les projets, triées par priorité puis par projet, avec le nom du projet sur chaque carte. On y change le statut et on ouvre les fiches, mais on n'y crée ni ne réordonne d'issue.
- Thème : suit le réglage clair / sombre du système jusqu'au premier appui sur le soleil / la lune en haut de la page des projets. Le choix est ensuite gardé sur l'appareil.
- La recherche est approchée (lettres dans l'ordre, sans tenir compte des accents) et porte sur les titres et les notes des issues To do et In progress.
- Les issues terminées depuis plus de 7 jours quittent la colonne Done pour un volet replié en bas de celle-ci.
- Le rond à gauche d'une carte fait avancer le statut (To do → In progress → Done).
- Toucher une carte ouvre la fiche : titre, notes, statut, suppression. Enregistrement automatique. « Copy to… », en gris à côté de « Close », copie l'issue en haut du To do d'un projet, le même ou un autre : titre, notes et priorité sont repris, le statut repart à To do.
- Les notes des issues et les notes sont en Markdown, avec formules TeX rendues par MathJax : `$…$` ou `\(…\)` en ligne, `$$…$$` ou `\[…\]` centrées. Le texte s'affiche mis en forme en mode Read. MathJax n'est chargé qu'à la première formule, puis gardé en cache pour l'usage hors ligne.
- Les blocs ` ```mermaid ` s'affichent en diagramme dans une issue ouverte et dans une note en lecture ; un clic les agrandit en plein écran, avec zoom et déplacement à la main ; on en sort avec Échap, ou le bouton de fermeture sur écran tactile. Dans une issue, le crayon ouvre leur source. La liste des notes affiche un simple libellé. Mermaid n'est chargé qu'au premier diagramme, puis gardé en cache pour l'usage hors ligne.
- Partage : dans les options d'un projet (les trois points), « Share link » copie un lien d'invitation. Une personne qui l'ouvre et se connecte devient membre du projet. Elle doit déjà avoir un compte, l'application ne permet pas d'en créer. Tous les membres ont les mêmes droits : issues, renommage, suppression du projet pour tout le monde. « Reset link » remplace le lien, et l'ancien ne permet plus de rejoindre. Les membres déjà présents restent. « Leave » retire le projet de sa liste sans le supprimer pour les autres, et le dernier membre qui part le supprime. Un projet partagé porte le badge « Shared ». Les notes restent privées. Partager ou quitter demande une connexion, et un projet créé hors ligne ne peut être partagé qu'une fois synchronisé.
