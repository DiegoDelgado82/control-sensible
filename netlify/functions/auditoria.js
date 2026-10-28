import { db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import { errorResponse, preflight, response } from "./_shared/http.js";

function serialize(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    accion: data.accion || "accion",
    usuarioUid: data.usuarioUid || "",
    usuarioNombre: data.usuarioNombre || "",
    objetivoUid: data.objetivoUid || "",
    movimientoId: data.movimientoId || "",
    tipo: data.tipo || "",
    ean: data.ean || "",
    fecha: data.fecha?.toDate?.()?.toISOString() || null
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    if (event.httpMethod !== "GET") return response(405, { ok: false, error: "Método no permitido." }, origin);
    await requireUser(event, ["administrador"]);

    const limit = Math.min(Number(event.queryStringParameters?.limit) || 200, 500);
    const snap = await db.collection("auditoria").orderBy("fecha", "desc").limit(limit).get();
    const registros = snap.docs.map(serialize);

    const userIds = [...new Set(registros.flatMap(item => [item.usuarioUid, item.objetivoUid]).filter(Boolean))];
    const userSnaps = await Promise.all(userIds.map(uid => db.collection("usuarios").doc(uid).get()));
    const names = new Map(userSnaps.filter(item => item.exists).map(item => [item.id, item.data().nombre || item.data().usuario || item.id]));

    return response(200, {
      ok: true,
      registros: registros.map(item => ({
        ...item,
        usuarioNombre: item.usuarioNombre || names.get(item.usuarioUid) || "Usuario",
        objetivoNombre: names.get(item.objetivoUid) || ""
      }))
    }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
