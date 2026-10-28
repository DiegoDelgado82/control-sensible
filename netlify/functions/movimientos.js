import { FieldValue } from "firebase-admin/firestore";
import { db } from "./_shared/firebase.js";
import { requireUser, canOperate } from "./_shared/auth.js";
import {
  cleanEan,
  cleanText,
  errorResponse,
  parseBody,
  preflight,
  response
} from "./_shared/http.js";

const MOVEMENT_TYPES = [
  "ingreso",
  "reingreso",
  "venta_sensible",
  "exhibicion_inicial",
  "salida_exhibicion",
  "venta_exhibicion",
  "transferencia",
  "salida_service",
  "cambio_estado"
];
const PRODUCT_TYPES = ["celular", "tablet", "consola", "otro"];
const STATES = ["ok", "para_service", "roto", "con_faltantes"];
const OUTSIDE_LOCATIONS = ["fuera", "vendido", "transferido", "service"];

function intQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw Object.assign(new Error("Cada cantidad debe estar entre 1 y 500."), { statusCode: 400 });
  }
  return quantity;
}

function state(value, fallback = "ok") {
  return STATES.includes(value) ? value : fallback;
}

function productType(value) {
  return PRODUCT_TYPES.includes(value) ? value : "otro";
}

function normalizeImeis(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  const imeis = [...new Set(raw.map(item => String(item).replace(/\D/g, "")).filter(Boolean))];
  if (!imeis.length || imeis.some(imei => imei.length !== 15)) {
    throw Object.assign(new Error("Cada celular debe tener un IMEI válido de 15 dígitos."), { statusCode: 400 });
  }
  return imeis;
}

function transitionFor(type, item) {
  switch (type) {
    case "ingreso":
    case "reingreso":
      return { fromLocation: "fuera", fromState: null, toLocation: "sensible", toState: state(item.estado) };
    case "venta_sensible":
      return { fromLocation: "sensible", fromState: state(item.estadoAnterior), toLocation: "vendido", toState: state(item.estadoAnterior) };
    case "exhibicion_inicial":
      return { fromLocation: "fuera", fromState: null, toLocation: "exhibicion", toState: "ok" };
    case "salida_exhibicion":
      return { fromLocation: "sensible", fromState: "ok", toLocation: "exhibicion", toState: "ok" };
    case "venta_exhibicion":
      return { fromLocation: "exhibicion", fromState: "ok", toLocation: "vendido", toState: "ok" };
    case "transferencia":
      return { fromLocation: "sensible", fromState: state(item.estadoAnterior), toLocation: "transferido", toState: state(item.estadoAnterior) };
    case "salida_service":
      return { fromLocation: "sensible", fromState: state(item.estadoAnterior, "para_service"), toLocation: "service", toState: state(item.estadoAnterior, "para_service") };
    case "cambio_estado": {
      const oldState = state(item.estadoAnterior);
      const newState = state(item.estadoNuevo);
      if (oldState === newState) throw Object.assign(new Error("El estado nuevo debe ser diferente del estado actual."), { statusCode: 400 });
      return { fromLocation: "sensible", fromState: oldState, toLocation: "sensible", toState: newState };
    }
    default:
      throw Object.assign(new Error("Tipo de movimiento inválido."), { statusCode: 400 });
  }
}

function normalizeItems(type, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw Object.assign(new Error("El movimiento debe contener al menos un producto."), { statusCode: 400 });
  }
  if (rawItems.length > 100) throw Object.assign(new Error("Un lote admite hasta 100 productos."), { statusCode: 400 });

  const seenImeis = new Set();
  return rawItems.map((raw, index) => {
    const ean = cleanEan(raw.ean);
    const tipo = productType(raw.tipo);
    let cantidad = intQuantity(raw.cantidad || 1);
    let imeis = [];
    if (tipo === "celular") {
      imeis = normalizeImeis(raw.imeis ?? raw.imei);
      cantidad = imeis.length;
      for (const imei of imeis) {
        if (seenImeis.has(imei)) throw Object.assign(new Error(`El IMEI ${imei} está repetido en el lote.`), { statusCode: 400 });
        seenImeis.add(imei);
      }
    }

    const transition = transitionFor(type, raw);
    const serie = cleanText(raw.serie, 80);
    if (tipo === "otro" && transition.toLocation === "sensible" && transition.toState !== "ok" && !serie) {
      throw Object.assign(new Error(`El producto ${ean} requiere número de serie por su estado.`), { statusCode: 400 });
    }
    if (serie && cantidad !== 1) {
      throw Object.assign(new Error(`El producto ${ean} con número de serie debe cargarse como una unidad.`), { statusCode: 400 });
    }

    return {
      linea: index + 1,
      ean,
      descripcion: cleanText(raw.descripcion, 160),
      tipo,
      cantidad,
      imeis,
      serie,
      ...transition
    };
  });
}

function emptyProduct(item) {
  if (!item.descripcion) {
    throw Object.assign(new Error(`El EAN ${item.ean} no existe. Ingresá su descripción.`), { statusCode: 400 });
  }
  return {
    ean: item.ean,
    descripcion: item.descripcion,
    descripcionBusqueda: item.descripcion.toLowerCase(),
    tipo: item.tipo,
    marca: "",
    categoria: "",
    activo: true,
    stockSensibleReal: 0,
    stockSensibleDisponible: 0,
    stockExhibicion: 0,
    stockTotalControlado: 0,
    estadoStock: { ok: 0, para_service: 0, roto: 0, con_faltantes: 0 }
  };
}

function applyTransition(product, item, reverse = false) {
  const quantity = item.cantidad;
  const fromLocation = reverse ? item.toLocation : item.fromLocation;
  const fromState = reverse ? item.toState : item.fromState;
  const toLocation = reverse ? item.fromLocation : item.toLocation;
  const toState = reverse ? item.fromState : item.toState;

  product.estadoStock = {
    ok: Number(product.estadoStock?.ok || 0),
    para_service: Number(product.estadoStock?.para_service || 0),
    roto: Number(product.estadoStock?.roto || 0),
    con_faltantes: Number(product.estadoStock?.con_faltantes || 0)
  };
  product.stockSensibleReal = Number(product.stockSensibleReal || 0);
  product.stockSensibleDisponible = Number(product.stockSensibleDisponible || 0);
  product.stockExhibicion = Number(product.stockExhibicion || 0);

  if (fromLocation === "sensible") {
    if (product.estadoStock[fromState] < quantity) {
      throw Object.assign(new Error(`Stock insuficiente del EAN ${item.ean} en estado ${fromState}.`), { statusCode: 409 });
    }
    product.estadoStock[fromState] -= quantity;
    product.stockSensibleReal -= quantity;
    if (fromState === "ok") product.stockSensibleDisponible -= quantity;
  } else if (fromLocation === "exhibicion") {
    if (product.stockExhibicion < quantity) {
      throw Object.assign(new Error(`Stock de exhibición insuficiente para el EAN ${item.ean}.`), { statusCode: 409 });
    }
    product.stockExhibicion -= quantity;
  } else if (!OUTSIDE_LOCATIONS.includes(fromLocation)) {
    throw Object.assign(new Error("Ubicación de origen inválida."), { statusCode: 400 });
  }

  if (toLocation === "sensible") {
    product.estadoStock[toState] += quantity;
    product.stockSensibleReal += quantity;
    if (toState === "ok") product.stockSensibleDisponible += quantity;
  } else if (toLocation === "exhibicion") {
    product.stockExhibicion += quantity;
  } else if (!OUTSIDE_LOCATIONS.includes(toLocation)) {
    throw Object.assign(new Error("Ubicación de destino inválida."), { statusCode: 400 });
  }

  product.stockTotalControlado = product.stockSensibleReal + product.stockExhibicion;
  if ([product.stockSensibleReal, product.stockSensibleDisponible, product.stockExhibicion, product.stockTotalControlado].some(value => value < 0)) {
    throw Object.assign(new Error(`El movimiento produciría stock negativo para ${item.ean}.`), { statusCode: 409 });
  }
  return product;
}

function movementCommon(body, profile, items) {
  return {
    tipo: body.tipo,
    estado: "registrado",
    ticket: cleanText(body.ticket, 80),
    empresaDestino: cleanText(body.empresaDestino, 140),
    observaciones: cleanText(body.observaciones, 800),
    vendedorId: cleanText(body.vendedorId, 128),
    vendedorNombre: cleanText(body.vendedorNombre, 120),
    seguridadId: cleanText(body.seguridadId, 128),
    seguridadNombre: cleanText(body.seguridadNombre, 120),
    usuarioUid: profile.uid,
    usuarioNombre: profile.nombre,
    usuarioPerfil: profile.perfil,
    cantidadUnidades: items.reduce((sum, item) => sum + item.cantidad, 0),
    resumen: `${items.reduce((sum, item) => sum + item.cantidad, 0)} unidad(es) - ${items.length} producto(s)`,
    items,
    fecha: FieldValue.serverTimestamp()
  };
}

async function createMovement(body, profile) {
  if (!MOVEMENT_TYPES.includes(body.tipo)) throw Object.assign(new Error("Tipo de movimiento inválido."), { statusCode: 400 });
  if (["venta_sensible", "venta_exhibicion"].includes(body.tipo) && !cleanText(body.ticket, 80)) {
    throw Object.assign(new Error("El número de ticket es obligatorio para una venta."), { statusCode: 400 });
  }
  if (["transferencia", "salida_service"].includes(body.tipo) && !cleanText(body.empresaDestino, 140)) {
    throw Object.assign(new Error("La empresa o destino es obligatorio."), { statusCode: 400 });
  }

  const items = normalizeItems(body.tipo, body.items);
  const movementRef = db.collection("movimientos").doc();
  const auditRef = db.collection("auditoria").doc();
  const productRefs = [...new Map(items.map(item => [item.ean, db.collection("productos").doc(item.ean)])).values()];
  const unitRefs = items.flatMap(item => item.imeis.map(imei => db.collection("unidades").doc(imei)));

  await db.runTransaction(async tx => {
    const productSnaps = await Promise.all(productRefs.map(ref => tx.get(ref)));
    const unitSnaps = await Promise.all(unitRefs.map(ref => tx.get(ref)));
    const productMap = new Map(productSnaps.map(snap => [snap.id, { ref: snap.ref, exists: snap.exists, data: snap.exists ? snap.data() : null }]));
    const unitMap = new Map(unitSnaps.map(snap => [snap.id, { ref: snap.ref, exists: snap.exists, data: snap.exists ? snap.data() : null }]));

    for (const item of items) {
      const stored = productMap.get(item.ean);
      if (!stored.exists && !["ingreso", "reingreso", "exhibicion_inicial"].includes(body.tipo)) {
        throw Object.assign(new Error(`El EAN ${item.ean} no está registrado.`), { statusCode: 404 });
      }
      const wasNew = !stored.exists;
      const product = stored.data || emptyProduct(item);
      if (!stored.data) {
        stored.data = product;
        stored.exists = true;
      }
      item.descripcion = product.descripcion;
      item.tipo = product.tipo;

      if (product.tipo === "celular" && !item.imeis.length) {
        throw Object.assign(new Error(`El celular ${item.ean} requiere IMEI.`), { statusCode: 400 });
      }
      if (product.tipo !== "celular" && item.imeis.length) {
        throw Object.assign(new Error(`El EAN ${item.ean} no corresponde a un celular.`), { statusCode: 400 });
      }

      applyTransition(product, item, false);
      product.actualizadoEn = FieldValue.serverTimestamp();
      product.actualizadoPor = profile.uid;
      product.ultimoMovimientoId = movementRef.id;
      if (wasNew) {
        product.creadoEn = FieldValue.serverTimestamp();
        product.creadoPor = profile.uid;
      }
      tx.set(stored.ref, product, { merge: true });

      for (const imei of item.imeis) {
        const unit = unitMap.get(imei);
        if (item.fromLocation === "fuera") {
          if (unit.exists && ["sensible", "exhibicion"].includes(unit.data.ubicacion)) {
            throw Object.assign(new Error(`El IMEI ${imei} ya se encuentra activo en ${unit.data.ubicacion}.`), { statusCode: 409 });
          }
        } else {
          if (!unit.exists) throw Object.assign(new Error(`El IMEI ${imei} no está registrado.`), { statusCode: 404 });
          if (unit.data.ean !== item.ean || unit.data.ubicacion !== item.fromLocation) {
            throw Object.assign(new Error(`El IMEI ${imei} no se encuentra en la ubicación esperada.`), { statusCode: 409 });
          }
          if (item.fromLocation === "sensible" && unit.data.estado !== item.fromState) {
            throw Object.assign(new Error(`El IMEI ${imei} no se encuentra en estado ${item.fromState}.`), { statusCode: 409 });
          }
        }
        tx.set(unit.ref, {
          imei,
          ean: item.ean,
          descripcion: item.descripcion,
          ubicacion: item.toLocation,
          estado: item.toState,
          ultimoMovimientoId: movementRef.id,
          actualizadoEn: FieldValue.serverTimestamp(),
          actualizadoPor: profile.uid,
          creadoEn: unit.exists ? unit.data.creadoEn : FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    tx.set(movementRef, movementCommon(body, profile, items));
    tx.set(auditRef, {
      accion: "crear_movimiento",
      movimientoId: movementRef.id,
      tipo: body.tipo,
      usuarioUid: profile.uid,
      usuarioNombre: profile.nombre,
      fecha: FieldValue.serverTimestamp()
    });
  });

  return movementRef.id;
}

async function cancelMovement(body, profile) {
  if (profile.perfil !== "administrador") throw Object.assign(new Error("Solo el Administrador puede anular movimientos."), { statusCode: 403 });
  const movementId = cleanText(body.movimientoId, 128);
  const reason = cleanText(body.motivo, 500);
  if (!movementId || !reason) throw Object.assign(new Error("El movimiento y el motivo son obligatorios."), { statusCode: 400 });

  const movementRef = db.collection("movimientos").doc(movementId);
  const cancellationRef = db.collection("movimientos").doc();
  const auditRef = db.collection("auditoria").doc();

  await db.runTransaction(async tx => {
    const movementSnap = await tx.get(movementRef);
    if (!movementSnap.exists) throw Object.assign(new Error("El movimiento no existe."), { statusCode: 404 });
    const movement = movementSnap.data();
    if (movement.estado !== "registrado") throw Object.assign(new Error("El movimiento ya fue anulado."), { statusCode: 409 });

    const items = movement.items || [];
    const productRefs = [...new Map(items.map(item => [item.ean, db.collection("productos").doc(item.ean)])).values()];
    const unitRefs = items.flatMap(item => (item.imeis || []).map(imei => db.collection("unidades").doc(imei)));
    const productSnaps = await Promise.all(productRefs.map(ref => tx.get(ref)));
    const unitSnaps = await Promise.all(unitRefs.map(ref => tx.get(ref)));
    const productMap = new Map(productSnaps.map(snap => [snap.id, {
      ref: snap.ref,
      exists: snap.exists,
      data: snap.exists ? snap.data() : null
    }]));
    const unitMap = new Map(unitSnaps.map(snap => [snap.id, snap]));

    for (const item of items) {
      const stored = productMap.get(item.ean);
      if (!stored?.exists) throw Object.assign(new Error(`No se encontró el producto ${item.ean}.`), { statusCode: 409 });
      const product = stored.data;
      if (product.ultimoMovimientoId !== movementId) {
        throw Object.assign(new Error(`El EAN ${item.ean} tiene movimientos posteriores y no puede anularse automáticamente.`), { statusCode: 409 });
      }
      applyTransition(product, item, true);
      tx.update(stored.ref, {
        stockSensibleReal: product.stockSensibleReal,
        stockSensibleDisponible: product.stockSensibleDisponible,
        stockExhibicion: product.stockExhibicion,
        stockTotalControlado: product.stockTotalControlado,
        estadoStock: product.estadoStock,
        ultimoMovimientoId: cancellationRef.id,
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPor: profile.uid
      });

      for (const imei of item.imeis || []) {
        const unitSnap = unitMap.get(imei);
        if (!unitSnap?.exists || unitSnap.data().ultimoMovimientoId !== movementId) {
          throw Object.assign(new Error(`El IMEI ${imei} tiene movimientos posteriores.`), { statusCode: 409 });
        }
        tx.update(unitSnap.ref, {
          ubicacion: item.fromLocation,
          estado: item.fromState,
          ultimoMovimientoId: cancellationRef.id,
          actualizadoEn: FieldValue.serverTimestamp(),
          actualizadoPor: profile.uid
        });
      }
    }

    tx.update(movementRef, {
      estado: "anulado",
      anuladoEn: FieldValue.serverTimestamp(),
      anuladoPor: profile.uid,
      motivoAnulacion: reason,
      contramovimientoId: cancellationRef.id
    });
    tx.set(cancellationRef, {
      tipo: "anulacion",
      estado: "registrado",
      movimientoOriginalId: movementId,
      motivoAnulacion: reason,
      items,
      cantidadUnidades: movement.cantidadUnidades,
      resumen: `Anulación de ${movementId}`,
      usuarioUid: profile.uid,
      usuarioNombre: profile.nombre,
      usuarioPerfil: profile.perfil,
      fecha: FieldValue.serverTimestamp()
    });
    tx.set(auditRef, {
      accion: "anular_movimiento",
      movimientoId,
      contramovimientoId: cancellationRef.id,
      motivo: reason,
      usuarioUid: profile.uid,
      fecha: FieldValue.serverTimestamp()
    });
  });

  return cancellationRef.id;
}

function serializeMovement(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    fecha: data.fecha?.toDate?.()?.toISOString() || null,
    anuladoEn: data.anuladoEn?.toDate?.()?.toISOString() || null
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    const profile = await requireUser(event);

    if (event.httpMethod === "GET") {
      const limit = Math.min(Number(event.queryStringParameters?.limit) || 100, 200);
      const snap = await db.collection("movimientos").orderBy("fecha", "desc").limit(limit).get();
      return response(200, { ok: true, movimientos: snap.docs.map(serializeMovement) }, origin);
    }

    if (event.httpMethod !== "POST") return response(405, { ok: false, error: "Método no permitido." }, origin);
    if (!canOperate(profile)) throw Object.assign(new Error("La Vista Vendedor es únicamente de consulta."), { statusCode: 403 });
    const body = parseBody(event);

    if (body.accion === "anular") {
      const id = await cancelMovement(body, profile);
      return response(200, { ok: true, contramovimientoId: id, mensaje: "Movimiento anulado." }, origin);
    }

    const id = await createMovement(body, profile);
    return response(201, { ok: true, movimientoId: id, mensaje: "Movimiento registrado." }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
