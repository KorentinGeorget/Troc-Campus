# 📦 Troc'Campus — Progressive Web App

Plateforme d'échange, de don et de vente d'objets, fournitures et manuels entre étudiants sur le campus universitaire.

Projet conçu dans le cadre du cours de Progressive Web Apps (Master 2 Informatique, Università di Corsica).

- **Document technique complet :** [`DOC-TECHNIQUE.md`](./DOC-TECHNIQUE.md)

---

## ✨ Fonctionnalités clés

- **100% Fonctionnelle hors ligne** : App Shell mis en cache par le Service Worker (`troc-campus-v2`), stockage local IndexedDB (`idb` v8) et page de secours dédiée `offline.html`.
- **Installable** : Web App Manifest standalone (icônes 192x192, 512x512 et maskable) avec capture de `beforeinstallprompt`.
- **Synchronisation au retour du réseau** : File d'attente Outbox dans IndexedDB, vidage automatique via Background Sync (`sync-outbox`) ou repli universel `online` vers `https://httpbin.org/post`.
- **Visibilité moteurs de recherche & agents IA** : Contenu public pré-rendu dans le HTML initial (`data-seed`) lisible par `curl`, fichiers `robots.txt` (décisions motivées pour GPTBot, ClaudeBot, Google-Extended), `sitemap.xml`, `llms.txt`, jumelle Markdown `annonces.md` et données structurées Schema.org JSON-LD.
- **Capacités matérielles de l'appareil** :
  1. **Caméra** : Prise de vue directe via `navigator.mediaDevices.getUserMedia` et capture Canvas 2D avec gestion explicite du refus.
  2. **Web Share API** : Partage natif des annonces via `navigator.share` avec repli automatique sur le presse-papiers (`navigator.clipboard`).
  3. **Web Share Target** : Réception de photos partagées depuis la galerie mobile interceptée par le Service Worker.
- **Bonus intégrés** :
  - **Notifications** : Système d'alertes campus (`Notification.requestPermission`) avec notification de confirmation (Cheatsheet § 12).
  - **Réconciliation de conflits** : Gestion de précondition optimiste `If-Match` / HTTP 412 avec choix utilisateur « Garder ma version / Prendre la leur » (Cheatsheet § 11).
- **Mise à jour maîtrisée** : Bannière interactive UX déclenchant `SKIP_WAITING` et rechargement propre sans perte de saisie en cours.
- **Sécurité** : Rendu DOM sécurisé avec `textContent` et `createElement` (protection contre les injections XSS).

---

## 🚀 Démarrage en local

L'application est construite en JavaScript natif (ES Modules) sans bundler ni étape de compilation.

```bash
# Lancement avec serve (recommandé)
npx serve -l 3000

# Ou avec Python
python3 -m http.server 3000
```

Accéder ensuite à `http://localhost:3000`.

---

## 🧪 Commandes de vérification

```bash
# 1. Vérification du contenu public en HTML brut (doit renvoyer 3 sans exécuter JS)
curl -s http://localhost:3000/ | grep -c "<li[ >]"

# 2. Consultation de la jumelle Markdown pour agents IA
curl -s http://localhost:3000/annonces.md

# 3. Vérification des fichiers de découverte (réponses HTTP 200)
curl -sI http://localhost:3000/robots.txt | head -n 1
curl -sI http://localhost:3000/sitemap.xml | head -n 1
curl -sI http://localhost:3000/llms.txt | head -n 1
```

---

## 🐳 Déploiement en production (Coolify / Docker)

Le projet contient un `Dockerfile` et un `Caddyfile` configurés pour servir l'application avec les en-têtes HTTP de sécurité (`X-Robots-Tag: noindex` pour le Markdown, `no-cache` sur le Service Worker, et gestion du routage App Shell) :

```bash
docker build -t troc-campus .
docker run -d -p 80:80 troc-campus
```
