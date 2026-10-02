// Acceso a PostgreSQL y mapeo explícito snake_case (BD) <-> camelCase (JSON/TS).
import pkg from 'pg';
const { Pool } = pkg;

// Pool a nivel de módulo: reutiliza conexión entre invocaciones calientes de la Lambda.
// max:1 por contenedor Lambda para no agotar conexiones. Toma PGHOST/PGPORT/PGUSER/
// PGPASSWORD/PGDATABASE del entorno (ver nuance B del diseño: PGHOST=postgres).
export const pool = new Pool({ max: 1 });

function toIso(value) {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Fila de clients -> objeto Client (camelCase). Omite campos null (notificationEmail, updatedAt).
export function rowToClient(row) {
  const client = {
    clientId: row.client_id,
    cognitoUsername: row.cognito_username,
    name: row.name,
    company: row.company,
    email: row.email,
    status: row.status,
    deliveryMethod: row.delivery_method,
    s3Prefix: row.s3_prefix,
    urlExpiration: Number(row.url_expiration),
    totalProcesses: Number(row.total_processes),
    createdAt: toIso(row.created_at)
  };
  if (row.notification_email != null) client.notificationEmail = row.notification_email;
  const updatedAt = toIso(row.updated_at);
  if (updatedAt !== undefined) client.updatedAt = updatedAt;
  return client;
}

// ClientFormData -> columnas de la tabla clients (para INSERT/UPDATE).
// cognito_username se fija = email; s3Prefix ya viene normalizado (termina en '/').
export function clientBodyToColumns(body) {
  return {
    cognito_username: body.email,
    name: body.name,
    company: body.company,
    email: body.email,
    status: body.status,
    delivery_method: body.deliveryMethod,
    notification_email: body.notificationEmail ?? null,
    s3_prefix: body.s3Prefix,
    url_expiration: body.urlExpiration
  };
}

// Fila de process_history -> objeto ProcessRecord (camelCase).
// input_s3_key / output_s3_key son internos y NO se exponen. Omite campos null.
export function rowToProcess(row) {
  const record = {
    processId: row.process_id,
    clientId: row.client_id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: Number(row.file_size),
    status: row.status,
    createdAt: toIso(row.created_at)
  };
  if (row.download_url != null) record.downloadUrl = row.download_url;
  if (row.error_message != null) record.errorMessage = row.error_message;
  const completedAt = toIso(row.completed_at);
  if (completedAt !== undefined) record.completedAt = completedAt;
  return record;
}
