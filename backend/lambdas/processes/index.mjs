// Handler protegido de historial de procesos.
// Aislamiento por tenant: para el rol 'client' el clientId se deriva del claim
// custom:clientId del id token (se IGNORA el query param); el admin consulta por query param.
import { json, isAdmin } from './common/http.mjs';
import { authenticate } from './common/auth.mjs';
import { pool, rowToProcess } from './common/db.mjs';

const PROCESS_COLUMNS =
  'process_id, client_id, file_name, file_type, file_size, status, input_s3_key, output_s3_key, download_url, error_message, created_at, completed_at';

// Resuelve el clientId efectivo según el rol. Devuelve { clientId } o { error: response }.
function resolveClientId(event, claims) {
  if (isAdmin(claims)) {
    const clientId = event?.queryStringParameters?.clientId;
    if (!clientId) return { error: json(400, { message: 'clientId es obligatorio' }) };
    return { clientId };
  }
  const clientId = claims['custom:clientId'];
  if (!clientId) return { error: json(403, { message: 'Acceso denegado' }) };
  return { clientId };
}

export async function handler(event) {
  if (event?.httpMethod === 'OPTIONS') return json(200, {});

  // Autenticación (verificación del id token en la capa handler).
  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  const resource = event?.resource || '';
  const method = event?.httpMethod || '';

  try {
    if (resource === '/processes' && method === 'GET') {
      const resolved = resolveClientId(event, auth.claims);
      if (resolved.error) return resolved.error;

      const { rows } = await pool.query(
        `SELECT ${PROCESS_COLUMNS} FROM process_history WHERE client_id = $1 ORDER BY created_at DESC`,
        [resolved.clientId]
      );
      return json(200, rows.map(rowToProcess));
    }

    if (resource === '/processes/{processId}/retry' && method === 'POST') {
      const resolved = resolveClientId(event, auth.claims);
      if (resolved.error) return resolved.error;

      const processId = event?.pathParameters?.processId;
      const { rowCount } = await pool.query(
        `UPDATE process_history SET status='PENDING', error_message=NULL
         WHERE process_id=$1 AND client_id=$2`,
        [processId, resolved.clientId]
      );
      if (rowCount === 0) return json(404, { message: 'Proceso no encontrado' });
      return json(204, null);
    }

    return json(404, { message: 'Ruta no encontrada' });
  } catch (err) {
    console.error('Error en handler processes:', err);
    return json(500, { message: 'Error interno' });
  }
}
