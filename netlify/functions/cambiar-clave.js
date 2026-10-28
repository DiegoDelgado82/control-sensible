import { adminAuth, db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import { errorResponse, parseBody, preflight, response } from "./_shared/http.js";

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw Object.assign(new Error("La nueva contraseña debe tener al menos 8 caracteres."), { statusCode: 400 });
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    throw Object.assign(new Error("La contraseña debe incluir mayúscula, minúscula y número."), { statusCode: 400 });
  }
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    if (event.httpMethod !== "POST") return response(405, { ok: false, error: "Método no permitido." }, origin);
    const profile = await requireUser(event);
    const { password } = parseBody(event);
    validatePassword(password);

    await adminAuth.updateUser(profile.uid, { password });
    await db.collection("usuarios").doc(profile.uid).update({
      cambioClaveObligatorio: false,
      actualizadoEn: new Date(),
      actualizadoPor: profile.uid
    });
    await db.collection("auditoria").add({
      accion: "cambio_clave_propia",
      usuarioUid: profile.uid,
      usuarioNombre: profile.nombre,
      fecha: new Date()
    });

    return response(200, { ok: true, mensaje: "Contraseña actualizada." }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
