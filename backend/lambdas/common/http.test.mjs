import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cors,
  json,
  parseBody,
  getClaims,
  groupsFrom,
  isAdmin,
  decodeTokenPayload,
  roleFromGroups
} from './http.mjs';

test('cors() incluye origin, methods y headers permitidos', () => {
  const h = cors();
  assert.equal(h['Access-Control-Allow-Origin'], 'http://localhost:4200');
  assert.equal(h['Access-Control-Allow-Methods'], 'GET,POST,PUT,DELETE,OPTIONS');
  assert.equal(h['Access-Control-Allow-Headers'], 'Authorization,Content-Type');
});

test('json() serializa body y añade CORS', () => {
  const res = json(200, { ok: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:4200');
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('json() con body nulo (204) devuelve cuerpo vacío y sigue con CORS', () => {
  const res = json(204, null);
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:4200');
});

test('parseBody() parsea JSON y maneja base64 y vacío', () => {
  assert.deepEqual(parseBody({ body: '{"a":1}' }), { a: 1 });
  const b64 = Buffer.from('{"b":2}').toString('base64');
  assert.deepEqual(parseBody({ body: b64, isBase64Encoded: true }), { b: 2 });
  assert.deepEqual(parseBody({ body: '' }), {});
  assert.deepEqual(parseBody({}), {});
  assert.deepEqual(parseBody({ body: 'no-json' }), {});
});

test('getClaims() devuelve claims del autorizador o {}', () => {
  const claims = { sub: 'x' };
  assert.deepEqual(getClaims({ requestContext: { authorizer: { claims } } }), claims);
  assert.deepEqual(getClaims({}), {});
  assert.deepEqual(getClaims(null), {});
});

test('groupsFrom() normaliza array', () => {
  assert.deepEqual(groupsFrom(['admin']), ['admin']);
  assert.deepEqual(groupsFrom(['admin', 'client']), ['admin', 'client']);
});

test('groupsFrom() normaliza string con corchetes, coma y espacio', () => {
  assert.deepEqual(groupsFrom('[admin]'), ['admin']);
  assert.deepEqual(groupsFrom('admin,client'), ['admin', 'client']);
  assert.deepEqual(groupsFrom('admin client'), ['admin', 'client']);
  assert.deepEqual(groupsFrom('[admin, client]'), ['admin', 'client']);
});

test('groupsFrom() con vacío/null/undefined devuelve []', () => {
  assert.deepEqual(groupsFrom(''), []);
  assert.deepEqual(groupsFrom(null), []);
  assert.deepEqual(groupsFrom(undefined), []);
});

test('isAdmin() match exacto: admin sí, admin-readonly NO', () => {
  assert.equal(isAdmin({ 'cognito:groups': ['admin'] }), true);
  assert.equal(isAdmin({ 'cognito:groups': '[admin]' }), true);
  assert.equal(isAdmin({ 'cognito:groups': 'admin,client' }), true);
  assert.equal(isAdmin({ 'cognito:groups': ['admin-readonly'] }), false);
  assert.equal(isAdmin({ 'cognito:groups': 'admin-readonly' }), false);
  assert.equal(isAdmin({ 'cognito:groups': ['client'] }), false);
  assert.equal(isAdmin({}), false);
});

test('decodeTokenPayload() decodifica el payload base64url de un JWT', () => {
  const payload = { 'cognito:groups': ['admin'], email: 'admin@dataflow.com' };
  const seg = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `header.${seg}.signature`;
  assert.deepEqual(decodeTokenPayload(token), payload);
});

test('decodeTokenPayload() tolera entradas inválidas', () => {
  assert.deepEqual(decodeTokenPayload('no-dots'), {});
  assert.deepEqual(decodeTokenPayload(null), {});
});

test('roleFromGroups() deriva role del claim (login path)', () => {
  assert.equal(roleFromGroups(['admin']), 'admin');
  assert.equal(roleFromGroups('[admin]'), 'admin');
  assert.equal(roleFromGroups(['client']), 'client');
  assert.equal(roleFromGroups(['admin-readonly']), 'client');
  assert.equal(roleFromGroups(null), 'client');
});
