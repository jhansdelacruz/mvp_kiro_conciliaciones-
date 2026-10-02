// Validaciones por campo aplicadas en los handlers antes de tocar la BD.
// Cada función devuelve null si es válido, o { message, errors } para responder 400.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isInteger(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

// POST /auth/login: email y password obligatorios. Mensaje exacto que el frontend espera.
export function validateLogin(body) {
  const b = body ?? {};
  if (!isNonEmptyString(b.email) || !isNonEmptyString(b.password)) {
    return { message: 'email y password son obligatorios' };
  }
  const errors = {};
  if (!EMAIL_RE.test(b.email) || b.email.length > 254) errors.email = 'email inválido';
  if (typeof b.password !== 'string' || b.password.length < 1 || b.password.length > 256)
    errors.password = 'password inválido';
  if (Object.keys(errors).length > 0) {
    return { message: 'Datos de inicio de sesión inválidos', errors };
  }
  return null;
}

// POST /clients y PUT /clients/{id}: ClientFormData.
export function validateClientForm(body) {
  const b = body ?? {};
  const errors = {};

  if (!isNonEmptyString(b.name) || b.name.length > 200) errors.name = 'name es obligatorio (1..200)';
  if (!isNonEmptyString(b.company) || b.company.length > 200)
    errors.company = 'company es obligatorio (1..200)';
  if (!isNonEmptyString(b.email) || !EMAIL_RE.test(b.email) || b.email.length > 254)
    errors.email = 'email es obligatorio y debe tener formato válido';
  if (b.status !== 'ACTIVE' && b.status !== 'INACTIVE')
    errors.status = 'status debe ser ACTIVE o INACTIVE';
  if (b.deliveryMethod !== 'EMAIL' && b.deliveryMethod !== 'DASHBOARD')
    errors.deliveryMethod = 'deliveryMethod debe ser EMAIL o DASHBOARD';

  const hasNotificationEmail = b.notificationEmail != null && b.notificationEmail !== '';
  if (hasNotificationEmail) {
    if (typeof b.notificationEmail !== 'string' || !EMAIL_RE.test(b.notificationEmail) || b.notificationEmail.length > 254)
      errors.notificationEmail = 'notificationEmail debe tener formato de email';
  }
  if (b.deliveryMethod === 'EMAIL' && !hasNotificationEmail)
    errors.notificationEmail = 'notificationEmail es obligatorio cuando deliveryMethod es EMAIL';

  if (!isNonEmptyString(b.s3Prefix) || b.s3Prefix.length > 200)
    errors.s3Prefix = 's3Prefix es obligatorio (1..200)';
  // Máximo 5 días (432000 s). Las URLs prefirmadas no pueden exceder este límite.
  if (!isInteger(b.urlExpiration) || b.urlExpiration < 60 || b.urlExpiration > 432000)
    errors.urlExpiration = 'urlExpiration debe ser un entero entre 60 y 432000 (máx. 5 días)';

  if (Object.keys(errors).length > 0) {
    return { message: 'Datos del cliente inválidos', errors };
  }
  return null;
}

// Normaliza s3Prefix para que termine en '/'. Lo usa el handler de clients tras validar.
export function normalizeS3Prefix(prefix) {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

// POST /files/presigned-upload. La existencia del clientId se verifica contra la BD en el handler.
export function validateFileUpload(body) {
  const b = body ?? {};
  const errors = {};

  if (!isNonEmptyString(b.clientId)) errors.clientId = 'clientId es obligatorio';
  if (!isNonEmptyString(b.fileName) || b.fileName.length > 255)
    errors.fileName = 'fileName es obligatorio (1..255)';
  else if (b.fileName.includes('/') || b.fileName.includes('..'))
    errors.fileName = "fileName no puede contener '/' ni '..'";
  if (b.fileType !== 'CSV' && b.fileType !== 'JSON' && b.fileType !== 'XLSX')
    errors.fileType = 'fileType debe ser CSV, JSON o XLSX';
  if (!isInteger(b.fileSize) || b.fileSize < 1 || b.fileSize > 52428800)
    errors.fileSize = 'fileSize debe ser un entero entre 1 y 52428800';

  if (Object.keys(errors).length > 0) {
    return { message: 'Datos de archivo inválidos', errors };
  }
  return null;
}
