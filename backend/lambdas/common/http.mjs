// Utilidades HTTP compartidas por todos los handlers Lambda.
// Se copian dentro de cada ZIP de función en tiempo de empaquetado (no Lambda Layers).

const ALLOWED_ORIGIN = 'http://localhost:4200';

// Cabeceras CORS incluidas en TODAS las respuestas (éxito y error) y en el preflight OPTIONS.
export function cors() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type'
  };
}

// Respuesta JSON con cabeceras CORS. body === undefined/null => cuerpo vacío (p. ej. 204).
export function json(status, body) {
  const headers = { ...cors() };
  if (body === undefined || body === null) {
    return { statusCode: status, headers, body: '' };
  }
  headers['Content-Type'] = 'application/json';
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

// Parseo robusto del cuerpo de la petición (API Gateway puede entregarlo en base64).
export function parseBody(event) {
  if (!event || event.body == null || event.body === '') return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Claims poblados por el autorizador Cognito en integraciones AWS_PROXY.
export function getClaims(event) {
  return event?.requestContext?.authorizer?.claims ?? {};
}

// Normaliza el claim cognito:groups: puede llegar como array JSON (["admin"]) desde el
// payload del id token, o como string serializado ("[admin]", "admin,client", "admin client")
// desde los claims del autorizador. Devuelve siempre string[] con tokens exactos.
export function groupsFrom(claim) {
  if (Array.isArray(claim)) return claim;
  if (typeof claim === 'string')
    return claim.replace(/^\[|\]$/g, '').split(/[,\s]+/).filter(Boolean);
  return [];
}

// Match EXACTO de token: 'admin-readonly' NO cuenta como 'admin'.
export function isAdmin(claims) {
  return groupsFrom(claims['cognito:groups']).includes('admin');
}

// Decodifica el payload (segmento central) de un JWT base64url. No verifica la firma:
// la verificación de firma la hace el autorizador Cognito en las rutas protegidas.
export function decodeTokenPayload(token) {
  if (typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// Deriva el rol desde el claim cognito:groups usando el MISMO helper que los handlers.
export function roleFromGroups(claim) {
  return groupsFrom(claim).includes('admin') ? 'admin' : 'client';
}
