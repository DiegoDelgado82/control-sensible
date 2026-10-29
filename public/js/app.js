import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  profile: null,
  dashboard: null,
  products: [],
  movements: [],
  users: [],
  audit: [],
  catalogs: { vendedores: [], seguridad: [] },
  currentCatalog: "vendedores",
  selectedMovement: null,
  importRows: [],
  importFileName: ""
};

const MOVEMENT_LABELS = {
  ingreso: "Ingreso",
  reingreso: "Reingreso",
  venta_sensible: "Venta desde sensible",
  exhibicion_inicial: "Exhibición inicial",
  salida_exhibicion: "Salida a exhibición",
  venta_exhibicion: "Venta desde exhibición",
  transferencia: "Transferencia",
  salida_service: "Salida a service",
  cambio_estado: "Cambio de estado",
  anulacion: "Anulación"
};

const MOVEMENT_ICONS = {
  ingreso: "icon-in",
  reingreso: "icon-in",
  venta_sensible: "icon-out",
  exhibicion_inicial: "icon-display",
  salida_exhibicion: "icon-display",
  venta_exhibicion: "icon-out",
  transferencia: "icon-movements",
  salida_service: "icon-out",
  cambio_estado: "icon-state",
  anulacion: "icon-state"
};

const STATE_LABELS = {
  ok: "OK",
  para_service: "Para service",
  roto: "Roto",
  con_faltantes: "Con faltantes"
};

const AUDIT_LABELS = {
  crear_movimiento: "Movimiento registrado",
  anular_movimiento: "Movimiento anulado",
  crear_producto: "Producto creado",
  modificar_producto: "Producto modificado",
  importar_productos: "Productos importados desde XLSX",
  crear_usuario: "Usuario creado",
  modificar_usuario: "Usuario modificado",
  resetear_clave: "Contraseña restablecida",
  cambio_clave_propia: "Contraseña propia modificada"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function usernameToEmail(username) {
  return `${normalizeUsername(username)}@controlsensible.app`;
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function setBusy(button, busy, label = "Procesando...") {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.textContent = label;
    button.disabled = true;
  } else {
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    button.disabled = false;
  }
}

async function api(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("La sesión no está disponible.");
  const token = await user.getIdToken();
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    if (response.status === 401) await signOut(auth);
    throw new Error(payload.error || "No fue posible completar la operación.");
  }
  return payload;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-AR").format(Number(value || 0));
}

function formatDate(value, withTime = true) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", withTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "short" }).format(date);
}

function initials(name) {
  return String(name || "U").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function profileLabel(profile) {
  return profile === "administrador" ? "Administrador" : profile === "jefe" ? "Jefe" : "Vendedor";
}

function closeDialog(dialog) {
  if (dialog?.id === "barcodeScannerDialog") stopBarcodeScanner();
  if (dialog?.open) dialog.close();
}

function openDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal();
}

function showView(targetId) {
  $$(".view-section").forEach(section => section.classList.toggle("active", section.id === targetId));
  $$(".bottom-nav button[data-target]").forEach(button => button.classList.toggle("active", button.dataset.target === targetId));
  const target = document.getElementById(targetId);
  $("#viewTitle").textContent = target?.dataset.title || "Control Sensible";
  $(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });

  if (targetId === "productsSection") loadAdminProducts();
  if (targetId === "usersSection") loadUsers();
  if (targetId === "catalogsSection") loadCatalog(state.currentCatalog, true);
  if (targetId === "auditSection") loadAudit();
  if (targetId === "movementsSection") loadMovements();
}

function applyProfile() {
  const profile = state.profile;
  const isAdmin = profile.perfil === "administrador";
  const canOperate = ["administrador", "jefe"].includes(profile.perfil);
  $$(".admin-only").forEach(element => element.hidden = !isAdmin);
  $$(".operator-only").forEach(element => element.hidden = !canOperate);
  $("#profileName").textContent = profile.nombre;
  $("#profileType").textContent = profileLabel(profile.perfil);
  $("#profileInitials").textContent = initials(profile.nombre);
  $("#dashboardGreeting").textContent = profile.perfil === "vendedor" ? "Disponibilidad del sensible" : `Panel del ${profileLabel(profile.perfil)}`;
  $("#dashboardEyebrow").textContent = profile.perfil === "vendedor" ? "CONSULTA EN LÍNEA" : "RESUMEN OPERATIVO";
  $("#recentPanel").hidden = profile.perfil === "vendedor";
  const movementNav = $('.bottom-nav button[data-target="movementsSection"]');
  movementNav.hidden = profile.perfil === "vendedor";
  $("#appShell").classList.toggle("seller-view", profile.perfil === "vendedor");
}

async function loadDashboard() {
  try {
    const data = await api("dashboard");
    state.dashboard = data;
    $("#kpiAvailable").textContent = formatNumber(data.totales.disponible);
    $("#kpiReal").textContent = formatNumber(data.totales.real);
    $("#kpiDisplay").textContent = formatNumber(data.totales.exhibicion);
    $("#kpiTotal").textContent = formatNumber(data.totales.total);
    renderRecentMovements(data.recientes || []);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function movementCard(movement, compact = false) {
  const typeLabel = MOVEMENT_LABELS[movement.tipo] || movement.tipo;
  const itemSummary = movement.resumen || `${movement.cantidadUnidades || 0} unidad(es)`;
  return `
    <article class="record-card clickable movement-record" data-movement-id="${escapeHtml(movement.id)}">
      <span class="record-icon" aria-hidden="true"><svg class="icon"><use href="#${escapeHtml(MOVEMENT_ICONS[movement.tipo] || "icon-movements")}"></use></svg></span>
      <div class="record-main">
        <strong>${escapeHtml(typeLabel)}</strong>
        <small>${escapeHtml(itemSummary)}${movement.ticket ? ` · Ticket ${escapeHtml(movement.ticket)}` : ""}</small>
        ${compact ? "" : `<small>Registrado por ${escapeHtml(movement.usuarioNombre || "Usuario")}</small>`}
      </div>
      <div class="record-meta">
        <span class="badge ${escapeHtml(movement.estado || "registrado")}">${escapeHtml(movement.estado || "Registrado")}</span>
        <small>${escapeHtml(formatDate(movement.fecha))}</small>
      </div>
    </article>`;
}

function renderRecentMovements(movements) {
  const container = $("#recentMovements");
  if (!movements.length) {
    container.className = "record-list empty-state";
    container.textContent = "Todavía no hay movimientos registrados.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = movements.slice(0, 5).map(item => movementCard(item, true)).join("");
}

async function searchProducts(term = "") {
  const container = $("#searchResults");
  container.className = "product-grid empty-state";
  container.textContent = "Buscando productos...";
  try {
    const data = await api(`productos?q=${encodeURIComponent(term)}&limit=2000`);
    let products = data.productos || [];
    if ($("#onlyAvailable").checked) products = products.filter(product => Number(product.stockSensibleDisponible || 0) > 0);
    renderProductSearch(products);
  } catch (error) {
    container.textContent = error.message;
    showToast(error.message, "error");
  }
}

function renderProductSearch(products) {
  const container = $("#searchResults");
  if (!products.length) {
    container.className = "product-grid empty-state";
    container.textContent = "No se encontraron productos aptos con ese criterio.";
    return;
  }
  container.className = "product-grid";
  container.innerHTML = products.map(product => {
    const available = Number(product.stockSensibleDisponible || 0);
    return `
      <article class="product-card">
        <div class="product-header">
          <div><h3>${escapeHtml(product.descripcion)}</h3><span class="ean">EAN ${escapeHtml(product.ean)}</span></div>
          <span class="badge ${available > 0 ? "ok" : "warning"}">${available > 0 ? "APTO" : "NO DISPONIBLE"}</span>
        </div>
        <div class="stock-row">
          <div class="stock-item"><span>Disponible</span><strong>${formatNumber(available)}</strong></div>
          <div class="stock-item"><span>Stock real</span><strong>${formatNumber(product.stockSensibleReal)}</strong></div>
          <div class="stock-item"><span>Exhibición</span><strong>${formatNumber(product.stockExhibicion)}</strong></div>
        </div>
      </article>`;
  }).join("");
}

async function loadMovements() {
  const container = $("#movementList");
  container.className = "record-list empty-state";
  container.textContent = "Cargando movimientos...";
  try {
    const data = await api("movimientos?limit=200");
    state.movements = data.movimientos || [];
    renderMovements();
  } catch (error) {
    container.textContent = error.message;
  }
}

function renderMovements() {
  const term = $("#movementSearch").value.trim().toLowerCase();
  const type = $("#movementTypeFilter").value;
  const filtered = state.movements.filter(movement => {
    const text = [movement.ticket, movement.usuarioNombre, movement.resumen, ...(movement.items || []).flatMap(item => [item.ean, item.descripcion, ...(item.imeis || [])])].join(" ").toLowerCase();
    return (!term || text.includes(term)) && (!type || movement.tipo === type);
  });
  const container = $("#movementList");
  if (!filtered.length) {
    container.className = "record-list empty-state";
    container.textContent = "No hay movimientos para mostrar.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = filtered.map(item => movementCard(item)).join("");
}

function showMovementDetail(id) {
  const movement = state.movements.find(item => item.id === id) || state.dashboard?.recientes?.find(item => item.id === id);
  if (!movement) return;
  state.selectedMovement = movement;
  $("#detailTitle").textContent = MOVEMENT_LABELS[movement.tipo] || "Movimiento";
  const items = movement.items || [];
  $("#detailContent").innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><span>Estado</span><strong>${escapeHtml(movement.estado || "registrado")}</strong></div>
      <div class="detail-item"><span>Fecha</span><strong>${escapeHtml(formatDate(movement.fecha))}</strong></div>
      <div class="detail-item"><span>Usuario</span><strong>${escapeHtml(movement.usuarioNombre || "-")}</strong></div>
      <div class="detail-item"><span>Ticket</span><strong>${escapeHtml(movement.ticket || "No corresponde")}</strong></div>
      <div class="detail-item"><span>Vendedor</span><strong>${escapeHtml(movement.vendedorNombre || "Sin asignar")}</strong></div>
      <div class="detail-item"><span>Seguridad</span><strong>${escapeHtml(movement.seguridadNombre || "Sin asignar")}</strong></div>
    </div>
    <h3 style="margin-top:18px">Productos</h3>
    <div class="record-list">
      ${items.length ? items.map(item => `<div class="record-card"><div class="record-main"><strong>${escapeHtml(item.descripcion || item.ean)}</strong><small>EAN ${escapeHtml(item.ean)} · Cantidad ${formatNumber(item.cantidad)}</small>${item.imeis?.length ? `<small>IMEI: ${item.imeis.map(escapeHtml).join(", ")}</small>` : ""}</div><div class="record-meta"><small>${escapeHtml(item.fromLocation || "-")} → ${escapeHtml(item.toLocation || "-")}</small></div></div>`).join("") : `<p class="muted">El resumen no incluye detalle de productos.</p>`}
    </div>
    ${movement.observaciones ? `<h3 style="margin-top:18px">Observaciones</h3><p>${escapeHtml(movement.observaciones)}</p>` : ""}`;

  const actions = $("#detailActions");
  actions.innerHTML = "";
  if (state.profile.perfil === "administrador" && movement.estado === "registrado" && movement.tipo !== "anulacion") {
    const cancelButton = document.createElement("button");
    cancelButton.className = "secondary-button danger-text";
    cancelButton.type = "button";
    cancelButton.textContent = "Anular movimiento";
    cancelButton.addEventListener("click", () => cancelMovement(movement.id));
    actions.append(cancelButton);
  }
  openDialog($("#detailDialog"));
}

async function cancelMovement(id) {
  const reason = window.prompt("Indicá el motivo de la anulación:");
  if (!reason?.trim()) return;
  try {
    await api("movimientos", { method: "POST", body: JSON.stringify({ accion: "anular", movimientoId: id, motivo: reason.trim() }) });
    closeDialog($("#detailDialog"));
    showToast("Movimiento anulado correctamente.");
    await Promise.all([loadDashboard(), loadMovements(), loadAdminProducts()]);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadAdminProducts() {
  if (state.profile?.perfil !== "administrador") return;
  try {
    const data = await api("productos?limit=2000");
    state.products = data.productos || [];
    renderAdminProducts();
  } catch (error) {
    $("#adminProductList").textContent = error.message;
  }
}

function renderAdminProducts() {
  const term = $("#adminProductSearch").value.trim().toLowerCase();
  const products = state.products.filter(product => !term || product.ean.includes(term.replace(/\D/g, "")) || product.descripcion.toLowerCase().includes(term));
  const container = $("#adminProductList");
  if (!products.length) {
    container.className = "record-list empty-state";
    container.textContent = "No hay productos para mostrar.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = products.map(product => `
    <article class="record-card">
      <div class="record-main"><strong>${escapeHtml(product.descripcion)}</strong><small>EAN ${escapeHtml(product.ean)} · ${escapeHtml(product.tipo)}</small><small>Disponible ${formatNumber(product.stockSensibleDisponible)} · Real ${formatNumber(product.stockSensibleReal)} · Exhibición ${formatNumber(product.stockExhibicion)}</small></div>
      <div class="record-meta"><span class="badge ${product.activo ? "ok" : "warning"}">${product.activo ? "Activo" : "Inactivo"}</span><button type="button" class="link-button" data-edit-product="${escapeHtml(product.ean)}">Editar</button></div>
    </article>`).join("");
}

function openProductForm(product = null) {
  $("#productForm").reset();
  $("#productOriginalEan").value = product?.ean || "";
  $("#productEan").value = product?.ean || "";
  $("#productEan").disabled = Boolean(product);
  $("#scanProductEan").hidden = Boolean(product);
  $("#productDescription").value = product?.descripcion || "";
  $("#productType").value = product?.tipo || "otro";
  $("#productDialogTitle").textContent = product ? "Editar producto" : "Nuevo producto";
  openDialog($("#productDialog"));
}

async function saveProduct(event) {
  event.preventDefault();
  const button = event.submitter;
  const editing = Boolean($("#productOriginalEan").value);
  const current = editing ? state.products.find(item => item.ean === $("#productOriginalEan").value) : null;
  const body = {
    ean: $("#productOriginalEan").value || $("#productEan").value,
    descripcion: $("#productDescription").value,
    tipo: $("#productType").value,
    activo: current?.activo !== false
  };
  try {
    setBusy(button, true);
    await api("productos", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
    closeDialog($("#productDialog"));
    showToast(editing ? "Producto actualizado." : "Producto creado.");
    await loadAdminProducts();
  } catch (error) {
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
}

let scannerControls = null;
let scannerReader = null;

function stopBarcodeScanner() {
  try { scannerControls?.stop(); } catch { /* La cámara ya estaba detenida. */ }
  scannerControls = null;
  scannerReader = null;
  const video = $("#barcodeVideo");
  if (video) video.srcObject = null;
}

async function openBarcodeScanner(onDetected) {
  if (!window.ZXingBrowser?.BrowserMultiFormatOneDReader) {
    showToast("El lector de cámara no pudo iniciarse. Ingresá el EAN manualmente.", "error");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Este dispositivo no permite utilizar la cámara desde el navegador.", "error");
    return;
  }

  stopBarcodeScanner();
  $("#scannerStatus").textContent = "Permití el acceso a la cámara y apuntá al código de barras.";
  openDialog($("#barcodeScannerDialog"));

  try {
    scannerReader = new window.ZXingBrowser.BrowserMultiFormatOneDReader();
    scannerControls = await scannerReader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      $("#barcodeVideo"),
      async (result, error, controls) => {
        if (!result) return;
        const ean = String(result.getText?.() || result.text || "").replace(/\D/g, "");
        if (ean.length < 6 || ean.length > 14) {
          $("#scannerStatus").textContent = "El código detectado no corresponde a un EAN válido.";
          return;
        }
        try { controls.stop(); } catch { /* Ya detenido. */ }
        scannerControls = null;
        closeDialog($("#barcodeScannerDialog"));
        if (navigator.vibrate) navigator.vibrate(100);
        await onDetected(ean);
      }
    );
  } catch (error) {
    stopBarcodeScanner();
    closeDialog($("#barcodeScannerDialog"));
    const denied = error?.name === "NotAllowedError" || /permission|denied|permiso/i.test(error?.message || "");
    showToast(denied ? "No se otorgó permiso para utilizar la cámara." : "No fue posible iniciar la cámara. Ingresá el EAN manualmente.", "error");
  }
}

async function scanProductEan() {
  await openBarcodeScanner(async ean => {
    $("#productEan").value = ean;
    try {
      const data = await api(`productos?ean=${encodeURIComponent(ean)}`);
      if (data.producto) {
        openProductForm(data.producto);
        showToast("El EAN ya existe. Se abrió el producto registrado.");
        return;
      }
      $("#productDescription").focus();
      showToast("EAN leído. Completá la descripción y el tipo.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function lookupProductFormEan() {
  const ean = $("#productEan").value.replace(/\D/g, "");
  if (!ean) return showToast("Ingresá un EAN para buscar.", "error");
  try {
    const data = await api(`productos?ean=${encodeURIComponent(ean)}`);
    if (!data.producto) {
      $("#productDescription").focus();
      showToast("El EAN es nuevo. Completá la descripción y el tipo.");
      return;
    }
    openProductForm(data.producto);
    showToast("Producto encontrado.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function rawExcelValue(cell) {
  let value = cell?.value;
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "result")) value = value.result;
    else if (Array.isArray(value.richText)) value = value.richText.map(part => part.text || "").join("");
    else if (Object.prototype.hasOwnProperty.call(value, "text")) value = value.text;
  }
  return value ?? cell?.text ?? "";
}

function normalizeImportedEan(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("el EAN numérico no es un entero válido");
    value = String(value);
  }
  let text = String(value ?? "").trim();
  if (/^\d+(?:[.,]0+)?[eE][+]?[0-9]+$/.test(text) || /^\d+[eE][+]?[0-9]+$/.test(text)) {
    const numeric = Number(text.replace(",", "."));
    if (!Number.isSafeInteger(numeric)) throw new Error("el EAN en notación científica no puede convertirse con seguridad");
    text = String(numeric);
  }
  if (!/^\d{6,14}$/.test(text)) throw new Error("el EAN debe contener entre 6 y 14 dígitos");
  return text;
}

function resetImportDialog() {
  state.importRows = [];
  state.importFileName = "";
  $("#importProductsForm").reset();
  $("#importSummary").hidden = true;
  $("#importErrors").hidden = true;
  $("#importPreview").hidden = true;
  $("#confirmProductImport").disabled = true;
}

function renderImportPreview(rows, errors) {
  const summary = $("#importSummary");
  summary.hidden = false;
  summary.innerHTML = `
    <div class="import-stat"><span>Filas leídas</span><strong>${formatNumber(rows.length + errors.length)}</strong></div>
    <div class="import-stat"><span>Productos válidos</span><strong>${formatNumber(rows.length)}</strong></div>
    <div class="import-stat"><span>Errores</span><strong>${formatNumber(errors.length)}</strong></div>
    <div class="import-stat"><span>Estado inicial</span><strong>Activo</strong></div>`;

  const errorBox = $("#importErrors");
  errorBox.hidden = !errors.length;
  errorBox.innerHTML = errors.length
    ? `<strong>Corregí el archivo antes de importar:</strong><ul>${errors.slice(0, 60).map(error => `<li>${escapeHtml(error)}</li>`).join("")}</ul>${errors.length > 60 ? `<p>Y ${errors.length - 60} error(es) más.</p>` : ""}`
    : "";

  const preview = $("#importPreview");
  preview.hidden = !rows.length;
  preview.innerHTML = rows.length ? `
    <table class="preview-table"><thead><tr><th>EAN</th><th>Descripción</th><th>Tipo</th></tr></thead>
    <tbody>${rows.slice(0, 100).map(row => `<tr><td>${escapeHtml(row.ean)}</td><td>${escapeHtml(row.descripcion)}</td><td>${escapeHtml(row.tipo)}</td></tr>`).join("")}</tbody></table>
    ${rows.length > 100 ? `<p class="helper" style="padding:0 10px">Se muestran las primeras 100 filas de ${formatNumber(rows.length)}.</p>` : ""}` : "";

  $("#confirmProductImport").disabled = !rows.length || Boolean(errors.length);
}

async function readProductWorkbook(file) {
  if (!file?.name?.toLowerCase().endsWith(".xlsx")) throw new Error("Seleccioná un archivo con extensión .xlsx.");
  if (!window.ExcelJS?.Workbook) throw new Error("El lector de Excel no está disponible.");

  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo no contiene ninguna hoja.");

  const headerMap = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => headerMap.set(normalizeHeader(rawExcelValue(cell)), columnNumber));
  const required = ["EAN", "DESCRIPCION", "TIPO"];
  const missing = required.filter(header => !headerMap.has(header));
  if (missing.length) throw new Error(`Faltan las columnas: ${missing.join(", ")}.`);

  const rows = [];
  const errors = [];
  const seen = new Set();

  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rawEan = rawExcelValue(row.getCell(headerMap.get("EAN")));
    const rawDescription = rawExcelValue(row.getCell(headerMap.get("DESCRIPCION")));
    const rawType = rawExcelValue(row.getCell(headerMap.get("TIPO")));
    if (![rawEan, rawDescription, rawType].some(value => String(value ?? "").trim())) continue;

    try {
      const ean = normalizeImportedEan(rawEan);
      const descripcion = String(rawDescription ?? "").trim().slice(0, 160);
      const tipo = normalizeHeader(rawType).toLowerCase();
      if (!descripcion) throw new Error("la descripción es obligatoria");
      if (!["celular", "tablet", "consola", "otro"].includes(tipo)) throw new Error("el tipo debe ser celular, tablet, consola u otro");
      if (seen.has(ean)) throw new Error(`el EAN ${ean} está repetido en el archivo`);
      seen.add(ean);
      rows.push({ fila: rowNumber, ean, descripcion, tipo });
    } catch (error) {
      errors.push(`Fila ${rowNumber}: ${error.message}.`);
    }
  }

  if (rows.length + errors.length > 2000) errors.unshift("El archivo supera el máximo de 2000 productos por importación.");
  return { rows, errors };
}

async function handleProductImportFile(event) {
  const file = event.target.files?.[0];
  state.importRows = [];
  state.importFileName = file?.name || "";
  $("#confirmProductImport").disabled = true;
  if (!file) return;

  try {
    const { rows, errors } = await readProductWorkbook(file);
    state.importRows = rows;
    renderImportPreview(rows, errors);
  } catch (error) {
    renderImportPreview([], [error.message]);
  }
}

async function importProducts(event) {
  event.preventDefault();
  if (!state.importRows.length) return showToast("Seleccioná y validá un archivo XLSX.", "error");
  const button = event.submitter;
  try {
    setBusy(button, true, "Importando...");
    const result = await api("importar-productos", {
      method: "POST",
      body: JSON.stringify({ archivo: state.importFileName, productos: state.importRows })
    });
    closeDialog($("#importProductsDialog"));
    showToast(result.mensaje || "Productos importados correctamente.");
    resetImportDialog();
    await loadAdminProducts();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadUsers() {
  if (state.profile?.perfil !== "administrador") return;
  try {
    const data = await api("usuarios");
    state.users = data.usuarios || [];
    renderUsers();
  } catch (error) {
    $("#userList").textContent = error.message;
  }
}

function renderUsers() {
  const container = $("#userList");
  if (!state.users.length) {
    container.className = "record-list empty-state";
    container.textContent = "No hay usuarios para mostrar.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = state.users.map(user => `
    <article class="record-card">
      <div class="record-main"><strong>${escapeHtml(user.nombre)}</strong><small>@${escapeHtml(user.usuario)} · ${escapeHtml(profileLabel(user.perfil))}</small></div>
      <div class="record-meta"><span class="badge ${user.activo ? "ok" : "warning"}">${user.activo ? "Activo" : "Inactivo"}</span><button type="button" class="link-button" data-edit-user="${escapeHtml(user.uid)}">Editar</button><button type="button" class="link-button" data-reset-user="${escapeHtml(user.uid)}">Clave</button></div>
    </article>`).join("");
}

function openUserForm(user = null) {
  $("#userForm").reset();
  $("#userUid").value = user?.uid || "";
  $("#userUsername").value = user?.usuario || "";
  $("#userUsername").disabled = Boolean(user);
  $("#userName").value = user?.nombre || "";
  $("#userProfile").value = user?.perfil || "vendedor";
  $("#userActive").checked = user?.activo !== false;
  $("#userPasswordField").hidden = Boolean(user);
  $("#userPassword").required = !user;
  $("#userActiveField").hidden = !user;
  $("#userDialogTitle").textContent = user ? "Editar usuario" : "Nuevo usuario";
  openDialog($("#userDialog"));
}

async function saveUser(event) {
  event.preventDefault();
  const button = event.submitter;
  const uid = $("#userUid").value;
  const body = {
    uid,
    usuario: $("#userUsername").value,
    nombre: $("#userName").value,
    perfil: $("#userProfile").value,
    activo: $("#userActive").checked,
    password: $("#userPassword").value
  };
  try {
    setBusy(button, true);
    await api("usuarios", { method: uid ? "PATCH" : "POST", body: JSON.stringify(body) });
    closeDialog($("#userDialog"));
    showToast(uid ? "Usuario actualizado." : "Usuario creado.");
    await loadUsers();
  } catch (error) {
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
}

function openResetPassword(uid) {
  $("#resetPasswordForm").reset();
  $("#resetPasswordUid").value = uid;
  openDialog($("#resetPasswordDialog"));
}

async function resetUserPassword(event) {
  event.preventDefault();
  const uid = $("#resetPasswordUid").value;
  const password = $("#resetPasswordValue").value;
  const button = event.submitter;
  try {
    setBusy(button, true);
    await api("usuarios", { method: "PATCH", body: JSON.stringify({ uid, accion: "resetear_clave", password }) });
    closeDialog($("#resetPasswordDialog"));
    showToast("Contraseña restablecida. Se solicitará cambiarla al ingresar.");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
}

async function loadCatalog(type, render = false) {
  try {
    const data = await api(`catalogos?tipo=${type}`);
    state.catalogs[type] = data.items || [];
    populateMovementCatalogs();
    if (render && state.currentCatalog === type) renderCatalog();
  } catch (error) {
    if (render) $("#catalogList").textContent = error.message;
  }
}

function populateMovementCatalogs() {
  const configs = [
    ["#movementSeller", state.catalogs.vendedores],
    ["#movementSecurity", state.catalogs.seguridad]
  ];
  for (const [selector, items] of configs) {
    const select = $(selector);
    const current = select.value;
    select.innerHTML = `<option value="">Sin asignar</option>` + items.filter(item => item.activo !== false).map(item => `<option value="${escapeHtml(item.id)}" data-name="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</option>`).join("");
    select.value = current;
  }
}

function renderCatalog() {
  const container = $("#catalogList");
  const items = state.catalogs[state.currentCatalog] || [];
  if (!items.length) {
    container.className = "record-list empty-state";
    container.textContent = "No hay registros en este listado.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = items.map(item => `
    <article class="record-card"><div class="record-main"><strong>${escapeHtml(item.nombre)}</strong><small>${state.currentCatalog === "vendedores" ? "Vendedor" : "Personal de Seguridad"}</small></div><div class="record-meta"><span class="badge ${item.activo !== false ? "ok" : "warning"}">${item.activo !== false ? "Activo" : "Inactivo"}</span><button type="button" class="link-button" data-toggle-catalog="${escapeHtml(item.id)}">${item.activo !== false ? "Desactivar" : "Activar"}</button></div></article>`).join("");
}

async function loadAudit() {
  if (state.profile?.perfil !== "administrador") return;
  const container = $("#auditList");
  container.className = "record-list empty-state";
  container.textContent = "Cargando auditoría...";
  try {
    const data = await api("auditoria?limit=200");
    state.audit = data.registros || [];
    renderAudit();
  } catch (error) {
    container.textContent = error.message;
  }
}

function renderAudit() {
  const container = $("#auditList");
  if (!state.audit.length) {
    container.className = "record-list empty-state";
    container.textContent = "No hay acciones para mostrar.";
    return;
  }
  container.className = "record-list";
  container.innerHTML = state.audit.map(item => {
    const references = [
      item.tipo ? MOVEMENT_LABELS[item.tipo] || item.tipo : "",
      item.ean ? `EAN ${item.ean}` : "",
      item.movimientoId ? `Movimiento ${item.movimientoId}` : "",
      item.objetivoNombre ? `Usuario afectado: ${item.objetivoNombre}` : ""
    ].filter(Boolean).join(" · ");
    return `<article class="record-card"><div class="record-main"><strong>${escapeHtml(AUDIT_LABELS[item.accion] || item.accion)}</strong><small>Realizado por ${escapeHtml(item.usuarioNombre || "Usuario")}</small>${references ? `<small>${escapeHtml(references)}</small>` : ""}</div><div class="record-meta"><small>${escapeHtml(formatDate(item.fecha))}</small></div></article>`;
  }).join("");
}

async function addCatalogItem(event) {
  event.preventDefault();
  const name = $("#catalogName").value.trim();
  if (!name) return;
  try {
    await api(`catalogos?tipo=${state.currentCatalog}`, { method: "POST", body: JSON.stringify({ tipo: state.currentCatalog, nombre: name }) });
    $("#catalogName").value = "";
    showToast("Registro agregado.");
    await loadCatalog(state.currentCatalog, true);
  } catch (error) { showToast(error.message, "error"); }
}

function openQuickCatalog(type) {
  $("#quickCatalogForm").reset();
  $("#quickCatalogType").value = type;
  $("#quickCatalogTitle").textContent = type === "vendedores" ? "Agregar vendedor" : "Agregar guardia";
  openDialog($("#quickCatalogDialog"));
  setTimeout(() => $("#quickCatalogName").focus(), 0);
}

async function saveQuickCatalog(event) {
  event.preventDefault();
  const button = event.submitter;
  const type = $("#quickCatalogType").value;
  const name = $("#quickCatalogName").value.trim();
  if (!name) return;
  try {
    setBusy(button, true, "Agregando...");
    const result = await api(`catalogos?tipo=${type}`, { method: "POST", body: JSON.stringify({ tipo: type, nombre: name }) });
    await loadCatalog(type);
    const select = type === "vendedores" ? $("#movementSeller") : $("#movementSecurity");
    select.value = result.id;
    closeDialog($("#quickCatalogDialog"));
    showToast(type === "vendedores" ? "Vendedor agregado y seleccionado." : "Guardia agregado y seleccionado.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function toggleCatalogItem(id) {
  const item = state.catalogs[state.currentCatalog].find(entry => entry.id === id);
  if (!item) return;
  try {
    await api(`catalogos?tipo=${state.currentCatalog}`, { method: "PATCH", body: JSON.stringify({ tipo: state.currentCatalog, id, nombre: item.nombre, activo: item.activo === false }) });
    await loadCatalog(state.currentCatalog, true);
  } catch (error) { showToast(error.message, "error"); }
}

function fillMovementTypeOptions() {
  const options = Object.entries(MOVEMENT_LABELS).filter(([key]) => key !== "anulacion").map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
  $("#movementType").innerHTML = options;
  $("#movementTypeFilter").innerHTML = `<option value="">Todos</option>` + Object.entries(MOVEMENT_LABELS).map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
}

function addMovementItem() {
  const fragment = $("#movementItemTemplate").content.cloneNode(true);
  $("#movementItems").append(fragment);
  renumberMovementItems();
  const item = $("#movementItems .movement-item:last-child");
  item.querySelector('[data-item="tipo"]').addEventListener("change", () => updateItemType(item));
  item.querySelector("[data-lookup-ean]").addEventListener("click", () => lookupMovementEan(item));
  item.querySelector("[data-scan-ean]").addEventListener("click", () => openBarcodeScanner(async ean => {
    item.querySelector('[data-item="ean"]').value = ean;
    await lookupMovementEan(item);
  }));
  item.querySelector("[data-remove-item]").addEventListener("click", () => {
    item.remove();
    if (!$("#movementItems").children.length) addMovementItem();
    renumberMovementItems();
  });
  updateItemFields(item);
}

function renumberMovementItems() {
  $$("#movementItems .movement-item").forEach((item, index) => { item.querySelector("[data-line-number]").textContent = index + 1; });
}

function updateItemType(item) {
  const type = item.querySelector('[data-item="tipo"]').value;
  const phone = type === "celular";
  item.querySelector("[data-imei-field]").hidden = !phone;
  item.querySelector("[data-serial-field]").hidden = type !== "otro";
  const quantity = item.querySelector('[data-item="cantidad"]');
  quantity.disabled = phone;
  if (phone) quantity.value = 1;
}

function updateItemFields(item) {
  const type = $("#movementType").value;
  const incoming = ["ingreso", "reingreso"].includes(type);
  const change = type === "cambio_estado";
  const fixedState = ["exhibicion_inicial", "salida_exhibicion", "venta_exhibicion"].includes(type);
  item.querySelector("[data-current-state-field]").hidden = incoming || fixedState;
  item.querySelector("[data-new-state-field]").hidden = !incoming;
  item.querySelector("[data-change-state-field]").hidden = !change;
  updateItemType(item);
}

function updateMovementForm() {
  const type = $("#movementType").value;
  $("#ticketField").hidden = !["venta_sensible", "venta_exhibicion"].includes(type);
  $("#destinationField").hidden = !["transferencia", "salida_service"].includes(type);
  $$("#movementItems .movement-item").forEach(updateItemFields);
  $("#movementDialogTitle").textContent = MOVEMENT_LABELS[type] || "Nuevo movimiento";
}

async function lookupMovementEan(item) {
  const ean = item.querySelector('[data-item="ean"]').value.replace(/\D/g, "");
  if (!ean) return showToast("Ingresá un EAN para buscar.", "error");
  try {
    const data = await api(`productos?ean=${encodeURIComponent(ean)}`);
    if (!data.producto) {
      item.querySelector('[data-item="descripcion"]').disabled = false;
      item.querySelector('[data-item="descripcion"]').focus();
      showToast("EAN nuevo: completá descripción y tipo.");
      return;
    }
    item.querySelector('[data-item="descripcion"]').value = data.producto.descripcion;
    item.querySelector('[data-item="descripcion"]').disabled = true;
    item.querySelector('[data-item="tipo"]').value = data.producto.tipo;
    item.querySelector('[data-item="tipo"]').disabled = true;
    updateItemType(item);
    showToast(`Producto encontrado. Disponible: ${formatNumber(data.producto.stockSensibleDisponible)}.`);
  } catch (error) { showToast(error.message, "error"); }
}

function openMovementForm(defaultType = "ingreso", lockType = false) {
  $("#movementForm").reset();
  $("#movementType").value = defaultType;
  $("#movementType").disabled = lockType;
  $("#movementTypeLock").hidden = !lockType;
  $("#movementItems").innerHTML = "";
  addMovementItem();
  updateMovementForm();
  openDialog($("#movementDialog"));
}

function collectMovementItem(item) {
  const get = name => item.querySelector(`[data-item="${name}"]`)?.value ?? "";
  return {
    ean: get("ean"),
    descripcion: get("descripcion"),
    tipo: get("tipo"),
    cantidad: get("cantidad") || 1,
    estado: get("estado"),
    estadoAnterior: get("estadoAnterior"),
    estadoNuevo: get("estadoNuevo"),
    imeis: get("imeis").split(/[\s,;]+/).filter(Boolean),
    serie: get("serie")
  };
}

async function saveMovement(event) {
  event.preventDefault();
  const button = event.submitter;
  const seller = $("#movementSeller").selectedOptions[0];
  const security = $("#movementSecurity").selectedOptions[0];
  const body = {
    tipo: $("#movementType").value,
    ticket: $("#movementTicket").value,
    empresaDestino: $("#movementDestination").value,
    observaciones: $("#movementNotes").value,
    vendedorId: $("#movementSeller").value,
    vendedorNombre: seller?.dataset.name || "",
    seguridadId: $("#movementSecurity").value,
    seguridadNombre: security?.dataset.name || "",
    items: $$("#movementItems .movement-item").map(collectMovementItem)
  };
  try {
    setBusy(button, true, "Registrando...");
    await api("movimientos", { method: "POST", body: JSON.stringify(body) });
    closeDialog($("#movementDialog"));
    showToast("Movimiento registrado correctamente.");
    await Promise.all([loadDashboard(), loadMovements(), state.profile.perfil === "administrador" ? loadAdminProducts() : Promise.resolve()]);
  } catch (error) {
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
}

async function changeOwnPassword(event) {
  event.preventDefault();
  const first = $("#newOwnPassword").value;
  const second = $("#repeatOwnPassword").value;
  if (first !== second) return showToast("Las contraseñas no coinciden.", "error");
  const button = event.submitter;
  try {
    setBusy(button, true);
    await api("cambiar-clave", { method: "POST", body: JSON.stringify({ password: first }) });
    state.profile.cambioClaveObligatorio = false;
    closeDialog($("#changePasswordDialog"));
    $("#changePasswordForm").reset();
    showToast("Contraseña actualizada.");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
}

async function initializeSession() {
  const profileData = await api("perfil");
  state.profile = profileData.perfil;
  applyProfile();
  $("#loginView").hidden = true;
  $("#appShell").hidden = false;
  await Promise.all([loadDashboard(), loadCatalog("vendedores"), loadCatalog("seguridad")]);
  if (state.profile.cambioClaveObligatorio) {
    showToast("Debés cambiar la contraseña inicial.");
    openDialog($("#changePasswordDialog"));
  }
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    $("#loginError").hidden = true;
    try {
      setBusy(button, true, "Ingresando...");
      const username = $("#loginUser").value;
      if (normalizeUsername(username).length < 3) throw new Error("Ingresá un usuario válido.");
      await signInWithEmailAndPassword(auth, usernameToEmail(username), $("#loginPassword").value);
    } catch (error) {
      $("#loginError").textContent = error.code?.startsWith("auth/") ? "Usuario o contraseña incorrectos." : error.message;
      $("#loginError").hidden = false;
    } finally { setBusy(button, false); }
  });

  $$('[data-toggle-password]').forEach(button => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Ver" : "Ocultar";
  }));

  $("#profileButton").addEventListener("click", () => { $("#profileMenu").hidden = !$("#profileMenu").hidden; });
  $("#logoutButton").addEventListener("click", () => signOut(auth));
  $("#changePasswordButton").addEventListener("click", () => { $("#profileMenu").hidden = true; openDialog($("#changePasswordDialog")); });
  $("#changePasswordForm").addEventListener("submit", changeOwnPassword);

  $$("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
  $$(".bottom-nav button[data-target]").forEach(button => button.addEventListener("click", () => showView(button.dataset.target)));
  $$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
  $("#refreshDashboard").addEventListener("click", loadDashboard);
  $("#refreshAudit").addEventListener("click", loadAudit);

  $("#searchForm").addEventListener("submit", event => { event.preventDefault(); searchProducts($("#searchInput").value); });
  $("#onlyAvailable").addEventListener("change", () => searchProducts($("#searchInput").value));
  $("#movementSearch").addEventListener("input", renderMovements);
  $("#movementTypeFilter").addEventListener("change", renderMovements);
  $("#recentMovements").addEventListener("click", event => { const card = event.target.closest("[data-movement-id]"); if (card) showMovementDetail(card.dataset.movementId); });
  $("#movementList").addEventListener("click", event => { const card = event.target.closest("[data-movement-id]"); if (card) showMovementDetail(card.dataset.movementId); });

  $$("[data-new-movement]").forEach(button => button.addEventListener("click", () => openMovementForm(button.dataset.newMovement, true)));
  $("#newMovementButton").addEventListener("click", () => openMovementForm("ingreso", false));
  $("#movementType").addEventListener("change", updateMovementForm);
  $("#addMovementItem").addEventListener("click", addMovementItem);
  $("#movementForm").addEventListener("submit", saveMovement);

  $("#newProductButton").addEventListener("click", () => openProductForm());
  $("#scanProductEan").addEventListener("click", scanProductEan);
  $("#lookupProductEan").addEventListener("click", lookupProductFormEan);
  $("#productForm").addEventListener("submit", saveProduct);
  $("#importProductsButton").addEventListener("click", () => { resetImportDialog(); openDialog($("#importProductsDialog")); });
  $("#productImportFile").addEventListener("change", handleProductImportFile);
  $("#importProductsForm").addEventListener("submit", importProducts);
  $("#closeBarcodeScanner").addEventListener("click", () => closeDialog($("#barcodeScannerDialog")));
  $("#cancelBarcodeScanner").addEventListener("click", () => closeDialog($("#barcodeScannerDialog")));
  $("#barcodeScannerDialog").addEventListener("close", stopBarcodeScanner);
  $$("[data-quick-catalog]").forEach(button => button.addEventListener("click", () => openQuickCatalog(button.dataset.quickCatalog)));
  $("#quickCatalogForm").addEventListener("submit", saveQuickCatalog);
  $("#adminProductSearch").addEventListener("input", renderAdminProducts);
  $("#adminProductList").addEventListener("click", event => {
    const button = event.target.closest("[data-edit-product]");
    if (button) openProductForm(state.products.find(item => item.ean === button.dataset.editProduct));
  });

  $("#newUserButton").addEventListener("click", () => openUserForm());
  $("#userForm").addEventListener("submit", saveUser);
  $("#userList").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-user]");
    const reset = event.target.closest("[data-reset-user]");
    if (edit) openUserForm(state.users.find(item => item.uid === edit.dataset.editUser));
    if (reset) openResetPassword(reset.dataset.resetUser);
  });
  $("#resetPasswordForm").addEventListener("submit", resetUserPassword);

  $$("[data-catalog]").forEach(button => button.addEventListener("click", () => {
    state.currentCatalog = button.dataset.catalog;
    $$("[data-catalog]").forEach(item => item.classList.toggle("active", item === button));
    loadCatalog(state.currentCatalog, true);
  }));
  $("#catalogForm").addEventListener("submit", addCatalogItem);
  $("#catalogList").addEventListener("click", event => { const button = event.target.closest("[data-toggle-catalog]"); if (button) toggleCatalogItem(button.dataset.toggleCatalog); });
}

fillMovementTypeOptions();
bindEvents();

onAuthStateChanged(auth, async user => {
  if (!user) {
    state.profile = null;
    $("#appShell").hidden = true;
    $("#loginView").hidden = false;
    $("#loginForm").reset();
    return;
  }
  try {
    await initializeSession();
  } catch (error) {
    showToast(error.message, "error");
    await signOut(auth);
  }
});
