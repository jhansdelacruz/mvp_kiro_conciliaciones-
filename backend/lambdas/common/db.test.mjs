import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowToClient, clientBodyToColumns, rowToProcess } from './db.mjs';

test('rowToClient() mapea snake->camel y omite null (DASHBOARD sin notification/updated)', () => {
  const row = {
    client_id: 'client-001',
    cognito_username: 'juan.garcia@acme.com',
    name: 'Juan García',
    company: 'ACME Distribuciones S.A.',
    email: 'juan.garcia@acme.com',
    status: 'ACTIVE',
    delivery_method: 'DASHBOARD',
    notification_email: null,
    s3_prefix: 'clients/acme/',
    url_expiration: 3600,
    total_processes: 15,
    created_at: new Date('2024-01-05T08:00:00Z'),
    updated_at: null
  };
  const client = rowToClient(row);
  assert.equal(client.clientId, 'client-001');
  assert.equal(client.cognitoUsername, 'juan.garcia@acme.com');
  assert.equal(client.deliveryMethod, 'DASHBOARD');
  assert.equal(client.urlExpiration, 3600);
  assert.equal(client.totalProcesses, 15);
  assert.equal(client.createdAt, '2024-01-05T08:00:00.000Z');
  assert.ok(!('notificationEmail' in client));
  assert.ok(!('updatedAt' in client));
});

test('rowToClient() incluye notificationEmail y updatedAt cuando existen (EMAIL)', () => {
  const row = {
    client_id: 'client-002',
    cognito_username: 'maria.lopez@tecnova.mx',
    name: 'María López',
    company: 'Tecnova México',
    email: 'maria.lopez@tecnova.mx',
    status: 'ACTIVE',
    delivery_method: 'EMAIL',
    notification_email: 'maria.lopez@tecnova.mx',
    s3_prefix: 'clients/tecnova/',
    url_expiration: 7200,
    total_processes: 8,
    created_at: new Date('2024-01-20T09:15:00Z'),
    updated_at: new Date('2024-02-28T14:00:00Z')
  };
  const client = rowToClient(row);
  assert.equal(client.notificationEmail, 'maria.lopez@tecnova.mx');
  assert.equal(client.updatedAt, '2024-02-28T14:00:00.000Z');
});

test('clientBodyToColumns() fija cognito_username=email y conserva campos', () => {
  const cols = clientBodyToColumns({
    name: 'Nuevo',
    company: 'Empresa',
    email: 'nuevo@empresa.com',
    status: 'ACTIVE',
    deliveryMethod: 'EMAIL',
    notificationEmail: 'avisos@empresa.com',
    s3Prefix: 'clients/nuevo/',
    urlExpiration: 3600
  });
  assert.equal(cols.cognito_username, 'nuevo@empresa.com');
  assert.equal(cols.delivery_method, 'EMAIL');
  assert.equal(cols.notification_email, 'avisos@empresa.com');
  assert.equal(cols.s3_prefix, 'clients/nuevo/');
  assert.equal(cols.url_expiration, 3600);
});

test('clientBodyToColumns() usa null cuando no hay notificationEmail', () => {
  const cols = clientBodyToColumns({
    name: 'X', company: 'Y', email: 'x@y.com', status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD', s3Prefix: 'clients/x/', urlExpiration: 3600
  });
  assert.equal(cols.notification_email, null);
});

test('rowToProcess() mapea y NO expone input/output_s3_key', () => {
  const row = {
    process_id: 'proc-001',
    client_id: 'client-001',
    file_name: 'ventas_enero_2024.csv',
    file_type: 'CSV',
    file_size: 245760,
    status: 'COMPLETED',
    input_s3_key: 'clients/acme/proc-001/ventas_enero_2024.csv',
    output_s3_key: 'clients/acme/proc-001/ventas_enero_2024_processed.csv',
    download_url: 'https://s3.amazonaws.com/bucket/x?X-Amz-Signature=mock',
    error_message: null,
    created_at: new Date('2024-01-15T09:30:00Z'),
    completed_at: new Date('2024-01-15T09:35:22Z')
  };
  const rec = rowToProcess(row);
  assert.equal(rec.processId, 'proc-001');
  assert.equal(rec.fileSize, 245760);
  assert.equal(rec.downloadUrl, 'https://s3.amazonaws.com/bucket/x?X-Amz-Signature=mock');
  assert.equal(rec.createdAt, '2024-01-15T09:30:00.000Z');
  assert.equal(rec.completedAt, '2024-01-15T09:35:22.000Z');
  assert.ok(!('inputS3Key' in rec));
  assert.ok(!('outputS3Key' in rec));
  assert.ok(!('input_s3_key' in rec));
  assert.ok(!('errorMessage' in rec));
});

test('rowToProcess() incluye errorMessage y omite completedAt/downloadUrl nulos', () => {
  const row = {
    process_id: 'proc-003',
    client_id: 'client-001',
    file_name: 'facturas_2024.xlsx',
    file_type: 'XLSX',
    file_size: 512000,
    status: 'ERROR',
    input_s3_key: 'clients/acme/proc-003/facturas_2024.xlsx',
    output_s3_key: null,
    download_url: null,
    error_message: 'El archivo contiene columnas no reconocidas en la fila 45. Por favor revise el formato.',
    created_at: new Date('2024-02-20T11:10:00Z'),
    completed_at: new Date('2024-02-20T11:11:30Z')
  };
  const rec = rowToProcess(row);
  assert.equal(rec.errorMessage, 'El archivo contiene columnas no reconocidas en la fila 45. Por favor revise el formato.');
  assert.ok(!('downloadUrl' in rec));
});
