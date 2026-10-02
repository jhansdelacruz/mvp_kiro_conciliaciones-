// Handler protegido de administración de clientes (requiere grupo Cognito 'admin').
// Router interno por event.resource + event.httpMethod.
import { json, parseBody, isAdmin } from './common/http.mjs';
import { authenticate } from './common/auth.mjs';
import { pool, rowToClient, clientBodyToColumns } from './common/db.mjs';
import { validateClientForm, normalizeS3Prefix } from './common/validate.mjs';

const CLIENT_COLUMNS =
  'client_id, cognito_username, name, company, email, status, delivery_method, notification_email, s3_prefix, url_expiration, total_processes, created_at, updated_at';

export async function handler(event) {
  if (event?.httpMethod === 'OPTIONS') return json(200, {});

  // Autenticación (verificación del id token en la capa handler) + autorización por grupo.
  const auth = await authenticate(event);
  if (auth.error) return auth.error;
  if (!isAdmin(auth.claims)) {
    console.warn('Acceso denegado a /clients (no admin)');
    return json(403, { message: 'Acceso denegado' });
  }

  const resource = event?.resource || '';
  const method = event?.httpMethod || '';
  const id = event?.pathParameters?.id;

  try {
    if (resource === '/clients' && method === 'GET') {
      const { rows } = await pool.query(
        `SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY created_at ASC`
      );
      return json(200, rows.map(rowToClient));
    }

    if (resource === '/clients' && method === 'POST') {
      const body = parseBody(event);
      const invalid = validateClientForm(body);
      if (invalid) return json(400, invalid);

      body.s3Prefix = normalizeS3Prefix(body.s3Prefix);
      const cols = clientBodyToColumns(body);
      const clientId = 'client-' + Date.now();
      const { rows } = await pool.query(
        `INSERT INTO clients (client_id, cognito_username, name, company, email, status, delivery_method, notification_email, s3_prefix, url_expiration, total_processes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,now())
         RETURNING ${CLIENT_COLUMNS}`,
        [
          clientId,
          cols.cognito_username,
          cols.name,
          cols.company,
          cols.email,
          cols.status,
          cols.delivery_method,
          cols.notification_email,
          cols.s3_prefix,
          cols.url_expiration
        ]
      );
      return json(201, rowToClient(rows[0]));
    }

    if (resource === '/clients/{id}' && method === 'GET') {
      const { rows } = await pool.query(
        `SELECT ${CLIENT_COLUMNS} FROM clients WHERE client_id = $1`,
        [id]
      );
      if (rows.length === 0) return json(404, { message: 'Cliente no encontrado' });
      return json(200, rowToClient(rows[0]));
    }

    if (resource === '/clients/{id}' && method === 'PUT') {
      const body = parseBody(event);
      const invalid = validateClientForm(body);
      if (invalid) return json(400, invalid);

      body.s3Prefix = normalizeS3Prefix(body.s3Prefix);
      const cols = clientBodyToColumns(body);
      const { rows } = await pool.query(
        `UPDATE clients SET cognito_username=$2, name=$3, company=$4, email=$5, status=$6,
           delivery_method=$7, notification_email=$8, s3_prefix=$9, url_expiration=$10, updated_at=now()
         WHERE client_id=$1
         RETURNING ${CLIENT_COLUMNS}`,
        [
          id,
          cols.cognito_username,
          cols.name,
          cols.company,
          cols.email,
          cols.status,
          cols.delivery_method,
          cols.notification_email,
          cols.s3_prefix,
          cols.url_expiration
        ]
      );
      if (rows.length === 0) return json(404, { message: 'Cliente no encontrado' });
      return json(200, rowToClient(rows[0]));
    }

    if (resource === '/clients/{id}/deactivate' && method === 'DELETE') {
      const { rowCount } = await pool.query(
        `UPDATE clients SET status='INACTIVE', updated_at=now() WHERE client_id=$1`,
        [id]
      );
      if (rowCount === 0) return json(404, { message: 'Cliente no encontrado' });
      return json(204, null);
    }

    return json(404, { message: 'Ruta no encontrada' });
  } catch (err) {
    console.error('Error en handler clients:', err);
    return json(500, { message: 'Error interno' });
  }
}
