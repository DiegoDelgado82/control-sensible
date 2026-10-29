import { FieldValue } from "firebase-admin/firestore";
import { db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import { cleanText, errorResponse, parseBody, preflight, response } from "./_shared/http.js";

const ALLOWED = ["vendedores", "seguridad"];

function collectionName(value) {
  if (!ALLOWED.includes(value)) throw Object.assign(new Error("Catálogo inválido."), { statusCode: 400 });
  return value;
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    const profile = await requireUser(event);
    const catalog = collectionName(event.queryStringParameters?.tipo || parseBody(event).tipo);

    if (event.httpMethod === "GET") {
      const snap = await db.collection(catalog).orderBy("nombre").get();
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return response(200, { ok: true, items }, origin);
    }

    const body = parseBody(event);

    if (event.httpMethod === "POST") {
      if (!["administrador", "jefe"].includes(profile.perfil)) {
        throw Object.assign(new Error("Solo un Jefe o Administrador puede agregar personas."), { statusCode: 403 });
      }
      const nombre = cleanText(body.nombre, 120);
      if (!nombre) throw Object.assign(new Error("El nombre es obligatorio."), { statusCode: 400 });
      const existing = await db.collection(catalog).get();
      const normalizedName = nombre.toLocaleLowerCase("es");
      if (existing.docs.some(doc => cleanText(doc.data().nombre, 120).toLocaleLowerCase("es") === normalizedName)) {
        throw Object.assign(new Error("La persona ya se encuentra registrada en el listado."), { statusCode: 409 });
      }
      const ref = await db.collection(catalog).add({
        nombre,
        activo: true,
        creadoEn: FieldValue.serverTimestamp(),
        creadoPor: profile.uid
      });
      return response(201, { ok: true, id: ref.id }, origin);
    }

    if (event.httpMethod === "PATCH") {
      if (profile.perfil !== "administrador") {
        throw Object.assign(new Error("Solo el Administrador puede modificar catálogos."), { statusCode: 403 });
      }
      const id = cleanText(body.id, 128);
      const nombre = cleanText(body.nombre, 120);
      if (!id || !nombre) throw Object.assign(new Error("Faltan datos del registro."), { statusCode: 400 });
      await db.collection(catalog).doc(id).update({ nombre, activo: body.activo !== false, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: profile.uid });
      return response(200, { ok: true, mensaje: "Registro actualizado." }, origin);
    }

    return response(405, { ok: false, error: "Método no permitido." }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
