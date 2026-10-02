import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLogin,
  validateClientForm,
  normalizeS3Prefix,
  validateFileUpload
} from './validate.mjs';

test('validateLogin() exige email y password', () => {
  assert.deepEqual(validateLogin({}), { message: 'email y password son obligatorios' });
  assert.deepEqual(validateLogin({ email: 'a@b.com' }), { message: 'email y password son obligatorios' });
  assert.deepEqual(validateLogin({ password: 'x' }), { message: 'email y password son obligatorios' });
});

test('validateLogin() acepta credenciales válidas', () => {
  assert.equal(validateLogin({ email: 'admin@dataflow.com', password: 'Admin123!' }), null);
});

test('validateLogin() rechaza email con formato inválido', () => {
  const res = validateLogin({ email: 'no-es-email', password: 'x' });
  assert.ok(res && res.errors && res.errors.email);
});

test('validateClientForm() acepta un cliente DASHBOARD válido sin notificationEmail', () => {
  assert.equal(validateClientForm({
    name: 'Juan', company: 'ACME', email: 'juan@acme.com', status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD', s3Prefix: 'clients/acme/', urlExpiration: 3600
  }), null);
});

test('validateClientForm() exige notificationEmail cuando deliveryMethod es EMAIL', () => {
  const res = validateClientForm({
    name: 'X', company: 'Y', email: 'x@y.com', status: 'ACTIVE',
    deliveryMethod: 'EMAIL', s3Prefix: 'clients/x/', urlExpiration: 3600
  });
  assert.ok(res && res.errors.notificationEmail);
});

test('validateClientForm() valida enums y rangos', () => {
  const res = validateClientForm({
    name: '', company: '', email: 'malo', status: 'OTRO',
    deliveryMethod: 'FAX', s3Prefix: '', urlExpiration: 1
  });
  assert.ok(res.errors.name);
  assert.ok(res.errors.company);
  assert.ok(res.errors.email);
  assert.ok(res.errors.status);
  assert.ok(res.errors.deliveryMethod);
  assert.ok(res.errors.s3Prefix);
  assert.ok(res.errors.urlExpiration);
});

test('validateClientForm() respeta los límites de urlExpiration (60..604800)', () => {
  const base = {
    name: 'X', company: 'Y', email: 'x@y.com', status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD', s3Prefix: 'clients/x/'
  };
  assert.equal(validateClientForm({ ...base, urlExpiration: 60 }), null);
  assert.equal(validateClientForm({ ...base, urlExpiration: 604800 }), null);
  assert.ok(validateClientForm({ ...base, urlExpiration: 59 }));
  assert.ok(validateClientForm({ ...base, urlExpiration: 604801 }));
  assert.ok(validateClientForm({ ...base, urlExpiration: 3600.5 }));
});

test('normalizeS3Prefix() asegura barra final', () => {
  assert.equal(normalizeS3Prefix('clients/acme'), 'clients/acme/');
  assert.equal(normalizeS3Prefix('clients/acme/'), 'clients/acme/');
});

test('validateFileUpload() acepta entrada válida', () => {
  assert.equal(validateFileUpload({
    clientId: 'client-001', fileName: 'ventas.csv', fileType: 'CSV', fileSize: 1000
  }), null);
});

test('validateFileUpload() rechaza fileName con / o ..', () => {
  assert.ok(validateFileUpload({ clientId: 'c', fileName: 'a/b.csv', fileType: 'CSV', fileSize: 1 }).errors.fileName);
  assert.ok(validateFileUpload({ clientId: 'c', fileName: '..evil.csv', fileType: 'CSV', fileSize: 1 }).errors.fileName);
});

test('validateFileUpload() valida fileType y rango de fileSize', () => {
  assert.ok(validateFileUpload({ clientId: 'c', fileName: 'a.txt', fileType: 'TXT', fileSize: 1 }).errors.fileType);
  assert.ok(validateFileUpload({ clientId: 'c', fileName: 'a.csv', fileType: 'CSV', fileSize: 0 }).errors.fileSize);
  assert.ok(validateFileUpload({ clientId: 'c', fileName: 'a.csv', fileType: 'CSV', fileSize: 52428801 }).errors.fileSize);
});
