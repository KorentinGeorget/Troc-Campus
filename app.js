// app.js — Logique applicative de Troc'Campus
// IndexedDB, Outbox, Background Sync, Caméra (getUserMedia), Web Share, et cycle de vie SW

// ---------------------------------------------------------------------------
// 1. Journal technique d'activité (Interface & traçabilité)
// ---------------------------------------------------------------------------
const journal = document.querySelector("#journal");

function log(message, source = "page") {
  const stamp = new Date().toLocaleTimeString("fr-FR", { hour12: false });
  console.log(`[${source}] ${message}`);
  if (!journal) return;
  const li = document.createElement("li");
  li.className = source;
  li.textContent = `${stamp}  [${source}] ${message}`;
  journal.append(li);
  journal.scrollTop = journal.scrollHeight;
}

document.querySelector("#btn-journal-clear")?.addEventListener("click", () => {
  journal.replaceChildren();
});

// Système de notifications Toast éphémères
function showToast(message) {
  const container = document.querySelector("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.append(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ---------------------------------------------------------------------------
// 2. Base de données IndexedDB (Bibliothèque idb standard)
// ---------------------------------------------------------------------------
const dbPromise = window.idb.openDB("troc-campus-db", 1, {
  upgrade(db) {
    // Store des annonces locales
    if (!db.objectStoreNames.contains("annonces")) {
      db.createObjectStore("annonces", { keyPath: "id", autoIncrement: true });
    }
    // Store outbox pour synchronisation différée
    if (!db.objectStoreNames.contains("outbox")) {
      db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    }
    // Store temporaire pour réception de Share Target
    if (!db.objectStoreNames.contains("shared_drafts")) {
      db.createObjectStore("shared_drafts", { keyPath: "id", autoIncrement: true });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Hydratation initiale depuis le HTML public (Critère Visibilité bots & SEO)
// ---------------------------------------------------------------------------
async function initHydration() {
  const db = await dbPromise;
  const count = await db.count("annonces");

  // Premier démarrage : extraire le contenu des 3 annonces publiques data-seed
  if (count === 0) {
    const seedCards = document.querySelectorAll("#annonces-list [data-seed]");
    log(`hydratation : première visite, importation de ${seedCards.length} annonces publiques du HTML`, "page");

    for (const card of seedCards) {
      const title = card.querySelector(".ad-title")?.textContent.trim() || "Annonce";
      const desc = card.querySelector(".ad-desc")?.textContent.trim() || "";
      const campus = card.querySelector(".ad-campus")?.textContent.replace("📍", "").trim() || "Campus Mariani";
      const type = card.dataset.type || "don";
      const price = Number(card.dataset.price) || 0;
      const placeholder = card.querySelector(".ad-image-placeholder")?.textContent.trim() || "📦";

      await db.add("annonces", {
        title,
        type,
        price,
        campus,
        contact: "contact-campus@univ-corse.fr",
        description: desc,
        placeholder,
        photo: null,
        isSeed: true,
        createdAt: Date.now() - 3600000
      });
    }
  }

  // Vérifier si des éléments ont été reçus via Web Share Target
  await checkSharedDrafts();

  // Rendu complet depuis la base
  await renderAnnonces();
  await updateSyncBadge();
}

// ---------------------------------------------------------------------------
// 4. Rendu des annonces (Protection anti-XSS : textContent & createElement)
// ---------------------------------------------------------------------------
let currentFilter = "all";

async function renderAnnonces() {
  const db = await dbPromise;
  const allAnnonces = await db.getAll("annonces");

  // Filtrage selon le bouton actif
  const filtered = currentFilter === "all"
    ? allAnnonces
    : allAnnonces.filter(a => a.type === currentFilter);

  // Mettre à jour le compteur
  const countEl = document.querySelector("#ad-count");
  if (countEl) countEl.textContent = filtered.length;

  const listEl = document.querySelector("#annonces-list");
  if (!listEl) return;

  // Rendu sécurisé par manipulation DOM
  listEl.replaceChildren(
    ...filtered.map(ad => {
      const li = document.createElement("li");
      li.className = "ad-card";
      li.dataset.id = ad.id;

      const article = document.createElement("article");

      // Conteneur Image / Photo
      const imgContainer = document.createElement("div");
      imgContainer.className = "ad-image-container";
      if (ad.photo) {
        const img = document.createElement("img");
        img.src = ad.photo;
        img.alt = ad.title;
        img.className = "ad-image";
        img.loading = "lazy";
        imgContainer.append(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "ad-image-placeholder";
        placeholder.textContent = ad.placeholder || (ad.type === "don" ? "🎁" : ad.type === "vente" ? "💶" : "🔄");
        imgContainer.append(placeholder);
      }

      // Corps de l'annonce
      const body = document.createElement("div");
      body.className = "ad-body";

      const metaTop = document.createElement("div");
      metaTop.className = "ad-meta-top";

      const typePill = document.createElement("span");
      typePill.className = `type-pill type-${ad.type}`;
      typePill.textContent = ad.type === "don" ? "Don" : ad.type === "vente" ? "Vente" : "Troc";

      const priceSpan = document.createElement("span");
      priceSpan.className = "ad-price";
      priceSpan.textContent = ad.type === "vente" ? `${ad.price} €` : (ad.type === "don" ? "Gratuit" : "Échange");

      metaTop.append(typePill, priceSpan);

      const titleEl = document.createElement("h3");
      titleEl.className = "ad-title";
      titleEl.textContent = ad.title;

      const descEl = document.createElement("p");
      descEl.className = "ad-desc";
      descEl.textContent = ad.description;

      body.append(metaTop, titleEl, descEl);

      // Pied de l'annonce
      const footer = document.createElement("div");
      footer.className = "ad-footer";

      const campusEl = document.createElement("span");
      campusEl.className = "ad-campus";
      campusEl.textContent = `📍 ${ad.campus}`;

      const actions = document.createElement("div");
      actions.className = "ad-actions";

      // Capacité matérielle 2 : Web Share API avec fallback presse-papiers
      const btnShare = document.createElement("button");
      btnShare.type = "button";
      btnShare.className = "btn btn-secondary btn-sm";
      btnShare.textContent = "Partager";
      btnShare.title = "Partager cette annonce";
      btnShare.addEventListener("click", () => shareAd(ad));

      actions.append(btnShare);

      // Bouton supprimer si annonce créée localement (pas de suppression des seeds initiales)
      if (!ad.isSeed) {
        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.className = "btn btn-danger btn-sm";
        btnDelete.textContent = "Supprimer";
        btnDelete.addEventListener("click", async () => {
          await db.delete("annonces", ad.id);
          log(`annonce #${ad.id} supprimée`);
          renderAnnonces();
        });
        actions.append(btnDelete);
      }

      footer.append(campusEl, actions);
      article.append(imgContainer, body, footer);
      li.append(article);

      return li;
    })
  );
}

// Filtres
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter || "all";
    renderAnnonces();
  });
});

// ---------------------------------------------------------------------------
// 5. Capacité matérielle : Web Share API (avec repli universel Presse-papiers)
// ---------------------------------------------------------------------------
async function shareAd(ad) {
  const shareData = {
    title: `Troc'Campus : ${ad.title}`,
    text: `[${ad.type.toUpperCase()}] ${ad.title} (${ad.campus}) : ${ad.description}`,
    url: `${window.location.origin}/?ad=${ad.id}`
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      log(`Web Share exécuté pour l'annonce #${ad.id}`);
      showToast("✅ Annonce partagée avec succès !");
    } catch (err) {
      if (err.name !== "AbortError") {
        log(`Web Share erreur : ${err.message}`, "warn");
      }
    }
  } else {
    // Repli presse-papiers si Web Share non supporté
    try {
      await navigator.clipboard.writeText(`${shareData.text} — ${shareData.url}`);
      log(`Presse-papiers : lien de l'annonce copié`);
      showToast("📋 Lien et détails de l'annonce copiés dans le presse-papiers !");
    } catch (err) {
      log(`Échec copie presse-papiers : ${err.message}`, "error");
      showToast("Impossible de copier automatiquement le lien.");
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Capacité matérielle : Caméra (getUserMedia + Canvas + gestion refus)
// ---------------------------------------------------------------------------
let currentPhotoDataUrl = null;
let cameraStream = null;

const btnCamera = document.querySelector("#btn-camera");
const btnCapture = document.querySelector("#btn-capture");
const btnCameraClose = document.querySelector("#btn-camera-close");
const videoWrapper = document.querySelector("#video-wrapper");
const cameraVideo = document.querySelector("#camera-video");
const cameraCanvas = document.querySelector("#camera-canvas");
const cameraError = document.querySelector("#camera-error");
const photoPreviewBox = document.querySelector("#photo-preview-box");
const photoPreviewImg = document.querySelector("#photo-preview-img");
const btnPhotoRemove = document.querySelector("#btn-photo-remove");
const photoFileInput = document.querySelector("#photo-file");

// Déclenchement au clic utilisateur strict
btnCamera?.addEventListener("click", async () => {
  cameraError.style.display = "none";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraError.textContent = "L'accès à la caméra (getUserMedia) n'est pas supporté par ce navigateur. Utilisez le sélecteur de fichier ci-dessous.";
    cameraError.style.display = "block";
    log("Caméra non supportée par le navigateur", "warn");
    return;
  }

  try {
    log("Caméra : demande de flux vidéo...", "page");
    // Demande caméra arrière préférée sur mobile
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
    });

    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    videoWrapper.style.display = "block";
    log("Caméra : flux vidéo actif", "page");
  } catch (err) {
    log(`Caméra refusée ou indisponible : ${err.name} — ${err.message}`, "warn");
    let errorMsg = "Impossible d'accéder à la caméra.";
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      errorMsg = "⚠️ Permission caméra refusée. Pour l'activer, autorisez l'accès dans les paramètres de votre navigateur, ou choisissez une photo depuis vos fichiers.";
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      errorMsg = "Aucune caméra détectée sur cet appareil.";
    }
    cameraError.textContent = errorMsg;
    cameraError.style.display = "block";
  }
});

// Capture instantanée sur Canvas
btnCapture?.addEventListener("click", () => {
  if (!cameraVideo || !cameraStream) return;

  const width = cameraVideo.videoWidth || 640;
  const height = cameraVideo.videoHeight || 480;
  cameraCanvas.width = width;
  cameraCanvas.height = height;

  const ctx = cameraCanvas.getContext("2d");
  ctx.drawImage(cameraVideo, 0, 0, width, height);

  // Conversion en JPEG compressé pour stockage léger IndexedDB
  currentPhotoDataUrl = cameraCanvas.toDataURL("image/jpeg", 0.82);

  stopCameraStream();
  showPhotoPreview(currentPhotoDataUrl);
  log("Caméra : photo capturée avec succès", "page");
  showToast("📸 Photo enregistrée pour l'annonce !");
});

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (videoWrapper) videoWrapper.style.display = "none";
}

btnCameraClose?.addEventListener("click", () => {
  stopCameraStream();
  log("Caméra fermée par l'utilisateur", "page");
});

// Repli / alternative sélecteur de fichier
photoFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    currentPhotoDataUrl = event.target.result;
    showPhotoPreview(currentPhotoDataUrl);
    log(`Fichier photo chargé (${Math.round(file.size / 1024)} Ko)`, "page");
    showToast("📁 Photo sélectionnée depuis l'appareil !");
  };
  reader.readAsDataURL(file);
});

function showPhotoPreview(dataUrl) {
  if (!photoPreviewBox || !photoPreviewImg) return;
  photoPreviewImg.src = dataUrl;
  photoPreviewBox.style.display = "flex";
}

btnPhotoRemove?.addEventListener("click", () => {
  currentPhotoDataUrl = null;
  if (photoPreviewBox) photoPreviewBox.style.display = "none";
  if (photoFileInput) photoFileInput.value = "";
  log("Photo de l'annonce réinitialisée", "page");
});

// ---------------------------------------------------------------------------
// 7. Enregistrement d'une annonce & Outbox (Synchronisation hors ligne)
// ---------------------------------------------------------------------------
const formAnnonce = document.querySelector("#form-annonce");
const typeSelect = document.querySelector("#ad-type");
const groupPrice = document.querySelector("#group-price");

typeSelect?.addEventListener("change", () => {
  if (groupPrice) {
    groupPrice.style.display = typeSelect.value === "vente" ? "flex" : "none";
  }
});

formAnnonce?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = document.querySelector("#ad-title").value.trim();
  const type = document.querySelector("#ad-type").value;
  const price = type === "vente" ? (Number(document.querySelector("#ad-price").value) || 0) : 0;
  const campus = document.querySelector("#ad-campus").value;
  const contact = document.querySelector("#ad-contact").value.trim();
  const description = document.querySelector("#ad-desc").value.trim();

  const newAd = {
    title,
    type,
    price,
    campus,
    contact,
    description,
    photo: currentPhotoDataUrl,
    isSeed: false,
    createdAt: Date.now()
  };

  const db = await dbPromise;

  // 1. Sauvegarde locale instantanée (Optimistic UI)
  const localId = await db.add("annonces", newAd);
  log(`annonce enregistrée en local (#${localId})`, "page");

  // 2. Ajout dans l'Outbox pour envoi au serveur
  await db.add("outbox", {
    action: "create_ad",
    payload: { id: localId, ...newAd },
    timestamp: Date.now()
  });
  log(`action ajoutée à l'outbox pour synchronisation`, "sync");

  // Réinitialisation formulaire
  formAnnonce.reset();
  currentPhotoDataUrl = null;
  if (photoPreviewBox) photoPreviewBox.style.display = "none";
  if (photoFileInput) photoFileInput.value = "";
  if (groupPrice) groupPrice.style.display = "none";

  // Rendu de l'annonce immédiatement
  await renderAnnonces();
  await updateSyncBadge();

  // 3. Déclenchement de la synchronisation (Background Sync ou repli en ligne)
  await triggerSync();
});

// Déclenchement de la synchronisation selon les capacités du navigateur
async function triggerSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register("sync-outbox");
      log("Background Sync : enregistrement de « sync-outbox »", "sync");
      showToast("📴 Action en file d'attente (Background Sync actif)");
      return;
    } catch (err) {
      log(`Échec sync.register (${err.message}) → repli immédiat`, "warn");
    }
  }

  // Repli universel pour Safari, Firefox ou échec SyncManager
  if (navigator.onLine) {
    await flushOutbox();
  } else {
    showToast("📴 Hors ligne : synchronisation dès le retour du réseau");
  }
}

// Vidage de l'Outbox depuis la page (repli universel)
async function flushOutbox() {
  const db = await dbPromise;
  const items = await db.getAll("outbox");

  if (items.length === 0) return;

  log(`outbox : tentative d'envoi de ${items.length} élément(s)...`, "sync");
  const syncBadge = document.querySelector("#sync-badge");
  if (syncBadge) {
    syncBadge.textContent = `⏳ Envoi (${items.length})...`;
    syncBadge.className = "badge syncing";
  }

  for (const item of items) {
    try {
      const response = await fetch("https://httpbin.org/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload)
      });

      if (response.ok) {
        await db.delete("outbox", item.id);
        log(`outbox : élément #${item.id} envoyé avec succès au serveur`, "sync");
      } else {
        log(`outbox : échec HTTP ${response.status} pour #${item.id}`, "warn");
        break;
      }
    } catch (err) {
      log(`outbox : coupure réseau (${err.message}) — nouvel essai au prochain retour en ligne`, "warn");
      break;
    }
  }

  await updateSyncBadge();
}

async function updateSyncBadge() {
  const db = await dbPromise;
  const remaining = await db.count("outbox");
  const badge = document.querySelector("#sync-badge");
  if (!badge) return;

  if (remaining === 0) {
    badge.textContent = "⚡ Synchronisé";
    badge.className = "badge";
  } else {
    badge.textContent = `⏳ En attente (${remaining})`;
    badge.className = "badge syncing";
  }
}

// ---------------------------------------------------------------------------
// 8. Écoute réseau & repli en ligne obligatoire
// ---------------------------------------------------------------------------
const networkBadge = document.querySelector("#network");

function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  if (networkBadge) {
    networkBadge.textContent = isOnline ? "en ligne" : "hors ligne";
    networkBadge.classList.toggle("off", !isOnline);
  }
  log(`état réseau : ${isOnline ? "en ligne" : "hors ligne"}`);

  if (isOnline) {
    showToast("🌐 Connexion rétablie : synchronisation...");
    flushOutbox();
  } else {
    showToast("📴 Mode hors ligne : les actions sont enregistrées en local");
  }
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

// ---------------------------------------------------------------------------
// 9. Traitement des éléments reçus via Web Share Target
// ---------------------------------------------------------------------------
async function checkSharedDrafts() {
  const urlParams = new URLSearchParams(window.location.search);

  // Cas 1 : Réception depuis formulaire POST géré par le SW
  if (urlParams.has("shared_received")) {
    const db = await dbPromise;
    const drafts = await db.getAll("shared_drafts");
    if (drafts.length > 0) {
      const draft = drafts[0];
      const titleInput = document.querySelector("#ad-title");
      const descInput = document.querySelector("#ad-desc");
      if (titleInput && draft.title) titleInput.value = draft.title;
      if (descInput && draft.description) descInput.value = draft.description;
      if (draft.photo) {
        currentPhotoDataUrl = draft.photo;
        showPhotoPreview(draft.photo);
      }
      await db.delete("shared_drafts", draft.id);
      showToast("📥 Objet partagé importé dans le formulaire d'annonce !");
      document.querySelector(".card-form")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  // Cas 2 : Réception par paramètres GET directs (title, text, url)
  if (urlParams.has("text") || urlParams.has("title")) {
    const titleInput = document.querySelector("#ad-title");
    const descInput = document.querySelector("#ad-desc");
    if (titleInput) titleInput.value = urlParams.get("title") || "";
    if (descInput) descInput.value = urlParams.get("text") || urlParams.get("url") || "";
    showToast("📥 Contenu partagé reçu dans le formulaire !");
    document.querySelector(".card-form")?.scrollIntoView({ behavior: "smooth" });
  }
}

// ---------------------------------------------------------------------------
// 10. Service Worker : cycle de vie & Bannière de mise à jour (Section 5)
// ---------------------------------------------------------------------------
let waitingWorker = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    log(`Service Worker enregistré (scope : ${reg.scope})`);

    // Suivi de l'arrivée d'une nouvelle version de sw.js
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      log(`updatefound : téléchargement d'une nouvelle version du SW...`, "warn");

      newWorker.addEventListener("statechange", () => {
        log(`statechange SW → ${newWorker.state}`);
        // Si installé alors qu'un SW contrôlait déjà la page : mise à jour disponible !
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = newWorker;
          showUpdateBanner();
        }
      });
    });

    // Bouton de vérification manuelle de mise à jour
    document.querySelector("#btn-update-check")?.addEventListener("click", () => {
      log("reg.update() : comparaison de sw.js avec le serveur...", "page");
      reg.update().then(() => showToast("Vérification des mises à jour effectuée."));
    });
  }).catch((err) => {
    log(`Échec enregistrement Service Worker : ${err.message}`, "error");
  });

  // Quand la nouvelle version prend le contrôle suite au SKIP_WAITING
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    log("controllerchange : nouvelle version active, rechargement...", "warn");
    window.location.reload();
  });

  // Réception des logs et messages du Service Worker
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_LOG") {
      log(event.data.message, "sw");
    } else if (event.data?.type === "SYNC_COMPLETED") {
      log(`synchronisation terminée en arrière-plan (${event.data.remaining} restant)`, "sync");
      updateSyncBadge();
    }
  });
}

function showUpdateBanner() {
  const banner = document.querySelector("#update-banner");
  if (!banner) return;
  banner.style.display = "block";
  log("Bannière de mise à jour affichée à l'utilisateur", "warn");
}

document.querySelector("#btn-update-apply")?.addEventListener("click", () => {
  if (waitingWorker) {
    log("Application de la mise à jour demandée par l'utilisateur", "page");
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }
});

// ---------------------------------------------------------------------------
// 11. Bouton d'installation personnalisé (beforeinstallprompt)
// ---------------------------------------------------------------------------
let deferredPrompt = null;
const btnInstall = document.querySelector("#btn-install");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (btnInstall) btnInstall.style.display = "inline-flex";
  log("Événement beforeinstallprompt capturé — bouton installer actif", "page");
});

btnInstall?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  log(`Installation PWA : choix utilisateur = ${outcome}`);
  deferredPrompt = null;
  btnInstall.style.display = "none";
});

window.addEventListener("appinstalled", () => {
  log("🎉 PWA Troc'Campus installée avec succès sur l'appareil !", "page");
  if (btnInstall) btnInstall.style.display = "none";
  showToast("🎉 Troc'Campus a été ajoutée à vos applications !");
});

// ---------------------------------------------------------------------------
// 12. Démarrage de l'application
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initHydration();
  updateNetworkStatus();
});
