// app.js — Logique de l'application Troc'Campus
// IndexedDB, Outbox, Background Sync, Caméra (getUserMedia) et Web Share

// ---------------------------------------------------------------------------
// 1. Notifications Toast légères et console
// ---------------------------------------------------------------------------
function showToast(message) {
  const container = document.querySelector("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.append(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s";
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

function log(msg, category = "app") {
  console.log(`[PWA:${category}] ${msg}`);
}

// ---------------------------------------------------------------------------
// 2. Base de données locale IndexedDB
// ---------------------------------------------------------------------------
const dbPromise = window.idb.openDB("troc-campus-db", 1, {
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
});

// ---------------------------------------------------------------------------
// 3. Hydratation initiale depuis le HTML public (Critère curl / SEO)
// ---------------------------------------------------------------------------
async function initHydration() {
  const db = await dbPromise;
  const count = await db.count("annonces");

  // Première visite : extraire les 3 annonces d'exemple écrites en dur dans le HTML
  if (count === 0) {
    const seedCards = document.querySelectorAll("#annonces-list [data-seed]");
    log(`Importation initiale de ${seedCards.length} annonces publiques du HTML`);

    for (const card of seedCards) {
      const title = card.querySelector(".ad-title")?.textContent.trim() || "Annonce";
      const desc = card.querySelector(".ad-desc")?.textContent.trim() || "";
      const campus = card.querySelector(".ad-location")?.textContent.trim() || "Campus Mariani, Corte";
      const type = card.dataset.type || "don";
      const price = Number(card.dataset.price) || 0;
      const placeholder = card.querySelector(".thumb-icon")?.textContent.trim() || "📦";

      await db.add("annonces", {
        title,
        type,
        price,
        campus,
        contact: "contact@univ-corse.fr",
        description: desc,
        placeholder,
        photo: null,
        isSeed: true,
        createdAt: Date.now() - 3600000
      });
    }
  }

  await checkSharedDrafts();
  await renderAnnonces();
  await updateSyncBadge();
}

// ---------------------------------------------------------------------------
// 4. Rendu DOM sécurisé des annonces (Protection anti-XSS)
// ---------------------------------------------------------------------------
let currentFilter = "all";

async function renderAnnonces() {
  const db = await dbPromise;
  const allAnnonces = await db.getAll("annonces");

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

      const article = document.createElement("article");
      article.className = "ad-content";

      // Miniature photo
      const thumb = document.createElement("div");
      thumb.className = "ad-thumb";
      if (ad.photo) {
        const img = document.createElement("img");
        img.src = ad.photo;
        img.alt = ad.title;
        img.loading = "lazy";
        thumb.append(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "thumb-icon";
        icon.textContent = ad.placeholder || (ad.type === "don" ? "🎁" : ad.type === "vente" ? "💶" : "🔄");
        thumb.append(icon);
      }

      // Détails
      const details = document.createElement("div");
      details.className = "ad-details";

      const top = document.createElement("div");
      top.className = "ad-top";

      const tag = document.createElement("span");
      tag.className = `tag tag-${ad.type}`;
      tag.textContent = ad.type === "don" ? "Don" : ad.type === "vente" ? "Vente" : "Troc";

      const price = document.createElement("span");
      price.className = "ad-price";
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
      loc.textContent = ad.campus;

      const actions = document.createElement("div");
      actions.className = "ad-actions";

      // Capacité : Web Share API
      const btnShare = document.createElement("button");
      btnShare.type = "button";
      btnShare.className = "btn-icon";
      btnShare.textContent = "Partager";
      btnShare.title = "Partager cette annonce";
      btnShare.addEventListener("click", () => shareAd(ad));
      actions.append(btnShare);

      if (!ad.isSeed) {
        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.className = "btn-icon";
        btnDelete.style.color = "var(--danger)";
        btnDelete.textContent = "Supprimer";
        btnDelete.addEventListener("click", async () => {
          await db.delete("annonces", ad.id);
          renderAnnonces();
        });
        actions.append(btnDelete);
      }

      meta.append(loc, actions);
      details.append(top, title, desc, meta);
      article.append(thumb, details);
      li.append(article);

      return li;
    })
  );
}

// Filtres
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter || "all";
    renderAnnonces();
  });
});

// ---------------------------------------------------------------------------
// 5. Capacité : Web Share API (avec repli Presse-papiers)
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
      showToast("Annonce partagée");
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Erreur share", err);
      }
    }
  } else {
    try {
      await navigator.clipboard.writeText(`${shareData.text} — ${shareData.url}`);
      showToast("Lien copié dans le presse-papiers");
    } catch (err) {
      showToast("Impossible de copier le lien");
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Modal de création d'annonce & Gestion Caméra
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

function closeModal() {
  stopCamera();
  modalForm.close();
}

btnCloseForm?.addEventListener("click", closeModal);
btnCancelForm?.addEventListener("click", closeModal);

typeSelect?.addEventListener("change", () => {
  if (fieldPrice) {
    fieldPrice.hidden = typeSelect.value !== "vente";
  }
});

// Caméra (getUserMedia)
let cameraStream = null;
let currentPhotoDataUrl = null;

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

btnCamera?.addEventListener("click", async () => {
  cameraError.hidden = true;

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.textContent = "Caméra non supportée par votre navigateur. Utilisez le sélecteur de fichier.";
    cameraError.hidden = false;
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    videoWrapper.hidden = false;
  } catch (err) {
    log(`Refus caméra : ${err.name}`, "camera");
    cameraError.textContent = (err.name === "NotAllowedError")
      ? "Permission caméra refusée. Autorisez l'accès dans les réglages ou sélectionnez un fichier."
      : "Impossible d'accéder à la caméra.";
    cameraError.hidden = false;
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
  currentPhotoDataUrl = cameraCanvas.toDataURL("image/jpeg", 0.82);

  stopCamera();
  showPhotoPreview(currentPhotoDataUrl);
  showToast("Photo enregistrée");
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (videoWrapper) videoWrapper.hidden = true;
}

btnCameraClose?.addEventListener("click", stopCamera);

photoFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    currentPhotoDataUrl = evt.target.result;
    showPhotoPreview(currentPhotoDataUrl);
  };
  reader.readAsDataURL(file);
});

function showPhotoPreview(url) {
  if (!photoPreviewBox || !photoPreviewImg) return;
  photoPreviewImg.src = url;
  photoPreviewBox.hidden = false;
}

btnPhotoRemove?.addEventListener("click", () => {
  currentPhotoDataUrl = null;
  if (photoPreviewBox) photoPreviewBox.hidden = true;
  if (photoFileInput) photoFileInput.value = "";
});

// Soumission formulaire
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
  const localId = await db.add("annonces", newAd);

  await db.add("outbox", {
    action: "create_ad",
    payload: { id: localId, ...newAd },
    timestamp: Date.now()
  });

  formAnnonce.reset();
  currentPhotoDataUrl = null;
  if (photoPreviewBox) photoPreviewBox.hidden = true;
  if (photoFileInput) photoFileInput.value = "";
  if (fieldPrice) fieldPrice.hidden = true;

  closeModal();
  await renderAnnonces();
  await updateSyncBadge();
  await triggerSync();
  showToast("Annonce publiée !");
});

// ---------------------------------------------------------------------------
// 7. Synchronisation & Outbox
// ---------------------------------------------------------------------------
async function triggerSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register("sync-outbox");
      return;
    } catch (err) {
      log(`Échec sync.register (${err.message})`, "sync");
    }
  }

  if (navigator.onLine) {
    await flushOutbox();
  }
}

async function flushOutbox() {
  const db = await dbPromise;
  const items = await db.getAll("outbox");
  if (items.length === 0) return;

  const syncPill = document.querySelector("#sync-status");
  if (syncPill) {
    syncPill.textContent = `Envoi (${items.length})...`;
    syncPill.hidden = false;
  }

  for (const item of items) {
    try {
      const res = await fetch("https://httpbin.org/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload)
      });
      if (res.ok) {
        await db.delete("outbox", item.id);
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  await updateSyncBadge();
}

async function updateSyncBadge() {
  const db = await dbPromise;
  const remaining = await db.count("outbox");
  const pill = document.querySelector("#sync-status");
  if (!pill) return;

  if (remaining === 0) {
    pill.hidden = true;
  } else {
    pill.textContent = `En attente (${remaining})`;
    pill.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// 8. Écoute réseau
// ---------------------------------------------------------------------------
const netIndicator = document.querySelector("#network-status");
const netText = document.querySelector("#network-text");

function updateNetwork() {
  const isOnline = navigator.onLine;
  if (netIndicator) {
    netIndicator.classList.toggle("off", !isOnline);
  }
  if (netText) {
    netText.textContent = isOnline ? "En ligne" : "Hors ligne";
  }

  if (isOnline) {
    flushOutbox();
  } else {
    showToast("Mode hors ligne actif");
  }
}

window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);

// ---------------------------------------------------------------------------
// 9. Réception Share Target
// ---------------------------------------------------------------------------
async function checkSharedDrafts() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("shared_received")) {
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
      modalForm.showModal();
      showToast("Objet partagé importé");
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Service Worker & Bannière de mise à jour
// ---------------------------------------------------------------------------
let waitingWorker = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = newWorker;
          const banner = document.querySelector("#update-banner");
          if (banner) banner.hidden = false;
        }
      });
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "SYNC_COMPLETED") {
      updateSyncBadge();
    }
  });
}

document.querySelector("#btn-update-apply")?.addEventListener("click", () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }
});

// ---------------------------------------------------------------------------
// 11. Bouton d'installation custom (beforeinstallprompt)
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
  showToast("Application installée");
});

// Démarrage
window.addEventListener("DOMContentLoaded", () => {
  initHydration();
  updateNetwork();
});
