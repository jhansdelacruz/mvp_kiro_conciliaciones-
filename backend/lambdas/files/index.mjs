// Handler protegido de archivos: presigned upload, trigger de procesamiento y descarga.
// Nota: file-upload del frontend aún está simulado; estos endpoints quedan listos por adelantado.
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json, parseBody } from './common/http.mjs';
import { authenticate } from './common/auth.mjs';
import { pool } from './common/db.mjs';
import { validateFileUpload } from './common/validate.mjs';

const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_REGION || 'us-east-1',
  forcePathStyle: true
});

const INPUT_BUCKET = process.env.INPUT_BUCKET || 'dataflow-input-local';
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'dataflow-output-local';

// Tope de validez de URLs prefirmadas: 5 días (432000 s). Nunca emitimos una URL
// con expiración mayor, aunque el valor almacenado del cliente lo excediera.
const MAX_EXPIRES_IN = 432000;
const clampExpires = (seconds) =>
  Math.min(Math.max(Number(seconds) || 0, 60), MAX_EXPIRES_IN);

export async function handler(event) {
  if (event?.httpMethod === 'OPTIONS') return json(200, {});

  // Ruta protegida: requiere id token válido (verificación en la capa handler).
  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  const resource = event?.resource || '';
  const method = event?.httpMethod || '';

  try {
    if (resource === '/files/presigned-upload' && method === 'POST') {
      const body = parseBody(event);
      const invalid = validateFileUpload(body);
      if (invalid) return json(400, invalid);

      const { rows } = await pool.query(
        `SELECT s3_prefix, url_expiration FROM clients WHERE client_id = $1`,
        [body.clientId]
      );
      if (rows.length === 0) return json(404, { message: 'Cliente no encontrado' });

      const s3Prefix = rows[0].s3_prefix;
      const expiresIn = clampExpires(rows[0].url_expiration);
      const processId = 'proc-' + randomUUID();
      const key = `${s3Prefix}${processId}/${body.fileName}`;

      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: INPUT_BUCKET, Key: key }),
        { expiresIn }
      );
      return json(200, { url, key, processId });
    }

    if (resource === '/files/trigger' && method === 'POST') {
      const body = parseBody(event);
      await pool.query(
        `INSERT INTO process_history (process_id, client_id, file_name, file_type, file_size, status, input_s3_key, created_at)
         VALUES ($1,$2,$3,$4,$5,'PROCESSING',$6,now())
         ON CONFLICT (process_id) DO NOTHING`,
        [body.processId, body.clientId, body.fileName, body.fileType, body.fileSize, body.key]
      );
      // TODO AgentCore: aquí se invocaría el AgentCore Runtime con input_s3_key (fuera de alcance).
      return json(200, { processId: body.processId, status: 'PROCESSING' });
    }

    if (resource === '/files/download/{processId}' && method === 'GET') {
      const processId = event?.pathParameters?.processId;
      const { rows } = await pool.query(
        `SELECT ph.output_s3_key, c.url_expiration
         FROM process_history ph
         JOIN clients c ON c.client_id = ph.client_id
         WHERE ph.process_id = $1`,
        [processId]
      );
      if (rows.length === 0 || !rows[0].output_s3_key) {
        return json(404, { message: 'Documento no disponible' });
      }

      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: rows[0].output_s3_key }),
        { expiresIn: clampExpires(rows[0].url_expiration) }
      );
      return json(200, { url });
    }

    return json(404, { message: 'Ruta no encontrada' });
  } catch (err) {
    console.error('Error en handler files:', err);
    return json(500, { message: 'Error interno' });
  }
}
