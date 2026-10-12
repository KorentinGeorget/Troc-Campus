// sw.js — Service Worker de Troc'Campus
try {
  importScripts("/idb.js");
} catch (e) {
  console.warn("Échec chargement initial idb dans SW :", e);
}

const CACHE_NAME = "troc-campus-v11";

const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/idb.js",
  "/offline.html",
  "/manifest.json",
  "/annonces.md",
  "/icons/favicon.png",
  "/icons/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png"
];

// ---------------------------------------------------------------------------
// Traçabilité : log vers la console et diffusion à toutes les pages ouvertes
// ---------------------------------------------------------------------------
async function log(message) {
  console.log(`[SW ${CACHE_NAME}] ${message}`);
  try {
    const pages = await self.clients.matchAll({ includeUncontrolled: true });
    for (const page of pages) {
      page.postMessage({ type: "SW_LOG", message, cache: CACHE_NAME });
    }
  } catch {
    // Échec silencieux si pas de client
  }
}

// ---------------------------------------------------------------------------
// Installation : mise en cache initiale de l'App Shell
// Stratégie de mise à jour choisie : bannière UX, donc PAS de skipWaiting() ici
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  log(`install : mise en cache de ${APP_SHELL.length} fichiers (App Shell)`);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Forcer le rechargement réseau sans utiliser le cache HTTP
        for (const url of APP_SHELL) {
          try {
            const req = new Request(url, { cache: "reload" });
            const res = await fetch(req);
            if (res.ok) {
              await cache.put(req, res);
            }
          } catch (err) {
            log(`install échec partiel cache (${url}) : ${err.message}`);
          }
        }
      })
      .then(() => log(`install : cache « ${CACHE_NAME} » initialisé avec succès`))
      .catch((err) => log(`install : ÉCHEC (${err.message})`))
  );
});

// ---------------------------------------------------------------------------
// Activation : nettoyage des anciennes versions de caches et prise de contrôle
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  log(`activate : prise de contrôle de la version ${CACHE_NAME}`);
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter((k) => k !== CACHE_NAME);
      if (oldKeys.length > 0) {
        log(`activate : suppression des anciens caches (${oldKeys.join(", ")})`);
        await Promise.all(oldKeys.map((k) => caches.delete(k)));
      }
      await self.clients.claim();
      log(`activate : clients.claim() exécuté`);
    })()
  );
});

// ---------------------------------------------------------------------------
// Réception Share Target (POST /share-target avec fichier / photo)
// ---------------------------------------------------------------------------
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const title = formData.get("title") || "";
    const text = formData.get("text") || "";
    const photo = formData.get("photo");

    let photoDataUrl = null;
    if (photo && photo instanceof Blob && photo.size > 0) {
      const buffer = await photo.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      photoDataUrl = `data:${photo.type || "image/jpeg"};base64,${base64}`;
    }

    // Sauvegarder dans un store de transfert temporaire IndexedDB
    try {
      const db = await self.idb.openDB("troc-campus-db", 1);
      await db.add("shared_drafts", {
        title: title || text || "Objet partagé",
        description: text || "",
        photo: photoDataUrl,
        timestamp: Date.now()
      });
      log(`share_target : élément partagé réceptionné avec succès`);
    } catch (e) {
      log(`share_target DB err : ${e.message}`);
    }

    // Rediriger vers l'application principale
    return Response.redirect("/?shared_received=1", 303);
  } catch (err) {
    log(`share_target err : ${err.message}`);
    return Response.redirect("/", 303);
  }
}

// ---------------------------------------------------------------------------
// Fetch : interception réseau avec Cache First pour les assets et fallback offline
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Gestion de Web Share Target (POST /share-target)
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // 2. Requêtes de navigation (pages HTML)
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Tente le réseau pour récupérer le HTML le plus frais
          return await fetch(event.request);
        } catch {
          // Échec réseau : utilise le cache ou la page offline de secours
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          return (await caches.match("/offline.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // 3. Ne pas intercepter les requêtes vers l'API de synchronisation (local /api/ ou httpbin)
  if (url.pathname.startsWith("/api/") || url.hostname.includes("httpbin.org")) {
    return;
  }

  // 4. Stratégie Cache First pour les assets statiques
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        // Si la ressource est sur le même domaine ou CDN idb, on peut la cacher au fil de l'eau
        if (response.status === 200 && (url.origin === self.location.origin || url.hostname.includes("jsdelivr"))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      } catch (err) {
        log(`fetch échec : ${url.pathname} (${err.message})`);
        throw err;
      }
    })()
  );
});

// ---------------------------------------------------------------------------
// Messages reçus depuis les pages (ex. déclenchement de la mise à jour)
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING" || event.data === "skipWaiting") {
    log(`message SKIP_WAITING reçu : activation immédiate`);
    self.skipWaiting();
  }
});

// ---------------------------------------------------------------------------
// Background Sync : vidage de l'Outbox au retour du réseau
// ---------------------------------------------------------------------------
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-outbox") {
    log(`sync : événement « sync-outbox » déclenché par le navigateur`);
    event.waitUntil(flushOutboxSW());
  }
});

async function flushOutboxSW() {
  try {
    const db = await self.idb.openDB("troc-campus-db", 1);
    const items = await db.getAll("outbox");

    if (items.length === 0) {
      log(`sync-outbox : aucune requête en attente`);
      return;
    }

    log(`sync-outbox : ${items.length} requête(s) à envoyer`);

    for (const item of items) {
      try {
        const networkPayload = { ...item.payload };
        if (networkPayload.photo && networkPayload.photo.length > 500) {
          networkPayload.photo = `[photo_data_attached: ${networkPayload.photo.length} bytes]`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        let res;
        try {
          res = await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(networkPayload),
            signal: controller.signal
          });
        } catch (_) {
          res = await fetch("https://httpbin.org/post", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(networkPayload),
            signal: controller.signal
          });
        }
        clearTimeout(timeoutId);

        if (res.ok) {
          await db.delete("outbox", item.id);
          log(`sync-outbox : élément #${item.id} envoyé avec succès (HTTP ${res.status})`);
        } else {
          log(`sync-outbox : échec HTTP ${res.status} pour l'élément #${item.id}`);
          break;
        }
      } catch (err) {
        log(`sync-outbox : erreur réseau (${err.message})`);
        break;
      }
    }

    // Notifier la page pour rafraîchir le badge
    const remaining = await db.count("outbox");
    const pages = await self.clients.matchAll();
    for (const page of pages) {
      page.postMessage({ type: "SYNC_COMPLETED", remaining });
    }
  } catch (err) {
    log(`sync-outbox erreur globale : ${err.message}`);
  }
}
