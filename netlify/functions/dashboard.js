import { db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import { errorResponse, preflight, response } from "./_shared/http.js";

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    if (event.httpMethod !== "GET") return response(405, { ok: false, error: "Método no permitido." }, origin);
    await requireUser(event);

    const [productsSnap, movementSnap] = await Promise.all([
      db.collection("productos").where("activo", "==", true).get(),
      db.collection("movimientos").orderBy("fecha", "desc").limit(8).get()
    ]);

    const totals = productsSnap.docs.reduce((acc, doc) => {
      const item = doc.data();
      acc.disponible += Number(item.stockSensibleDisponible || 0);
      acc.real += Number(item.stockSensibleReal || 0);
      acc.exhibicion += Number(item.stockExhibicion || 0);
      acc.total += Number(item.stockTotalControlado || 0);
      return acc;
    }, { disponible: 0, real: 0, exhibicion: 0, total: 0 });

    const recientes = movementSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        tipo: data.tipo,
        estado: data.estado,
        usuarioNombre: data.usuarioNombre,
        resumen: data.resumen,
        cantidadUnidades: data.cantidadUnidades,
        ticket: data.ticket,
        vendedorNombre: data.vendedorNombre,
        seguridadNombre: data.seguridadNombre,
        observaciones: data.observaciones,
        items: data.items || [],
        fecha: data.fecha?.toDate?.()?.toISOString() || null
      };
    });

    return response(200, { ok: true, totales: totals, recientes }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
