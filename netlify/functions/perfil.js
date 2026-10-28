import { requireUser } from "./_shared/auth.js";
import { errorResponse, preflight, response } from "./_shared/http.js";

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    if (event.httpMethod !== "GET") return response(405, { ok: false, error: "Método no permitido." }, origin);
    const profile = await requireUser(event);
    return response(200, {
      ok: true,
      perfil: {
        uid: profile.uid,
        usuario: profile.usuario,
        nombre: profile.nombre,
        perfil: profile.perfil,
        activo: profile.activo,
        cambioClaveObligatorio: Boolean(profile.cambioClaveObligatorio)
      }
    }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
