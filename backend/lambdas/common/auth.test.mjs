import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBearer, verifyIdToken, authenticate, AuthError } from './auth.mjs';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

test('extractBearer() lee el token del header Authorization (case-insensitive)', () => {
  assert.equal(extractBearer({ headers: { Authorization: 'Bearer abc.def.ghi' } }), 'abc.def.ghi');
  assert.equal(extractBearer({ headers: { authorization: 'Bearer xyz' } }), 'xyz');
  assert.equal(extractBearer({ headers: { Authorization: 'bearer lower' } }), 'lower');
});

test('extractBearer() devuelve null si falta o no es Bearer', () => {
  assert.equal(extractBearer({ headers: {} }), null);
  assert.equal(extractBearer({}), null);
  assert.equal(extractBearer({ headers: { Authorization: 'Basic zzz' } }), null);
});

test('verifyIdToken() rechaza token ausente', async () => {
  await assert.rejects(() => verifyIdToken(null), AuthError);
  await assert.rejects(() => verifyIdToken(''), AuthError);
});

test('verifyIdToken() rechaza token mal formado (no 3 segmentos)', async () => {
  await assert.rejects(() => verifyIdToken('solo.dos'), (e) => e instanceof AuthError && /mal formado/.test(e.message));
});

test('verifyIdToken() rechaza algoritmo no RS256 antes de pedir el JWKS', async () => {
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'x' })}.firma`;
  await assert.rejects(() => verifyIdToken(token), (e) => e instanceof AuthError && /Algoritmo/.test(e.message));
});

test('authenticate() devuelve { error } 401 ante token inválido', async () => {
  const res = await authenticate({ headers: { Authorization: 'Bearer solo.dos' } });
  assert.ok(res.error);
  assert.equal(res.error.statusCode, 401);
  assert.deepEqual(JSON.parse(res.error.body), { message: 'No autorizado' });
});

test('authenticate() sin header devuelve 401', async () => {
  const res = await authenticate({ headers: {} });
  assert.equal(res.error.statusCode, 401);
});
