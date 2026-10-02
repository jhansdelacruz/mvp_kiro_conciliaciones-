// Verificación del id token en la capa handler (enforcement local).
//
// Por qué aquí: este build de Floci NO aplica el autorizador Cognito del API Gateway
// (ni rechaza tokens inválidos ni inyecta requestContext.authorizer.claims). El autorizador
// nativo COGNITO_USER_POOLS se mantiene adjunto en el API Gateway por fidelidad con producción;
// en AWS real valida en el gateway y esta verificación en el handler queda como defensa en
// profundidad (inofensiva, valida el MISMO token). En local es la única capa que hace enforcement.
//
// Valida: firma RS256 contra el JWKS del pool (resuelto por provision.mjs desde el discovery
// OpenID, no hardcodeado), exp, aud (= app client id), iss y token_use === 'id'.
import crypto from 'node:crypto';
import { json, groupsFrom } from './http.mjs';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

// Config desde el entorno de la Lambda (poblado por provision.mjs).
// COGNITO_JWKS_URI es la URL INTERNA (http://floci:4566/...) alcanzable desde el contenedor.
function config() {
  return {
    jwksUri: process.env.COGNITO_JWKS_URI,
    issuer: process.env.COGNITO_ISSUER,
    audience: process.env.COGNITO_APP_CLIENT_ID
  };
}

// Caché del JWKS en memoria del contenedor (se reutiliza entre invocaciones calientes).
let jwksCache = null;

async function getJwks() {
  if (jwksCache) return jwksCache;
  const { jwksUri } = config();
  if (!jwksUri) throw new AuthError('COGNITO_JWKS_URI no configurado');
  const res = await fetch(jwksUri);
  if (!res.ok) throw new AuthError(`No se pudo descargar el JWKS (HTTP ${res.status})`);
  const doc = await res.json();
  jwksCache = doc.keys || [];
  return jwksCache;
}

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

// Extrae el Bearer token del header Authorization (case-insensitive).
export function extractBearer(event) {
  const headers = event?.headers || {};
  let value = null;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      value = v;
      break;
    }
  }
  if (!value || typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

// Verifica el id token y devuelve sus claims. Lanza AuthError si es inválido.
export async function verifyIdToken(token) {
  if (!token || typeof token !== 'string') throw new AuthError('Token ausente');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Token mal formado');

  let header;
  try {
    header = decodeSegment(parts[0]);
  } catch {
    throw new AuthError('Encabezado del token ilegible');
  }
  if (header.alg !== 'RS256') throw new AuthError(`Algoritmo no soportado: ${header.alg}`);

  const jwks = await getJwks();
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('No se encontró la clave (kid) en el JWKS');

  // Verificación de firma RS256.
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new AuthError('JWK inválido');
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');
  const valid = crypto.verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
  if (!valid) throw new AuthError('Firma inválida');

  // Claims.
  let payload;
  try {
    payload = decodeSegment(parts[1]);
  } catch {
    throw new AuthError('Payload del token ilegible');
  }

  const { issuer, audience } = config();
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new AuthError('Token expirado');
  if (payload.token_use !== 'id') throw new AuthError('token_use no es id');
  if (issuer && payload.iss !== issuer) throw new AuthError('Issuer inesperado');
  if (audience && payload.aud !== audience) throw new AuthError('Audiencia inesperada');

  return payload;
}

// Autentica la petición. Devuelve { claims } o { error } (respuesta 401 lista para retornar).
export async function authenticate(event) {
  try {
    const token = extractBearer(event);
    const claims = await verifyIdToken(token);
    return { claims };
  } catch (err) {
    if (err instanceof AuthError) {
      console.warn('Autenticación rechazada:', err.message);
      return { error: json(401, { message: 'No autorizado' }) };
    }
    console.error('Error verificando token:', err);
    return { error: json(401, { message: 'No autorizado' }) };
  }
}

// Reexport para que los handlers usen una sola forma de parsear grupos.
export { groupsFrom };
