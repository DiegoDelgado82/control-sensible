import { adminAuth, db } from "./firebase.js";

export async function requireUser(event, allowedProfiles = []) {
  const authorization = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("La sesión no es válida."), { statusCode: 401 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(authorization.slice(7), true);
  } catch {
    throw Object.assign(new Error("La sesión venció. Volvé a ingresar."), { statusCode: 401 });
  }

  const profileSnap = await db.collection("usuarios").doc(decoded.uid).get();
  if (!profileSnap.exists) {
    throw Object.assign(new Error("El usuario no tiene un perfil habilitado."), { statusCode: 403 });
  }

  const profile = { uid: decoded.uid, email: decoded.email, ...profileSnap.data() };
  if (!profile.activo) {
    throw Object.assign(new Error("El usuario se encuentra inactivo."), { statusCode: 403 });
  }
  if (allowedProfiles.length && !allowedProfiles.includes(profile.perfil)) {
    throw Object.assign(new Error("No tenés permisos para realizar esta acción."), { statusCode: 403 });
  }
  return profile;
}

export function canOperate(profile) {
  return ["administrador", "jefe"].includes(profile.perfil);
}
