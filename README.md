# 📦 Troc'Campus — Progressive Web App (M2 Informatique)

> **Projet TP PWA · Università di Corsica · Cours de M2 Informatique**  
> **Auteur :** Korentin Georget  
> **Sujet officiel du Class Hub :** *Troc'Campus : vendre, donner, échanger*  
> **Document technique :** [`DOC-TECHNIQUE.md`](./DOC-TECHNIQUE.md)

---

## 📱 Présentation

**Troc'Campus** est une Progressive Web App conçue pour les étudiants de l'Université de Corse leur permettant de donner, échanger ou vendre leurs manuels, calculatrices, fournitures et équipements de logement étudiant.

### Points clés de la réalisation :
- **100% Fonctionnelle hors ligne** : App Shell en cache, base locale IndexedDB (`idb` v8), page de repli `offline.html`.
- **Installable** : Manifest Web App complet (icônes 192/512 + maskable, mode `standalone`, orientation).
- **Synchronisation au retour du réseau** : Outbox IndexedDB vidée automatiquement via Background Sync (`sync-outbox`) ou repli universel `window.online`.
- **Visibilité bots & IA (SEO/GEO)** : Contenu public pré-rempli dans le HTML brut (`data-seed`), lisible par `curl`, fichiers `robots.txt` (avec décisions motivées pour GPTBot/ClaudeBot/Google-Extended), `sitemap.xml`, `llms.txt`, jumelle Markdown `annonces.md` et métadonnées Open Graph / JSON-LD Schema.org.
- **Capacités de l'appareil** :
  1. **Caméra** via `navigator.mediaDevices.getUserMedia` avec flux vidéo direct, capture sur Canvas 2D et gestion du refus (permission demandée strictement au clic).
  2. **Web Share API** (`navigator.share`) avec repli automatique sur le presse-papiers (`navigator.clipboard`).
  3. **Web Share Target** déclaré dans le manifest et intercepté par le Service Worker pour importer directement des photos depuis la galerie mobile.
- **Mise à jour maîtrisée** : Bannière interactive UX (« Nouvelle version disponible ») évitant d'interrompre une saisie d'annonce en cours.
- **Sécurité** : Rendu DOM par `textContent` et `createElement` (aucun `innerHTML` sur les entrées utilisateurs, protection anti-XSS).

---

## 🚀 1. Lancement et test en local

L'application ne nécessite **aucun bundler ni étape de compilation** (Vanilla ES Modules natifs).

### Avec `npx serve` (recommandé, comme dans les TD) :
```bash
cd troc-campus
npx serve -l 3000
```
Ouvrez votre navigateur sur : **`http://localhost:3000`**

*(Note : le fichier `serve.json` à la racine configure `cleanUrls: false` pour éviter toute redirection 301 indésirable sur `offline.html`).*

### Alternative avec Python :
```bash
cd troc-campus
python3 -m http.server 3000
```

---

## 🧪 2. Commandes de vérification (Validation du TP)

Testez les critères obligatoires du barème depuis votre terminal :

```bash
# 1. Vérifier que curl reçoit bien au moins 3 annonces publiques en HTML brut (sans exécuter JS)
curl -s http://localhost:3000/ | grep -c "<li[ >]"
# Résultat attendu : 3

# 2. Vérifier la jumelle Markdown pour les agents IA
curl -s http://localhost:3000/annonces.md

# 3. Vérifier les fichiers de découverte (doivent répondre HTTP 200)
curl -sI http://localhost:3000/robots.txt | head -n 1
curl -sI http://localhost:3000/sitemap.xml | head -n 1
curl -sI http://localhost:3000/llms.txt | head -n 1

# 4. Vérifier l'absence de références en dur à 'localhost'
grep -rn "localhost" index.html robots.txt sitemap.xml llms.txt DOC-TECHNIQUE.md
```

---

## 🌐 3. Déploiement sur votre VPS via Coolify

Votre PWA est configurée pour être déployée en quelques clics sur votre VPS géré par **Coolify**.

### Méthode 1 : Déploiement via Dépôt Git (Recommandé)

1. **Pousser le dossier `troc-campus` sur votre dépôt GitHub ou GitLab :**
   ```bash
   cd troc-campus
   git init
   git add .
   git commit -m "feat: initial commit PWA Troc'Campus"
   git branch -M main
   git remote add origin git@github.com:<votre-utilisateur>/troc-campus.git
   git push -u origin main
   ```

2. **Dans le tableau de bord Coolify :**
   - Cliquez sur **+ New Resource** → **Application** → **Public / Private Git Repository**.
   - Collez l'URL de votre dépôt Git.
   - Choisissez le type de build : **Dockerfile** (un `Dockerfile` optimisé multi-stage basé sur **Caddy Alpine** est déjà fourni à la racine de `troc-campus`).
   - Indiquez le port de destination : `80`.
   - Renseignez votre domaine ou sous-domaine (ex. `https://troc-campus.votredomaine.fr`).
   - Cliquez sur **Deploy**. Coolify génère automatiquement le certificat SSL HTTPS via Let's Encrypt !

### Méthode 2 : Déploiement Statique Caddy direct dans Coolify

Si vous préférez le buildpack statique de Coolify :
- Sélectionnez **Static** dans Coolify.
- Le fichier `Caddyfile` présent à la racine configure automatiquement le serveur web avec :
  - L'en-tête `X-Robots-Tag: noindex` pour `annonces.md`.
  - La politique de cache optimisée pour les assets statiques et la désactivation du cache sur `sw.js`.
  - Le fallback propre sur `index.html`.

---

## 📊 4. Validation des critères du barème (sur 10 + bonus)

| Brique du sujet | Implémentation dans Troc'Campus | Validation |
|---|---|---|
| **Déploiement HTTPS (1 pt)** | Prêt pour VPS Coolify avec Dockerfile / Caddy et Let's Encrypt. | Accessible sur mobile via URL HTTPS. |
| **Installable (1 pt)** | `manifest.json` avec nom, icônes 192/512/maskable, `standalone`, bouton custom `beforeinstallprompt`. | DevTools → Application → Manifest sans erreur. |
| **Hors ligne (2 pts)** | App Shell complet en cache (`troc-campus-v1`), base `idb` pour les annonces, page dédiée `offline.html`. | Mode avion : l'app s'ouvre et les annonces s'affichent. |
| **Mise à jour (1 pt)** | Bannière interactive UX déclenchant `postMessage({ type: 'SKIP_WAITING' })` et rechargement contrôlé. | Modification du SW : bannière proposée sans perte de saisie. |
| **Synchronisation (1 pt)** | Store `outbox` dans IndexedDB, déclenchement `sync-outbox` (Chromium) + repli universel `online`. | Annonce créée hors ligne envoyée à `httpbin.org/post` au retour du réseau. |
| **Visible SEO / IA (1 pt)** | 3 annonces publiques dans le HTML initial, `robots.txt`, `sitemap.xml`, `llms.txt`, JSON-LD et `annonces.md`. | `curl` renvoie 3 annonces ; les 3 fichiers répondent 200. |
| **Capacité appareil (1 pt)** | Caméra `getUserMedia` avec flux vidéo direct et capture Canvas (déclenchée sur clic, refus géré). | Bouton caméra fonctionnel ; message clair si refus. |
| **Document technique (2 pts)** | [`DOC-TECHNIQUE.md`](./DOC-TECHNIQUE.md) complété selon les 12 sections du modèle officiel. | Choix argumentés et cohérents avec le code. |
| **Bonus (+2 pts)** | **2ème capacité :** Web Share API + Web Share Target (+1 pt). **Repli presse-papiers & toasts** (+1 pt). | Partage natif et réception de photo depuis la galerie. |
