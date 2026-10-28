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

const TYPES = new Set(["celular", "tablet", "consola", "otro"]);
const MAX_PRODUCTS = 2000;
const CHUNK_SIZE = 400;

function normalizeProduct(raw, rowNumber) {
  const ean = cleanEan(raw?.ean);
  const descripcion = cleanText(raw?.descripcion, 160);
  const tipo = cleanText(raw?.tipo, 30).toLowerCase();

  if (!descripcion) {
    throw Object.assign(new Error(`Fila ${rowNumber}: la descripción es obligatoria.`), { statusCode: 400 });
  }
  if (!TYPES.has(tipo)) {
    throw Object.assign(new Error(`Fila ${rowNumber}: el tipo debe ser celular, tablet, consola u otro.`), { statusCode: 400 });
  }

  return {
    ean,
    descripcion,
    descripcionBusqueda: descripcion.toLowerCase(),
    tipo,
    activo: true
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    const profile = await requireUser(event);
    if (profile.perfil !== "administrador") {
      throw Object.assign(new Error("Solo el Administrador puede importar productos."), { statusCode: 403 });
    }
    if (event.httpMethod !== "POST") {
      return response(405, { ok: false, error: "Método no permitido." }, origin);
    }

    const body = parseBody(event);
    if (!Array.isArray(body.productos) || !body.productos.length) {
      throw Object.assign(new Error("El archivo no contiene productos para importar."), { statusCode: 400 });
    }
    if (body.productos.length > MAX_PRODUCTS) {
      throw Object.assign(new Error(`La importación admite hasta ${MAX_PRODUCTS} productos por archivo.`), { statusCode: 400 });
    }

    const products = body.productos.map((item, index) => normalizeProduct(item, Number(item?.fila) || index + 2));
    const seen = new Set();
    for (const product of products) {
      if (seen.has(product.ean)) {
        throw Object.assign(new Error(`El EAN ${product.ean} está repetido en el archivo.`), { statusCode: 400 });
      }
      seen.add(product.ean);
    }

    let creados = 0;
    let actualizados = 0;

    for (let offset = 0; offset < products.length; offset += CHUNK_SIZE) {
      const chunk = products.slice(offset, offset + CHUNK_SIZE);
      const refs = chunk.map(product => db.collection("productos").doc(product.ean));
      const snapshots = await db.getAll(...refs);
      const batch = db.batch();

      snapshots.forEach((snapshot, index) => {
        const product = chunk[index];
        const common = {
          ...product,
          actualizadoEn: FieldValue.serverTimestamp(),
          actualizadoPor: profile.uid
        };

        if (snapshot.exists) {
          actualizados += 1;
          batch.set(refs[index], common, { merge: true });
          return;
        }

        creados += 1;
        batch.set(refs[index], {
          ...common,
          stockSensibleReal: 0,
          stockSensibleDisponible: 0,
          stockExhibicion: 0,
          stockTotalControlado: 0,
          estadoStock: { ok: 0, para_service: 0, roto: 0, con_faltantes: 0 },
          creadoEn: FieldValue.serverTimestamp(),
          creadoPor: profile.uid
        });
      });

      await batch.commit();
    }

    await db.collection("auditoria").add({
      accion: "importar_productos",
      cantidad: products.length,
      creados,
      actualizados,
      archivo: cleanText(body.archivo, 180),
      usuarioUid: profile.uid,
      usuarioNombre: profile.nombre,
      fecha: FieldValue.serverTimestamp()
    });

    return response(200, {
      ok: true,
      total: products.length,
      creados,
      actualizados,
      mensaje: `Importación completa: ${creados} nuevos y ${actualizados} actualizados.`
    }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
