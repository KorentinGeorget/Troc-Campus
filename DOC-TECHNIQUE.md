# Troc'Campus — Technical Design Doc

Korentin Georget · 12 octobre 2026 · Production : VPS Coolify · Dépôt : https://github.com/KorentinGeorget/Troc-Campus · Statut : Final

---

## 1. TL;DR

Troc'Campus est une Progressive Web App permettant aux étudiants de donner, vendre ou échanger des manuels, fournitures et équipements sur le campus universitaire, avec un fonctionnement garanti 100% hors ligne. L'application est installable sur smartphone, synchronise ses actions en arrière-plan dès le retour de la connexion, et expose son contenu public aux moteurs de recherche et aux agents IA sans dépendre de JavaScript. Le choix technique structurant est une architecture **Vanilla ES Modules avec IndexedDB (`idb`)**, éliminant tout outillage de build complexe et garantissant un contrôle total du cycle de vie du Service Worker et du pré-rendu SEO.

---

## 2. Contexte et objectifs

### Problème et sujet
Sur les campus universitaires (notamment les campus Mariani et Grimaldi de l'Università di Corsica), les étudiants accumulent en début et fin de semestre des livres de cours, du matériel de travaux pratiques et des équipements de logement étudiant dont d'autres ont besoin. Les plateformes existantes imposent des commissions ou des comptes lourds et ne fonctionnent pas dans les zones blanches ou les sous-sols des bâtiments universitaires. Troc'Campus répond au sujet officiel du Hub : **« Troc'Campus : vendre, donner, échanger »**.

### Périmètre fonctionnel
- Consulter instantanément le catalogue des annonces en mode avion grâce au cache App Shell et à IndexedDB.
- Déposer une annonce hors ligne avec photo prise via la caméra ou le sélecteur de fichiers, avec enregistrement immédiat dans l'Outbox.
- Synchroniser automatiquement l'Outbox au retour du réseau via Background Sync (Chromium) ou le repli universel d'écoute `online`.
- Permettre l'installation sur écran d'accueil avec Web App Manifest valide (icônes 192/512, mode `standalone`).
- Rendre le contenu public lisible en HTML brut par les crawlers (`curl`, GPTBot, ClaudeBot), avec `robots.txt`, `sitemap.xml`, `llms.txt`, JSON-LD et jumelle Markdown `annonces.md`.
- Exploiter les capacités de l'appareil : caméra (capture photo), Web Share API (partage), Web Share Target, presse-papiers, app badge et vibration.
- Architecture d'échange direct entre étudiants sur le campus, sans intermédiaire bancaire ni serveur de chat lourd.

---

## 3. Architecture

### Stack technique
- **Frontend :** HTML5 sémantique, CSS3 moderne (variables, flexbox/grid, design sombre responsive, variables CSS sans préprocesseur) et JavaScript natif moderne (ES Modules).
- **Stockage local :** IndexedDB encapsulé via la bibliothèque légère officielle **`idb`** (Jake Archibald), servie localement (`/idb.js`) pour une autonomie totale sans dépendance CDN externe.
- **Service Worker :** Écrit à la main en JavaScript natif, sans abstraction Workbox, pour maîtriser précisément le cycle de vie, la mise en cache et la synchronisation.
- **Raison du choix Vanilla :** L'obligation de fournir un contenu public lisible par `curl` disqualifie les SPA classiques sans serveur SSR complexe. L'approche sans étape de compilation (zéro bundler Webpack/Vite) écarte tout risque de régression de build et respecte fidèlement les enseignements des TD 8 et 9.

### Schéma d'architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          NAVIGATEUR (CLIENT)                           │
│                                                                        │
│  ┌───────────────────────┐            ┌─────────────────────────────┐  │
│  │   Page Web (app.js)   │            │   Service Worker (sw.js)    │  │
│  │                       │            │                             │  │
│  │ - Rendu DOM sécurisé  │            │ - Cycle de vie (SW)         │  │
│  │ - getUserMedia Caméra │            │ - Interception fetch        │  │
│  │ - Web Share API       │            │ - SyncManager 'sync-outbox' │  │
│  │ - Repli window.online │            │ - Share Target (POST)       │  │
│  └──────────┬────────────┘            └──────────────┬──────────────┘  │
│             │                                        │                 │
│             ▼                                        ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   IndexedDB ("troc-campus-db")                   │  │
│  │  Stores : "annonces" (local)  |  "outbox" (en attente)           │  │
│  │           "shared_drafts" (transfert Share Target)               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│             │                                        │                 │
│             ▼                                        ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Cache API (App Shell)                        │  │
│  │  App Shell : index.html, style.css, app.js, offline.html,        │  │
│  │              manifest.json, annonces.md, idb v8, icônes...       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Requêtes réseau / Synchronisation
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                                SERVEUR                                 │
│                                                                        │
│  - Hébergement statique PWA : VPS Coolify (Docker / Caddy Server)      │
│  - En-tête HTTP : X-Robots-Tag: noindex sur annonces.md                │
│  - HTTPS automatique via Let's Encrypt                                 │
│  - Endpoint de synchronisation Outbox : https://httpbin.org/post       │
└────────────────────────────────────────────────────────────────────────┘
```

### Hébergement et pipeline de déploiement
L'application est déployée sur un VPS personnel géré via **Coolify**.
- **Serveur web :** Conteneur Docker léger basé sur **Caddy Alpine** (`Dockerfile` et `Caddyfile` fournis à la racine).
- **Certificat SSL :** Délivrance automatique et renouvellement HTTPS Let's Encrypt par le reverse-proxy Coolify (Traefik/Caddy).
- **Règles HTTP :** Cache long sur les assets statiques avec hash/version, `no-cache` sur `sw.js`, et injection de l'en-tête `X-Robots-Tag: noindex` pour le fichier `annonces.md`.

---

## 4. Cache et hors ligne

### Stratégies de cache

| Ressource | Stratégie | Stockage | Pourquoi |
|---|---|---|---|
| **App Shell** (`/`, `/index.html`, `/style.css`, `/app.js`, `idb`) | **Cache First** | Cache API | Chargement instantané même sans réseau ; garantit l'ouverture de l'application en mode avion. |
| **Page de secours** (`/offline.html`) | **Cache First** (pré-mise en cache) | Cache API | Présente une interface explicative soignée lors d'une navigation vers une URL non mise en cache. |
| **Icônes & Manifest** (`manifest.json`, PNG 192/512) | **Cache First** | Cache API | Ressources immuables requises pour l'identité graphique et l'installation de la PWA. |
| **Jumelle IA** (`/annonces.md`) | **Cache First** | Cache API | Permet la consultation textuelle hors ligne. |
| **Données des annonces** | **Local First** | IndexedDB (`troc-campus-db`) | Les annonces vivent dans IndexedDB ; les lectures et écritures sont locales et immédiates. |
| **Navigations HTML** (`request.mode === 'navigate'`) | **Network First** avec fallback Cache / `offline.html` | Réseau → Cache API | Tente de récupérer la version serveur à jour ; bascule sur l'App Shell ou la page offline en cas de coupure. |
| **Synchronisation Outbox** (`httpbin.org/post`) | **Network Only** | — | Les appels de synchronisation ne doivent jamais être mis en cache par le Service Worker. |

### Expérience utilisateur hors ligne
- **Ce que l'utilisateur voit :** Toutes les annonces enregistrées et les annonces publiques s'affichent normalement. Le badge d'état réseau passe à `hors ligne` (couleur rouge).
- **Ce qui est permis :** L'utilisateur peut rédiger une annonce complète, prendre une photo via la caméra ou un fichier, et cliquer sur « Publier ».
- **Comportement Outbox :** L'annonce apparaît immédiatement dans la liste locale (mise à jour optimiste de l'interface) et l'opération est versée dans le store `outbox`. Le badge affiche `⏳ En attente (1)`.
- **Page de secours :** Si l'utilisateur tente d'accéder à un lien externe ou une URL inconnue hors ligne, le Service Worker sert la page dédiée `offline.html` avec un bouton de retour à l'accueil et une détection automatique de reconnexion.

---

## 5. Mise à jour

### Stratégie retenue : Bannière utilisateur interactive
Plutôt que d'appliquer la mise à jour d'office de manière transparente via un `skipWaiting()` immédiat à l'installation, Troc'Campus propose une **bannière interactive « ✨ Une nouvelle version de Troc'Campus est disponible ! »** munie d'un bouton d'action.

### Justification
Dans une application où l'utilisateur rédige des annonces détaillées et capture des photos sur son mobile, recharger silencieusement la page ou écraser le Service Worker en cours d'utilisation risquerait d'interrompre une saisie active ou de vider un formulaire. La notification visuelle respecte l'action en cours de l'étudiant.

### Mécanisme technique
1. Le cache du Service Worker est versionné sous une constante (ex. `CACHE_NAME = "troc-campus-v4"`).
2. Lors d'un déploiement modifiant `sw.js`, le navigateur détecte la différence octet par octet et déclenche l'événement `updatefound` sur l'objet `registration`.
3. Le nouveau Service Worker entre dans l'état `installing`, télécharge l'App Shell dans son nouveau cache, puis passe à l'état `installed`.
4. La page détecte `newWorker.state === 'installed'` alors qu'un contrôleur actif existe déjà : elle affiche la bannière `#update-banner`.
5. Au clic sur « Mettre à jour maintenant », la page envoie `newWorker.postMessage({ type: "SKIP_WAITING" })`.
6. Le nouveau Service Worker exécute `self.skipWaiting()`, ce qui déclenche l'événement `activate`.
7. Dans l'`activate`, les anciens caches obsolètes sont supprimés par `caches.delete()`, puis `self.clients.claim()` prend la main.
8. La page écoute l'événement `navigator.serviceWorker.addEventListener("controllerchange")` et déclenche `window.location.reload()`, chargeant instantanément la nouvelle version sans intervention manuelle de vidage de cache.

---

## 6. Données et synchronisation

### Modèle de données IndexedDB (`troc-campus-db`)
- **Store `annonces` :**
  - Clé primaire : `id` (`autoIncrement: true`).
  - Champs : `title` (string), `type` ('don' | 'vente' | 'troc'), `price` (number), `campus` (string), `contact` (string), `description` (string), `photo` (string DataURL ou null), `isSeed` (boolean), `createdAt` (timestamp).
- **Store `outbox` :**
  - Clé primaire : `id` (`autoIncrement: true`).
  - Champs : `action` ('create_ad'), `payload` (objet annonce), `timestamp` (timestamp).
- **Store `shared_drafts` :**
  - Clé primaire : `id` (`autoIncrement: true`).
  - Champs : données reçues lors de l'interception d'une action Web Share Target.

### Cheminement de l'Outbox et synchronisation
1. Lors de la soumission du formulaire, l'annonce est ajoutée au store `annonces` et son action est inscrite dans l'Outbox.
2. Déclenchement de la synchronisation :
   - **Voie nominale (Chromium) :** Appel à `registration.sync.register("sync-outbox")`. Le Service Worker intercepte l'événement `sync` même si l'onglet est fermé ou en arrière-plan, importe la bibliothèque `idb` via `importScripts`, lit l'Outbox et expédie les requêtes en POST vers `https://httpbin.org/post`.
   - **Repli universel (Safari / Firefox) :** L'API `SyncManager` n'étant pas disponible, l'application écoute l'événement `window.addEventListener("online", flushOutbox)`. Dès que le réseau est rétabli, la fonction `flushOutbox()` de la page vide les éléments en attente.
3. **Gestion des échecs réseau :** En cas d'erreur HTTP ou d'interruption du réseau pendant la boucle d'envoi, l'itération s'interrompt immédiatement (`break`). L'élément en cours et les suivants restent dans l'Outbox, garantissant l'absence de perte de données et préservant l'ordre chronologique des publications.
4. **Gestion des conflits (Bonus Cheatsheet § 11) :** Chaque annonce locale porte un numéro de `version` incrémentiel. Lors de la synchronisation, l'Outbox transmet l'en-tête HTTP `If-Match: "<version>"`. Si une version concurrente plus récente existe côté serveur ou lors d'une collision (réponse HTTP 412 *Precondition Failed*), l'envoi s'interrompt sans écrasement sauvage et une bannière de réconciliation s'affiche dans l'interface, proposant à l'étudiant soit de « Garder ma version » (incrémentation et forçage local), soit de « Prendre la leur » (remplacement par la donnée concurrente).

---

## 7. Permissions et capacités de l'appareil

| Capacité / API | Déclenchée quand | Pourquoi à ce moment | Si refus |
|---|---|---|---|
| **Caméra (`navigator.mediaDevices.getUserMedia`)** | Clic explicite sur le bouton « 📸 Ouvrir la caméra ». | Conforme aux directives du cours : aucune permission demandée au chargement. L'étudiant souhaite illustrer l'objet qu'il dépose. | Message d'alerte contextuel `#camera-error` explicitant la raison du blocage, invitant à autoriser dans les paramètres du navigateur ou à utiliser le sélecteur alternatif de fichier. |
| **Web Share API (`navigator.share`)** | Clic sur le bouton « Partager » d'une fiche d'annonce. | Action directe de l'utilisateur pour relayer une annonce auprès de ses camarades (WhatsApp, Telegram, Discord de promo). | Repli transparent sur l'API Presse-papiers (`navigator.clipboard.writeText`) copiant le texte et l'URL, accompagné d'une notification toast de confirmation. |
| **Web Share Target (Manifest & SW)** | Partage d'une image depuis la galerie photo du smartphone vers l'icône Troc'Campus. | Facilite le dépôt d'annonce en réduisant le nombre d'étapes sur mobile. | Si non supporté (navigateurs de bureau), l'utilisateur passe classiquement par le formulaire et le bouton caméra. |
| **Installation PWA (`beforeinstallprompt`)** | Affichage du bouton « 📲 Installer » suite à l'événement navigateur. | Déclenché seulement lorsque le navigateur valide les critères d'installabilité ; ouverture de la boîte native au clic. | Le bouton disparaît si l'utilisateur annule le prompt ; l'application reste utilisable en onglet standard. |

---

## 8. Notifications

- **Système d'alertes et notifications (Bonus Cheatsheet § 12) :** L'utilisateur peut activer les alertes de nouveaux dons sur son campus via le bouton dédié `🔔` dans l'en-tête. La demande de permission (`Notification.requestPermission()`) n'est déclenchée qu'après cette action explicite de l'étudiant. Une notification locale d'accueil est immédiatement émise via `registration.showNotification()` ou `new Notification()`, et l'architecture est prête pour le raccordement push serveur FCM pour le portage Android.
- **Toasts éphémères :** Des notifications toast légères informent l'utilisateur en temps réel de l'état de la synchronisation, de la copie dans le presse-papiers ou du mode hors ligne.

---

## 9. Visibilité : SEO et agents IA

### Contenu initial dans le HTML
Le fichier `index.html` embarque en dur **trois annonces publiques complètes** identifiées par l'attribut `data-seed`.
- Un robot d'indexation ou la commande `curl -s https://troc-campus.korentingeorget.com/ | grep -c "<li[ >]"` renvoie immédiatement au moins 3 éléments sans exécuter le moindre script JavaScript.
- Au premier démarrage du navigateur, la fonction `initHydration()` vérifie si la base IndexedDB est vide (`db.count("annonces") === 0`) et n'importe ces annonces qu'une seule fois, évitant ainsi les doublons (3, 6, 9...).

### Fichiers de découverte & Négociation de contenu
1. **`robots.txt` :**
   - Autorise l'exploration générale (`User-agent: * Allow: /`).
   - Décisions motivées explicites pour les 7 jetons d'IA du Chapitre 8 :
     - **`GPTBot`** (`Allow: /`) : acquisition et visibilité des annonces citées dans ChatGPT.
     - **`OAI-SearchBot`** (`Allow: /`) : moteur OpenAI Search temps réel pour trouver les annonces.
     - **`ClaudeBot`** (`Allow: /`) : indexation pour orienter les étudiants vers le réemploi.
     - **`Claude-SearchBot`** (`Allow: /`) : recherche directe dans l'assistant Anthropic Claude.
     - **`PerplexityBot`** (`Allow: /`) : moteur conversationnel citant directement les sources.
     - **`CCBot`** (`Disallow: /`) : jeu d'entraînement Common Crawl (pas d'aspiration de masse).
     - **`Google-Extended`** (`Disallow: /`) : bloque l'entraînement de Gemini sans impacter Google Search.
   - Déclaration du sitemap : `Sitemap: https://troc-campus.korentingeorget.com/sitemap.xml`.
2. **`sitemap.xml` :** Déclare la page racine et la jumelle Markdown avec balises `<lastmod>` conformes.
3. **`llms.txt` :** Fichier structuré selon le standard Jeremy Howard (titre H1, résumé synthétique en citation, sections décrivant le contenu et la stack technique).
4. **`annonces.md` & Négociation Markdown :** Version jumelle Markdown pur du catalogue des annonces publiques. Caddy négocie également le contenu via l'en-tête `Accept: text/markdown` sur `/` pour renvoyer la jumelle avec `Vary: Accept` et `X-Robots-Tag: noindex`.
5. **Routage serveur & Vraie réponse 404 :** Caddy sert les fichiers statiques sans réécriture aveugle `/* -> /index.html`, garantissant qu'une URL inexistante répond un véritable code HTTP `404 Not Found` (évite le piège du soft 404).
6. **JSON-LD Schema.org :** Déclare dans le `<head>` une entité `WebApplication` (`applicationCategory: ShoppingApplication`) combinée à une `ItemList` décrivant les annonces disponibles.

---

## 10. Sécurité et vie privée

- **Protection contre les failles XSS :** L'affichage des données saisies par les utilisateurs est réalisé **strictement via `document.createElement()` et `textContent`**. L'emploi d' `innerHTML` avec des variables utilisateurs est rigoureusement proscrit.
- **Gestion des secrets :** Aucun secret, token privé ou clé API sensible n'est présent dans le code client.
- **Données locales :** Les annonces et photos sont stockées dans le bac à sable IndexedDB propre à l'origine du navigateur.
- **En-têtes HTTP de sécurité (Caddy) :** Injection de `X-Robots-Tag: noindex` sur les fichiers `.md` pour éviter les conflits d'indexation, et politique de non-mise en cache sur `sw.js`.

---

## 11. Mesures et validation

### Commandes de vérification curl
```bash
# 1. Vérification de la présence du contenu public en HTML brut (renvoie 3)
curl -s https://troc-campus.korentingeorget.com/ | grep -c "<li[ >]"

# 2. Vérification de la jumelle Markdown
curl -s https://troc-campus.korentingeorget.com/annonces.md

# 3. Réponse HTTP 200 des fichiers de découverte
curl -sI https://troc-campus.korentingeorget.com/robots.txt | head -1
curl -sI https://troc-campus.korentingeorget.com/sitemap.xml | head -1
curl -sI https://troc-campus.korentingeorget.com/llms.txt | head -1
```

### Audits DevTools / Lighthouse
- **SEO :** Score attendu de 100/100 (balises `<title>`, description, canonical, responsive viewport, robots.txt, sitemap).
- **PWA :** Validé sans erreur dans l'onglet Application (Manifest valide, icônes 192/512, Service Worker actif avec gestionnaire fetch).
- **Schema.org :** 0 erreur sur le validateur JSON-LD.

---

## 12. Limites connues

- **Support de Background Sync :** L'API `Background Sync` (`SyncManager`) est exclusive aux navigateurs dérivés de Chromium (Chrome, Edge). Sous iOS Safari et Firefox, la synchronisation s'appuie de manière transparente sur le repli robuste de l'événement `window.online`.
- **Réception Web Share Target :** La réception directe d'images partagées depuis la galerie photo du système nécessite que la PWA soit préalablement installée sur l'appareil (Android). Sur navigateur de bureau, le formulaire propose directement le sélecteur de fichiers et la capture caméra.
