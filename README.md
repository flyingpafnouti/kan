# Issues

Suivi d'issues minimaliste en Kanban (À faire / En cours / Fait), synchronisé entre appareils via Supabase. Application web installable sur téléphone (PWA), hébergée sur GitHub Pages.

## Mise en place Supabase

1. Projet utilisé : celui de cine (`gnayyrrvlpgkdfifauuw`). Les tables `projects` et `issues` cohabitent avec `film_marks`.
2. SQL Editor : coller et exécuter `supabase/schema.sql`. Sur une base existante, exécuter à la place les fichiers de `supabase/migrations/` pas encore appliqués, dans l'ordre.
3. Compte : le même que pour cine.
4. Les inscriptions restent ouvertes car le projet est partagé avec cine. Un inconnu peut donc créer un compte, mais la RLS ne lui laisse voir que ses propres données.
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

- PC : taper au clavier n'importe où sur le tableau commence une nouvelle issue, glisser-déposer entre colonnes. `/` ouvre la recherche, Échap ferme la fiche ou revient aux projets.
- Téléphone et tablette : une colonne à la fois, glisser le doigt à gauche ou à droite pour changer. Bouton `+`, Entrée enregistre et laisse le champ ouvert pour la suivante. Appui long pour réordonner. Loupe en haut pour la recherche.
- La recherche est approchée (lettres dans l'ordre, sans tenir compte des accents) et porte sur les titres et les notes des issues À faire et En cours.
- Les issues terminées depuis plus de 7 jours quittent la colonne Fait pour un volet replié en bas de celle-ci.
- Le rond à gauche d'une carte fait avancer le statut (À faire → En cours → Fait).
- Toucher une carte ouvre la fiche : titre, notes, statut, suppression. Enregistrement automatique.
