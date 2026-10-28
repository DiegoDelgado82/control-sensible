import { FieldValue } from "firebase-admin/firestore";
import { db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import {
  cleanEan,
  cleanText,
  errorResponse,
  parseBody,
  preflight,
  response
} from "./_shared/http.js";

const TYPES = ["celular", "tablet", "consola", "otro"];

function serialize(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    creadoEn: data.creadoEn?.toDate?.()?.toISOString() || null,
    actualizadoEn: data.actualizadoEn?.toDate?.()?.toISOString() || null
  };
}

function productPayload(body) {
  const ean = cleanEan(body.ean);
  const descripcion = cleanText(body.descripcion, 160);
  const tipo = TYPES.includes(body.tipo) ? body.tipo : "otro";
  if (!descripcion) throw Object.assign(new Error("La descripción es obligatoria."), { statusCode: 400 });
  return {
    ean,
    descripcion,
    descripcionBusqueda: descripcion.toLowerCase(),
    tipo,
    marca: cleanText(body.marca, 80),
    categoria: cleanText(body.categoria, 80),
    activo: body.activo !== false
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    const profile = await requireUser(event);

    if (event.httpMethod === "GET") {
      const ean = event.queryStringParameters?.ean?.replace(/\D/g, "");
      if (ean) {
        const doc = await db.collection("productos").doc(ean).get();
        return response(200, { ok: true, producto: doc.exists ? serialize(doc) : null }, origin);
      }

      const term = cleanText(event.queryStringParameters?.q, 100).toLowerCase();
      const limit = Math.min(Number(event.queryStringParameters?.limit) || 100, 200);
      const snap = await db.collection("productos").orderBy("descripcionBusqueda").limit(limit).get();
      let products = snap.docs.map(serialize);
      if (term) {
        products = products.filter(item =>
          item.ean.includes(term.replace(/\D/g, "")) ||
          item.descripcionBusqueda.includes(term) ||
          String(item.marca || "").toLowerCase().includes(term)
        );
      }
      return response(200, { ok: true, productos: products }, origin);
    }

    if (profile.perfil !== "administrador") {
      throw Object.assign(new Error("Solo el Administrador puede modificar productos."), { statusCode: 403 });
    }

    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      const payload = productPayload(body);
      const ref = db.collection("productos").doc(payload.ean);
      const current = await ref.get();
      if (current.exists) throw Object.assign(new Error("El EAN ya se encuentra registrado."), { statusCode: 409 });
      await ref.set({
        ...payload,
        stockSensibleReal: 0,
        stockSensibleDisponible: 0,
        stockExhibicion: 0,
        stockTotalControlado: 0,
        estadoStock: { ok: 0, para_service: 0, roto: 0, con_faltantes: 0 },
        creadoEn: FieldValue.serverTimestamp(),
        creadoPor: profile.uid,
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPor: profile.uid
      });
      await db.collection("auditoria").add({ accion: "crear_producto", ean: payload.ean, usuarioUid: profile.uid, fecha: FieldValue.serverTimestamp() });
      return response(201, { ok: true, producto: { ...payload, stockSensibleReal: 0, stockSensibleDisponible: 0, stockExhibicion: 0, stockTotalControlado: 0 } }, origin);
    }

    if (event.httpMethod === "PATCH") {
      const body = parseBody(event);
      const ean = cleanEan(body.ean);
      const ref = db.collection("productos").doc(ean);
      const current = await ref.get();
      if (!current.exists) throw Object.assign(new Error("El producto no existe."), { statusCode: 404 });
      const payload = productPayload({ ...current.data(), ...body, ean });
      await ref.update({
        descripcion: payload.descripcion,
        descripcionBusqueda: payload.descripcionBusqueda,
        tipo: payload.tipo,
        marca: payload.marca,
        categoria: payload.categoria,
        activo: payload.activo,
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPor: profile.uid
      });
      await db.collection("auditoria").add({ accion: "modificar_producto", ean, usuarioUid: profile.uid, fecha: FieldValue.serverTimestamp() });
      return response(200, { ok: true, mensaje: "Producto actualizado." }, origin);
    }

    return response(405, { ok: false, error: "Método no permitido." }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
