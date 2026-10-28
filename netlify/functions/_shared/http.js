const ALLOWED_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";

export function corsHeaders(origin = "") {
  const configuredOrigin = process.env.APP_ORIGIN || "https://controlsensible.netlify.app";
  const allowedOrigin = origin === configuredOrigin || origin.startsWith("http://localhost:")
    ? origin
    : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

export function response(statusCode, body, origin = "") {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body)
  };
}

export function preflight(event) {
  if (event.httpMethod !== "OPTIONS") return null;
  return response(204, {}, event.headers?.origin || "");
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw Object.assign(new Error("El contenido enviado no es JSON válido."), { statusCode: 400 });
  }
}

export function cleanText(value, max = 250) {
  return String(value ?? "").trim().slice(0, max);
}

export function cleanEan(value) {
  const ean = cleanText(value, 20).replace(/\D/g, "");
  if (ean.length < 6 || ean.length > 14) {
    throw Object.assign(new Error("El EAN debe contener entre 6 y 14 dígitos."), { statusCode: 400 });
  }
  return ean;
}

export function normalizeUsername(value) {
  const normalized = cleanText(value, 60)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (normalized.length < 3) {
    throw Object.assign(new Error("El usuario debe tener al menos 3 caracteres válidos."), { statusCode: 400 });
  }
  return normalized;
}

export function usernameToEmail(value) {
  return `${normalizeUsername(value)}@controlsensible.app`;
}

export function errorResponse(error, origin = "") {
  console.error(error);
  const statusCode = Number(error?.statusCode) || 500;
  const safeMessage = statusCode >= 500
    ? "No fue posible completar la operación. Intentá nuevamente."
    : error.message;
  return response(statusCode, { ok: false, error: safeMessage }, origin);
}
