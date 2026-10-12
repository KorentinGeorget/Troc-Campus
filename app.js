// app.js — Logique de l'application Troc'Campus
// IndexedDB, Outbox, Background Sync, Caméra (getUserMedia), Web Share,
// Notifications Push/Locales (Bonus), et Réconciliation de conflits If-Match 412 (Bonus)

// ---------------------------------------------------------------------------
// 1. Fonctions utilitaires : Toasts, Copie Presse-papiers et Logs
// ---------------------------------------------------------------------------
function showToast(message) {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(25); } catch (_) {}
  }
  const container = document.querySelector("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.append(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    const success = document.execCommand("copy");
    input.remove();
    return success;
  } catch {
    return false;
  }
}

function log(msg, category = "app") {
  console.log(`[PWA:${category}] ${msg}`);
}

// ---------------------------------------------------------------------------
// 2. Base de données locale IndexedDB (Bibliothèque idb)
// ---------------------------------------------------------------------------
const idbLib = window.idb || (typeof idb !== "undefined" ? idb : null);
const dbPromise = idbLib
  ? idbLib.openDB("troc-campus-db", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("annonces")) {
          db.createObjectStore("annonces", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("shared_drafts")) {
          db.createObjectStore("shared_drafts", { keyPath: "id", autoIncrement: true });
        }
      }
    }).catch((err) => {
      console.warn("Échec ouverture IndexedDB :", err);
      return null;
    })
  : Promise.resolve(null);

// ---------------------------------------------------------------------------
// 3. Hydratation initiale depuis le HTML public (Critère curl/SEO)
// ---------------------------------------------------------------------------
async function initHydration() {
  try {
    const db = await dbPromise;
    if (!db) {
      log("IndexedDB non disponible ou ignoré (crawl / sandbox bot) : maintien du contenu HTML statique.");
      return;
    }
    const count = await db.count("annonces");

    // Première visite : importer les 3 annonces d'exemple écrites en dur dans le HTML
    if (count === 0) {
      const seedCards = document.querySelectorAll("#annonces-list [data-seed]");
      log(`Importation initiale de ${seedCards.length} annonces publiques du HTML`);

      for (const card of seedCards) {
        const title = card.querySelector(".ad-title")?.textContent.trim() || "Annonce";
        const desc = card.querySelector(".ad-desc")?.textContent.trim() || "";
        const campus = card.querySelector(".ad-location")?.textContent.replace("📍", "").trim() || "Campus Mariani, Corte";
        const type = card.dataset.type || "don";
        const price = Number(card.dataset.price) || 0;
        const contact = card.dataset.contact || "contact@univ-corse.fr";
        const placeholder = card.querySelector(".thumb-icon")?.textContent.trim() || "📦";

        await db.add("annonces", {
          title,
          type,
          price,
          campus,
          contact,
          description: desc,
          placeholder,
          photo: null,
          version: 1, // Gestion des versions pour If-Match (Bonus § 11)
          isSeed: true,
          createdAt: Date.now() - 3600000
        });
      }
    }

    await checkSharedDrafts();
    await renderAnnonces();
    await updateSyncBadge();
  } catch (err) {
    console.warn("Erreur initHydration :", err);
  }
}

// ---------------------------------------------------------------------------
// 4. Rendu DOM sécurisé des annonces (Protection anti-XSS)
// ---------------------------------------------------------------------------
let currentFilter = "all";

async function renderAnnonces() {
  try {
    const db = await dbPromise;
    if (!db) return;
    const allAnnonces = await db.getAll("annonces");

    // Sécurité critique SEO / Bots : si la base est vide (ex: environnement headless sans persistance ou crawl),
    // ne JAMAIS vider la liste des annonces pré-remplies du HTML public !
    if (!allAnnonces || allAnnonces.length === 0) {
      return;
    }

    const filtered = currentFilter === "all"
      ? allAnnonces
      : allAnnonces.filter(a => a.type === currentFilter);

    const countEl = document.querySelector("#ad-count");
    if (countEl) countEl.textContent = filtered.length;

    const listEl = document.querySelector("#annonces-list");
    if (!listEl) return;

    listEl.replaceChildren(
    ...filtered.map(ad => {
      const li = document.createElement("li");
      li.className = "ad-card";
      li.dataset.id = ad.id;
      li.dataset.type = ad.type;
      li.dataset.contact = ad.contact;
      li.dataset.campus = ad.campus;
      li.dataset.title = ad.title;
      li.dataset.desc = ad.description;
      li.dataset.version = ad.version || 1;

      const article = document.createElement("article");
      article.className = "ad-content";

      // Miniature photo
      const thumb = document.createElement("div");
      thumb.className = `ad-thumb thumb-${ad.type}`;
      if (ad.photo) {
        const img = document.createElement("img");
        img.src = ad.photo;
        img.alt = ad.title;
        img.loading = "lazy";
        thumb.append(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "thumb-icon";
        icon.textContent = ad.placeholder || (ad.type === "don" ? "📚" : ad.type === "vente" ? "🧮" : "🪑");
        thumb.append(icon);
      }

      // Détails
      const details = document.createElement("div");
      details.className = "ad-details";

      const top = document.createElement("div");
      top.className = "ad-top";

      const tag = document.createElement("span");
      tag.className = `badge badge-${ad.type}`;
      tag.textContent = ad.type === "don" ? "Don" : ad.type === "vente" ? "Vente" : "Troc";

      const price = document.createElement("span");
      price.className = `ad-price ${ad.type === "don" ? "price-free" : ad.type === "troc" ? "price-troc" : ""}`;
      price.textContent = ad.type === "vente" ? `${ad.price} €` : (ad.type === "don" ? "Gratuit" : "Échange");

      top.append(tag, price);

      const title = document.createElement("h2");
      title.className = "ad-title";
      title.textContent = ad.title;

      const desc = document.createElement("p");
      desc.className = "ad-desc";
      desc.textContent = ad.description;

      const meta = document.createElement("div");
      meta.className = "ad-meta";

      const loc = document.createElement("span");
      loc.className = "ad-location";
      loc.textContent = `📍 ${ad.campus}`;
      meta.append(loc);

      const actions = document.createElement("div");
      actions.className = "ad-actions";

      // Bouton contacter
      const btnContact = document.createElement("button");
      btnContact.type = "button";
      btnContact.className = "btn-card btn-card-contact";
      btnContact.dataset.action = "contact";
      btnContact.textContent = "Contacter";

      // Bouton partager
      const btnShare = document.createElement("button");
      btnShare.type = "button";
      btnShare.className = "btn-card btn-card-share";
      btnShare.dataset.action = "share";
      btnShare.textContent = "Partager";

      actions.append(btnContact, btnShare);

      // Bouton supprimer si annonce locale
      if (!ad.isSeed) {
        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.className = "btn-card btn-card-delete";
        btnDelete.dataset.action = "delete";
        btnDelete.textContent = "Supprimer";
        actions.append(btnDelete);
      }

      details.append(top, title, desc, meta, actions);
      article.append(thumb, details);
      li.append(article);

      return li;
    })
  );
  } catch (err) {
    console.warn("Erreur renderAnnonces :", err);
  }
}

// ---------------------------------------------------------------------------
// 5. Délégation d'événements sur la liste des annonces
// ---------------------------------------------------------------------------
const annoncesList = document.querySelector("#annonces-list");

annoncesList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const card = btn.closest(".ad-card");
  if (!card) return;

  const action = btn.dataset.action;
  const id = Number(card.dataset.id) || card.dataset.id;
  const title = card.dataset.title || card.querySelector(".ad-title")?.textContent.trim();
  const campus = card.dataset.campus || card.querySelector(".ad-location")?.textContent.replace("📍", "").trim();
  const contact = card.dataset.contact || "contact@univ-corse.fr";
  const desc = card.dataset.desc || card.querySelector(".ad-desc")?.textContent.trim();
  const type = card.dataset.type || "don";

  if (action === "contact") {
    openContactModal({ title, campus, contact });
  } else if (action === "share") {
    await shareAd({ id, title, type, campus, description: desc });
  } else if (action === "delete") {
    const db = await dbPromise;
    await db.delete("annonces", id);
    showToast("Annonce supprimée");
    renderAnnonces();
  }
});

// ---------------------------------------------------------------------------
// 6. Modal de Contact & Partage
// ---------------------------------------------------------------------------
const modalContact = document.querySelector("#modal-contact");
const contactTitle = document.querySelector("#contact-ad-title");
const contactCampus = document.querySelector("#contact-ad-campus");
const contactInput = document.querySelector("#contact-input-val");
const btnEmailLink = document.querySelector("#btn-email-link");
const btnCopyContact = document.querySelector("#btn-copy-contact");
const btnCloseContact = document.querySelector("#btn-close-contact");

function openContactModal({ title, campus, contact }) {
  if (!modalContact) return;
  if (contactTitle) contactTitle.textContent = title;
  if (contactCampus) contactCampus.textContent = campus;
  if (contactInput) contactInput.value = contact;
  if (btnEmailLink) {
    if (contact.includes("@")) {
      btnEmailLink.href = `mailto:${contact}?subject=${encodeURIComponent("Intéressé par votre annonce Troc'Campus : " + title)}`;
      btnEmailLink.style.display = "block";
    } else {
      btnEmailLink.href = `tel:${contact}`;
      btnEmailLink.style.display = "block";
    }
  }
  modalContact.showModal();
}

btnCopyContact?.addEventListener("click", async () => {
  const val = contactInput.value;
  const ok = await copyToClipboard(val);
  if (ok) {
    showToast("✅ Coordonnées copiées dans le presse-papiers !");
  } else {
    showToast("Sélectionnez le texte pour copier");
  }
});

btnCloseContact?.addEventListener("click", () => modalContact.close());

modalContact?.addEventListener("click", (e) => {
  if (e.target === modalContact) modalContact.close();
});

// Capacité : Web Share API
async function shareAd(ad) {
  const shareData = {
    title: `Troc'Campus : ${ad.title}`,
    text: `[${ad.type.toUpperCase()}] ${ad.title} (${ad.campus}) : ${ad.description}`,
    url: `${window.location.origin}/?ad=${ad.id}`
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToast("✅ Annonce partagée !");
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }

  const textToCopy = `${shareData.text} — ${shareData.url}`;
  const ok = await copyToClipboard(textToCopy);
  if (ok) {
    showToast("📋 Lien copié dans le presse-papiers !");
  } else {
    showToast("Lien : " + shareData.url);
  }
}

// ---------------------------------------------------------------------------
// 7. Filtres par catégorie
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter || "all";
    renderAnnonces();
  });
});

// ---------------------------------------------------------------------------
// 8. Modal de Dépose d'Annonce & Gestion Caméra
// ---------------------------------------------------------------------------
const modalForm = document.querySelector("#modal-form");
const btnOpenForm = document.querySelector("#btn-open-form");
const btnCloseForm = document.querySelector("#btn-close-form");
const btnCancelForm = document.querySelector("#btn-cancel-form");
const formAnnonce = document.querySelector("#form-annonce");
const typeSelect = document.querySelector("#ad-type");
const fieldPrice = document.querySelector("#field-price");

btnOpenForm?.addEventListener("click", () => {
  modalForm.showModal();
});

function closeFormModal() {
  stopCamera();
  modalForm.close();
}

btnCloseForm?.addEventListener("click", closeFormModal);
btnCancelForm?.addEventListener("click", closeFormModal);

modalForm?.addEventListener("click", (e) => {
  if (e.target === modalForm) closeFormModal();
});

typeSelect?.addEventListener("change", () => {
  if (fieldPrice) {
    fieldPrice.hidden = typeSelect.value !== "vente";
  }
});

// Caméra (getUserMedia avec Viewfinder Plein Écran Dédié)
let cameraStream = null;
let currentPhotoDataUrl = null;

const modalCamera = document.querySelector("#modal-camera");
const btnCamera = document.querySelector("#btn-camera");
const btnCapture = document.querySelector("#btn-capture");
const btnCameraClose = document.querySelector("#btn-camera-close");
const btnCameraCancel = document.querySelector("#btn-camera-cancel");
const cameraVideo = document.querySelector("#camera-video");
const cameraCanvas = document.querySelector("#camera-canvas");
const cameraError = document.querySelector("#camera-error");
const photoPlaceholderBox = document.querySelector("#photo-placeholder-box");
const photoPreviewBox = document.querySelector("#photo-preview-box");
const photoPreviewImg = document.querySelector("#photo-preview-img");
const btnPhotoRemove = document.querySelector("#btn-photo-remove");
const photoFileInput = document.querySelector("#photo-file");

btnCamera?.addEventListener("click", async () => {
  if (cameraError) cameraError.hidden = true;
  modalCamera?.showModal();

  if (!navigator.mediaDevices?.getUserMedia) {
    if (cameraError) {
      cameraError.textContent = "Caméra non supportée par votre navigateur. Vous pouvez choisir une image depuis vos fichiers.";
      cameraError.hidden = false;
    }
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
  } catch (err) {
    log(`Refus caméra : ${err.name}`, "camera");
    if (cameraError) {
      cameraError.textContent = (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
        ? "⚠️ Permission caméra refusée. Vous pouvez autoriser la caméra dans les réglages du navigateur ou choisir une photo depuis votre galerie."
        : "Impossible d'accéder à la caméra.";
      cameraError.hidden = false;
    }
  }
});

btnCapture?.addEventListener("click", () => {
  if (!cameraVideo || !cameraStream) return;
  const w = cameraVideo.videoWidth || 640;
  const h = cameraVideo.videoHeight || 480;
  cameraCanvas.width = w;
  cameraCanvas.height = h;

  const ctx = cameraCanvas.getContext("2d");
  ctx.drawImage(cameraVideo, 0, 0, w, h);
  currentPhotoDataUrl = cameraCanvas.toDataURL("image/jpeg", 0.85);

  stopCamera();
  modalCamera?.close();
  showPhotoPreview(currentPhotoDataUrl);
  showToast("📸 Photo capturée avec succès !");
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function closeCameraModal() {
  stopCamera();
  modalCamera?.close();
}

btnCameraClose?.addEventListener("click", closeCameraModal);
btnCameraCancel?.addEventListener("click", closeCameraModal);

modalCamera?.addEventListener("click", (e) => {
  if (e.target === modalCamera) closeCameraModal();
});

photoFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    currentPhotoDataUrl = evt.target.result;
    showPhotoPreview(currentPhotoDataUrl);
    showToast("📁 Image sélectionnée");
  };
  reader.readAsDataURL(file);
});

function showPhotoPreview(url) {
  if (!photoPreviewBox || !photoPreviewImg) return;
  photoPreviewImg.src = url;
  photoPreviewBox.hidden = false;
  if (photoPlaceholderBox) photoPlaceholderBox.hidden = true;
}

function resetPhotoState() {
  currentPhotoDataUrl = null;
  if (photoPreviewImg) photoPreviewImg.src = "";
  if (photoPreviewBox) photoPreviewBox.hidden = true;
  if (photoPlaceholderBox) photoPlaceholderBox.hidden = false;
  if (photoFileInput) photoFileInput.value = "";
}

btnPhotoRemove?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetPhotoState();
  showToast("Photo retirée");
});

// Soumission du formulaire
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
    version: 1,
    isSeed: false,
    createdAt: Date.now()
  };

  const db = await dbPromise;
  const localId = await db.add("annonces", newAd);

  await db.add("outbox", {
    action: "create_ad",
    payload: { id: localId, ...newAd },
    timestamp: Date.now()
  });

  formAnnonce.reset();
  resetPhotoState();
  if (fieldPrice) fieldPrice.hidden = true;

  closeFormModal();
  await renderAnnonces();
  await updateSyncBadge();
  await triggerSync();
  showToast("🎉 Annonce publiée avec succès !");
});

// ---------------------------------------------------------------------------
// 9. Synchronisation Outbox avec gestion If-Match (Bonus Conflits § 11)
// ---------------------------------------------------------------------------
let isFlushingOutbox = false;
let syncRetryTimeout = null;
let syncRetryCount = 0;

async function triggerSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register("sync-outbox");
    } catch (err) {
      log(`Échec sync.register (${err.message})`, "sync");
    }
  }

  // Tenter également l'envoi direct si la page est connectée
  if (navigator.onLine) {
    await flushOutbox();
  }
}

async function flushOutbox(isManualTrigger = false) {
  if (isFlushingOutbox) return;
  isFlushingOutbox = true;

  if (syncRetryTimeout) {
    clearTimeout(syncRetryTimeout);
    syncRetryTimeout = null;
  }

  const syncPill = document.querySelector("#sync-status");

  try {
    const db = await dbPromise;
    if (!db) return;
    const items = await db.getAll("outbox");
    if (items.length === 0) {
      syncRetryCount = 0;
      await updateSyncBadge();
      return;
    }

    if (syncPill) {
      syncPill.textContent = `Envoi (${items.length})...`;
      syncPill.classList.add("sending");
      syncPill.hidden = false;
    }

    let successCount = 0;

    for (const item of items) {
      try {
        const version = item.payload?.version || 1;
        // Créer un payload léger pour la synchronisation réseau
        const networkPayload = { ...item.payload };
        if (networkPayload.photo && networkPayload.photo.length > 500) {
          networkPayload.photo = `[photo_data_attached: ${networkPayload.photo.length} bytes]`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        // Priorité 1 : endpoint local rapide Caddy (/api/sync)
        // Priorité 2 : repli externe (httpbin.org)
        let res;
        try {
          res = await fetch("/api/sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "If-Match": `"${version}"`
            },
            body: JSON.stringify(networkPayload),
            signal: controller.signal
          });
        } catch (_) {
          res = await fetch("https://httpbin.org/post", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "If-Match": `"${version}"`
            },
            body: JSON.stringify(networkPayload),
            signal: controller.signal
          });
        }
        clearTimeout(timeoutId);

        if (res.status === 412) {
          handleSyncConflict(item);
          break;
        } else if (res.ok) {
          await db.delete("outbox", item.id);
          successCount++;
        } else {
          break;
        }
      } catch (err) {
        console.warn("Échec requête outbox :", err);
        break;
      }
    }

    const remainingItems = await db.getAll("outbox");
    if (remainingItems.length === 0) {
      syncRetryCount = 0;
      if (successCount > 0) {
        showToast("✅ Annonce synchronisée avec succès !");
      }
    } else {
      // Re-tentative avec repli automatique (jusqu'à 3 tentatives)
      if (navigator.onLine && syncRetryCount < 3) {
        syncRetryCount++;
        syncRetryTimeout = setTimeout(() => {
          flushOutbox();
        }, 2500 * syncRetryCount);
      } else if (isManualTrigger) {
        showToast("⚠️ Connexion indisponible, nouvelle tentative automatique...");
      }
    }
  } finally {
    isFlushingOutbox = false;
    if (syncPill) {
      syncPill.classList.remove("sending");
    }
    await updateSyncBadge();
  }
}

async function updateSyncBadge() {
  try {
    const db = await dbPromise;
    if (!db) return;
    const remaining = await db.count("outbox");
    const pill = document.querySelector("#sync-status");
    if (!pill) return;

    if (remaining === 0) {
      pill.hidden = true;
    } else {
      pill.textContent = isFlushingOutbox ? `Envoi (${remaining})...` : `En attente (${remaining})`;
      pill.hidden = false;
    }

    // Capacité Badge de l'icône (App Badge API)
    if ("setAppBadge" in navigator) {
      try {
        if (remaining > 0) navigator.setAppBadge(remaining);
        else navigator.clearAppBadge();
      } catch (_) {}
    }
  } catch (err) {
    console.warn("Erreur updateSyncBadge :", err);
  }
}

// Clic interactif sur la pastille pour forcer l'envoi immédiat
const syncPillBtn = document.querySelector("#sync-status");
syncPillBtn?.addEventListener("click", async () => {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(30); } catch (_) {}
  }
  showToast("🔄 Envoi des annonces en attente...");
  await flushOutbox(true);
});

// ---------------------------------------------------------------------------
// 10. Bonus : Réconciliation de Conflits If-Match 412 (Cheatsheet § 11)
// ---------------------------------------------------------------------------
const conflictBanner = document.querySelector("#conflict-banner");
const btnConflictMine = document.querySelector("#btn-conflict-mine");
const btnConflictTheirs = document.querySelector("#btn-conflict-theirs");
let pendingConflictItem = null;

function handleSyncConflict(item, remoteVersionData = null) {
  pendingConflictItem = item;
  if (conflictBanner) conflictBanner.hidden = false;
  log(`Conflit 412 détecté sur l'annonce #${item.payload.id}`, "conflict");
}

btnConflictMine?.addEventListener("click", async () => {
  if (!pendingConflictItem) return;
  const db = await dbPromise;
  // "Garder la mienne" = incrémenter la version locale et réenvoyer
  pendingConflictItem.payload.version = (pendingConflictItem.payload.version || 1) + 1;
  await db.put("annonces", pendingConflictItem.payload);
  await db.delete("outbox", pendingConflictItem.id);
  conflictBanner.hidden = true;
  showToast("Version locale conservée !");
  renderAnnonces();
});

btnConflictTheirs?.addEventListener("click", async () => {
  if (!pendingConflictItem) return;
  const db = await dbPromise;
  // "Prendre la leur" = supprimer la modification locale en attente
  await db.delete("outbox", pendingConflictItem.id);
  conflictBanner.hidden = true;
  showToast("Version distante adoptée !");
  renderAnnonces();
});

// Helper pour tester la réconciliation en console ou démo
window.simulateConflict = () => {
  handleSyncConflict({
    id: 999,
    payload: { id: 1, title: "Livre Réseaux", version: 1 }
  });
};

// ---------------------------------------------------------------------------
// 11. Bonus : Notifications Push / Locales (Cheatsheet § 12)
// ---------------------------------------------------------------------------
const btnNotifToggle = document.querySelector("#btn-notif-toggle");
const modalNotif = document.querySelector("#modal-notif");
const btnCloseNotif = document.querySelector("#btn-close-notif");
const notifStatusBadge = document.querySelector("#notif-status-badge");
const notifStatusDesc = document.querySelector("#notif-status-desc");
const btnNotifAction = document.querySelector("#btn-notif-action");
const btnNotifTest = document.querySelector("#btn-notif-test");

function updateNotifModalState() {
  if (!("Notification" in window)) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      if (notifStatusBadge) {
        notifStatusBadge.className = "badge badge-troc";
        notifStatusBadge.textContent = "📱 Sur iPhone : installation requise";
      }
      if (notifStatusDesc) {
        notifStatusDesc.textContent = "Apple désactive les notifications dans les onglets Safari ordinaires. Pour les autoriser, touchez Partager (carré avec flèche) puis « Sur l'écran d'accueil » et ouvrez l'application.";
      }
    } else {
      if (notifStatusBadge) {
        notifStatusBadge.className = "badge badge-vente";
        notifStatusBadge.textContent = "Navigateur non compatible";
      }
      if (notifStatusDesc) {
        notifStatusDesc.textContent = "Ce navigateur ne supporte pas l'API de notifications standard.";
      }
    }
    if (btnNotifAction) btnNotifAction.hidden = true;
    if (btnNotifTest) btnNotifTest.hidden = true;
    return;
  }

  if (Notification.permission === "granted") {
    btnNotifToggle?.classList.add("active");
    if (notifStatusBadge) {
      notifStatusBadge.className = "badge badge-don";
      notifStatusBadge.textContent = "🟢 Alertes campus actives";
    }
    if (notifStatusDesc) {
      notifStatusDesc.textContent = "Vous recevez une notification en temps réel dès qu'une nouvelle annonce ou un don est publié sur le campus.";
    }
    if (btnNotifAction) btnNotifAction.hidden = true;
    if (btnNotifTest) btnNotifTest.hidden = false;
  } else if (Notification.permission === "denied") {
    btnNotifToggle?.classList.remove("active");
    if (notifStatusBadge) {
      notifStatusBadge.className = "badge badge-vente";
      notifStatusBadge.textContent = "🔴 Notifications bloquées";
    }
    if (notifStatusDesc) {
      notifStatusDesc.textContent = "Les notifications ont été bloquées dans votre navigateur. Pour les réactiver, touchez le cadenas ou réglages à gauche de l'adresse web et autorisez les notifications.";
    }
    if (btnNotifAction) {
      btnNotifAction.hidden = false;
      btnNotifAction.disabled = true;
      btnNotifAction.textContent = "⚠️ Bloqué dans le navigateur";
    }
    if (btnNotifTest) btnNotifTest.hidden = true;
  } else {
    // "default"
    btnNotifToggle?.classList.remove("active");
    if (notifStatusBadge) {
      notifStatusBadge.className = "badge badge-troc";
      notifStatusBadge.textContent = "⏳ En attente d'autorisation";
    }
    if (notifStatusDesc) {
      notifStatusDesc.textContent = "Autorisez les notifications pour recevoir les alertes des nouvelles annonces étudiantes.";
    }
    if (btnNotifAction) {
      btnNotifAction.hidden = false;
      btnNotifAction.disabled = false;
      btnNotifAction.textContent = "🔔 Activer les alertes campus";
    }
    if (btnNotifTest) btnNotifTest.hidden = true;
  }
}

try {
  if ("Notification" in window && Notification.permission === "granted") {
    btnNotifToggle?.classList.add("active");
    if (btnNotifToggle) btnNotifToggle.title = "Alertes campus actives";
  }
} catch (_) {}

// Clic sur la cloche : ouverture immédiate de la modale explicative
btnNotifToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  updateNotifModalState();
  modalNotif?.showModal();
});

btnCloseNotif?.addEventListener("click", () => {
  modalNotif?.close();
});

modalNotif?.addEventListener("click", (e) => {
  if (e.target === modalNotif) modalNotif.close();
});

btnNotifAction?.addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (_) {
    permission = await new Promise((resolve) => Notification.requestPermission(resolve));
  }
  updateNotifModalState();
  if (permission === "granted") {
    btnNotifToggle?.classList.add("active");
    showToast("🎉 Alertes campus activées !");
    await sendSampleNotification();
  } else if (permission === "denied") {
    showToast("⚠️ Notifications bloquées.");
  }
});

btnNotifTest?.addEventListener("click", async () => {
  await sendSampleNotification();
  showToast("📣 Notification de test envoyée !");
});

async function sendSampleNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Troc'Campus 🎒", {
        body: "Alertes campus actives : vous serez notifié dès qu'un don est publié !",
        icon: "/icons/icon-192.png",
        badge: "/icons/favicon.png",
        tag: "troc-welcome"
      });
    } else {
      new Notification("Troc'Campus 🎒", {
        body: "Alertes campus actives : vous serez notifié dès qu'un don est publié !",
        icon: "/icons/icon-192.png"
      });
    }
  } catch (err) {
    console.error("Erreur émission notification:", err);
  }
}

// ---------------------------------------------------------------------------
// 12. État Réseau & Repli universel
// ---------------------------------------------------------------------------
const netIndicator = document.querySelector("#network-status");
const netText = document.querySelector("#network-text");

function updateNetwork(isInitial = false) {
  const isOnline = navigator.onLine;
  if (netIndicator) {
    netIndicator.classList.toggle("off", !isOnline);
  }
  if (netText) {
    netText.textContent = isOnline ? "En ligne" : "Hors ligne";
  }

  // Ne pas déclencher de toast ni de vibration lors de l'initialisation de la page
  if (isInitial) return;

  if (isOnline) {
    showToast("📶 Connexion rétablie : synchronisation en cours...");
    // Délai de temporisation pour stabilisation de la connexion cellulaire/WiFi
    setTimeout(() => {
      flushOutbox();
    }, 1200);
  } else {
    showToast("Mode hors ligne actif (données en cache)");
  }
}

window.addEventListener("online", () => updateNetwork(false));
window.addEventListener("offline", () => updateNetwork(false));

// ---------------------------------------------------------------------------
// 13. Réception Web Share Target
// ---------------------------------------------------------------------------
async function checkSharedDrafts() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("shared_received")) {
      const db = await dbPromise;
      if (!db) return;
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
        modalForm.showModal();
        showToast("📥 Objet partagé importé dans le formulaire !");
      }
    }
  } catch (err) {
    console.warn("Erreur checkSharedDrafts :", err);
  }
}

// ---------------------------------------------------------------------------
// 14. Service Worker & Bannière de mise à jour
// ---------------------------------------------------------------------------
let waitingWorker = null;

function showUpdateBanner(worker) {
  waitingWorker = worker;
  const banner = document.querySelector("#update-banner");
  if (banner) {
    banner.hidden = false;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    // 1. Forcer la vérification immédiate auprès du serveur
    reg.update().catch(() => {});

    // 2. Si un worker est déjà en attente
    if (reg.waiting) {
      showUpdateBanner(reg.waiting);
    }

    // 3. Écouter l'arrivée d'une nouvelle version
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner(newWorker);
        }
      });
    });
  }).catch((err) => {
    console.warn("Échec enregistrement Service Worker ou contexte non supporté :", err);
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "SYNC_COMPLETED") {
      updateSyncBadge();
    }
  });

  // Re-vérifier les mises à jour dès que l'utilisateur revient sur l'application
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});
    }
  });
}

document.querySelector("#btn-update-apply")?.addEventListener("click", () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        window.location.reload();
      }
    });
  }
});

// Bouton manuel de vérification de version dans le pied de page
document.querySelector("#btn-force-check-update")?.addEventListener("click", async () => {
  if ("serviceWorker" in navigator) {
    showToast("🔍 Recherche de mises à jour...");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) {
          showUpdateBanner(reg.waiting);
          showToast("✨ Nouvelle version prête !");
        } else {
          showToast("✅ Application à jour.");
        }
      } else {
        window.location.reload();
      }
    } catch (err) {
      showToast(`Erreur mise à jour : ${err.message}`);
    }
  } else {
    window.location.reload();
  }
});

// ---------------------------------------------------------------------------
// 15. Bouton d'installation custom (beforeinstallprompt)
// ---------------------------------------------------------------------------
let deferredPrompt = null;
const btnInstall = document.querySelector("#btn-install");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (btnInstall) btnInstall.hidden = false;
});

btnInstall?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.hidden = true;
});

window.addEventListener("appinstalled", () => {
  if (btnInstall) btnInstall.hidden = true;
  showToast("🎉 Application installée sur l'appareil !");
});

// Initialisation
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initHydration();
    updateNetwork(true);
  });
} else {
  initHydration();
  updateNetwork(true);
}
