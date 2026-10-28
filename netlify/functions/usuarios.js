import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "./_shared/firebase.js";
import { requireUser } from "./_shared/auth.js";
import {
  cleanText,
  errorResponse,
  normalizeUsername,
  parseBody,
  preflight,
  response,
  usernameToEmail
} from "./_shared/http.js";

const PROFILES = ["administrador", "jefe", "vendedor"];

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw Object.assign(new Error("La contraseña inicial debe tener al menos 8 caracteres."), { statusCode: 400 });
  }
}

function serialize(doc) {
  const data = doc.data();
  return {
    uid: doc.id,
    usuario: data.usuario,
    nombre: data.nombre,
    perfil: data.perfil,
    activo: data.activo,
    cambioClaveObligatorio: Boolean(data.cambioClaveObligatorio)
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || "";
  const early = preflight(event);
  if (early) return early;

  try {
    const admin = await requireUser(event, ["administrador"]);

    if (event.httpMethod === "GET") {
      const snap = await db.collection("usuarios").orderBy("nombre").get();
      return response(200, { ok: true, usuarios: snap.docs.map(serialize) }, origin);
    }

    const body = parseBody(event);
    if (event.httpMethod === "POST") {
      const usuario = normalizeUsername(body.usuario);
      const nombre = cleanText(body.nombre, 120);
      const perfil = PROFILES.includes(body.perfil) ? body.perfil : "vendedor";
      validatePassword(body.password);
      if (!nombre) throw Object.assign(new Error("El nombre es obligatorio."), { statusCode: 400 });

      const userRecord = await adminAuth.createUser({
        email: usernameToEmail(usuario),
        password: body.password,
        displayName: nombre,
        disabled: false
      });
      try {
        await db.collection("usuarios").doc(userRecord.uid).set({
          usuario,
          nombre,
          perfil,
          activo: true,
          cambioClaveObligatorio: true,
          creadoEn: FieldValue.serverTimestamp(),
          creadoPor: admin.uid,
          actualizadoEn: FieldValue.serverTimestamp(),
          actualizadoPor: admin.uid
        });
      } catch (error) {
        await adminAuth.deleteUser(userRecord.uid);
        throw error;
      }
      await db.collection("auditoria").add({ accion: "crear_usuario", objetivoUid: userRecord.uid, usuarioUid: admin.uid, fecha: FieldValue.serverTimestamp() });
      return response(201, { ok: true, uid: userRecord.uid, usuario }, origin);
    }

    if (event.httpMethod === "PATCH") {
      const uid = cleanText(body.uid, 128);
      if (!uid) throw Object.assign(new Error("Falta el identificador del usuario."), { statusCode: 400 });
      const ref = db.collection("usuarios").doc(uid);
      const current = await ref.get();
      if (!current.exists) throw Object.assign(new Error("El usuario no existe."), { statusCode: 404 });

      if (body.accion === "resetear_clave") {
        validatePassword(body.password);
        await adminAuth.updateUser(uid, { password: body.password });
        await ref.update({ cambioClaveObligatorio: true, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: admin.uid });
        await db.collection("auditoria").add({ accion: "resetear_clave", objetivoUid: uid, usuarioUid: admin.uid, fecha: FieldValue.serverTimestamp() });
        return response(200, { ok: true, mensaje: "Contraseña restablecida." }, origin);
      }

      const nombre = cleanText(body.nombre ?? current.data().nombre, 120);
      const perfil = PROFILES.includes(body.perfil) ? body.perfil : current.data().perfil;
      const activo = body.activo !== undefined ? Boolean(body.activo) : Boolean(current.data().activo);
      if (uid === admin.uid && !activo) throw Object.assign(new Error("No podés desactivar tu propio usuario."), { statusCode: 400 });

      await Promise.all([
        adminAuth.updateUser(uid, { displayName: nombre, disabled: !activo }),
        ref.update({ nombre, perfil, activo, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: admin.uid })
      ]);
      await db.collection("auditoria").add({ accion: "modificar_usuario", objetivoUid: uid, usuarioUid: admin.uid, fecha: FieldValue.serverTimestamp() });
      return response(200, { ok: true, mensaje: "Usuario actualizado." }, origin);
    }

    return response(405, { ok: false, error: "Método no permitido." }, origin);
  } catch (error) {
    if (error?.code === "auth/email-already-exists") error = Object.assign(new Error("El nombre de usuario ya existe."), { statusCode: 409 });
    return errorResponse(error, origin);
  }
}
