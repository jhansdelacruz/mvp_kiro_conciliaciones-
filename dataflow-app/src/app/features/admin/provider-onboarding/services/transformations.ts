// Catálogo de transformaciones puras, tabla de alias canónicos, autosuggest
// determinístico y transformación por defecto por protocolo/dirección.
// Todo es puro y testeable sin Angular (design.md §8).

import {
  CanonicalField,
  FieldLink,
  Protocol,
  ProviderField,
  TransformationId
} from '../models/onboarding.model';

export type TransformDirection = 'INPUT' | 'OUTPUT';

// =====================================================================
// Transformaciones puras (value:string) => string
// =====================================================================

const CURRENCY_TO_ISO: Record<string, string> = {
  '604': 'PEN',
  '840': 'USD',
  SOL: 'PEN',
  DOL: 'USD',
  PEN: 'PEN',
  USD: 'USD'
};

const ISO_TO_ALPHA: Record<string, string> = { PEN: 'SOL', USD: 'DOL' };
const ISO_TO_NUM: Record<string, string> = { PEN: '604', USD: '840' };

function amountImplicitToDecimal(value: string): string {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) {
    return '0.00';
  }
  const padded = digits.padStart(3, '0');
  const dec = padded.slice(-2);
  const intPart = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${intPart}.${dec}`;
}

function amountFloatToDecimal(value: string): string {
  const n = Number((value || '').toString().replace(/,/g, '.').trim());
  if (!isFinite(n)) {
    return '0.00';
  }
  return n.toFixed(2);
}

function decimalToProviderDecimal(value: string): string {
  const n = Number((value || '').toString().replace(/,/g, '.').trim());
  if (!isFinite(n)) {
    return '0.00';
  }
  return n.toFixed(2);
}

function decimalToProviderImplicit(value: string): string {
  const n = Number((value || '').toString().replace(/,/g, '.').trim());
  if (!isFinite(n)) {
    return '000000000000';
  }
  const cents = Math.round(n * 100);
  return String(cents).padStart(12, '0');
}

function currencyProviderToIso(value: string): string {
  const key = (value || '').trim().toUpperCase();
  return CURRENCY_TO_ISO[key] ?? key;
}

function currencyIsoToProviderAlpha(value: string): string {
  const key = (value || '').trim().toUpperCase();
  return ISO_TO_ALPHA[key] ?? key;
}

function currencyIsoToProviderNum(value: string): string {
  const key = (value || '').trim().toUpperCase();
  return ISO_TO_NUM[key] ?? key;
}

function dateDdMmYyyyToIso(value: string): string {
  const m = /^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/.exec((value || '').trim());
  if (!m) {
    return value;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function dateYyyyMmDdToIso(value: string): string {
  const m = /^(\d{4})[/\-.]?(\d{2})[/\-.]?(\d{2})$/.exec((value || '').trim());
  if (!m) {
    return value;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export const TRANSFORMATIONS: Record<TransformationId, (value: string) => string> = {
  NONE: (v) => v,
  AMOUNT_FLOAT_TO_DECIMAL: amountFloatToDecimal,
  AMOUNT_IMPLICIT_TO_DECIMAL: amountImplicitToDecimal,
  CURRENCY_PROVIDER_TO_ISO: currencyProviderToIso,
  DATE_DDMMYYYY_TO_ISO: dateDdMmYyyyToIso,
  DATE_YYYYMMDD_TO_ISO: dateYyyyMmDdToIso,
  DECIMAL_TO_PROVIDER_DECIMAL: decimalToProviderDecimal,
  DECIMAL_TO_PROVIDER_IMPLICIT: decimalToProviderImplicit,
  CURRENCY_ISO_TO_PROVIDER_ALPHA: currencyIsoToProviderAlpha,
  CURRENCY_ISO_TO_PROVIDER_NUM: currencyIsoToProviderNum
};

export function applyTransformation(id: TransformationId, value: string): string {
  const fn = TRANSFORMATIONS[id] ?? TRANSFORMATIONS.NONE;
  return fn(value);
}

// =====================================================================
// Tabla de alias por campo canónico (ES + códigos ISO8583 + dominio)
// =====================================================================

export const CANONICAL_ALIASES: Record<string, string[]> = {
  'payerReference.referenceValue': [
    'referencia',
    'referenciapagador',
    'de2',
    'pan',
    'codigocliente',
    'nrocliente'
  ],
  'payer.name': ['nombre', 'titular', 'nombretitular', 'de43', 'razonsocial'],
  'obligations[].obligationId': [
    'idobligacion',
    'obligacion',
    'de37',
    'retrievalref',
    'nrodeuda',
    'iddeuda'
  ],
  'obligations[].dueDate': ['vencimiento', 'fechavencimiento', 'de13', 'fecha'],
  'obligations[].totalAmount': ['monto', 'importe', 'montototal', 'de4', 'valor'],
  'obligations[].currency': ['moneda', 'divisa', 'de49', 'codmoneda'],
  'obligations[].description': ['descripcion', 'concepto', 'glosa', 'detalle'],
  // --- PAGO (reutilizan por homónimo) ---
  obligationId: ['idobligacion', 'obligacion', 'de37', 'retrievalref', 'nrodeuda', 'iddeuda'],
  'paymentAmount.amount': ['monto', 'importe', 'montototal', 'de4', 'valor', 'montopago'],
  'paymentAmount.currency': ['moneda', 'divisa', 'de49', 'codmoneda'],
  hubTransactionId: ['transaccion', 'idtransaccion', 'trace', 'de11', 'hubtransactionid']
};

// =====================================================================
// Normalización + scoring determinístico
// =====================================================================

export function normalize(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function lastSegment(path: string): string {
  const clean = (path || '').replace(/\[\]/g, '');
  const seg = clean.split('.').pop() ?? clean;
  return normalize(seg);
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length];
}

function pairScore(a: string, b: string): number {
  if (!a && !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a && b && (a.includes(b) || b.includes(a))) {
    return 0.9;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 0;
  }
  return 1 - levenshtein(a, b) / maxLen;
}

function canonicalTerms(c: CanonicalField): string[] {
  const terms = new Set<string>();
  terms.add(lastSegment(c.path));
  for (const alias of CANONICAL_ALIASES[c.path] ?? []) {
    terms.add(normalize(alias));
  }
  terms.delete('');
  return [...terms];
}

function providerTerms(p: ProviderField): string[] {
  const terms = new Set<string>();
  terms.add(normalize(p.label));
  terms.add(lastSegment(p.path));
  terms.add(normalize(p.path));
  terms.delete('');
  return [...terms];
}

export function score(c: CanonicalField, p: ProviderField): number {
  const cTerms = canonicalTerms(c);
  const pTerms = providerTerms(p);
  let best = 0;
  for (const a of cTerms) {
    for (const b of pTerms) {
      const s = pairScore(a, b);
      if (s > best) {
        best = s;
      }
    }
  }
  return best;
}

export const AUTOSUGGEST_THRESHOLD = 0.6;

// Autosuggest greedy: un campo del proveedor no se asigna a dos canónicos.
// Se ordena por score descendente; empates por orden de aparición (canónico, luego proveedor).
export function autosuggestLinks(
  canonicalFields: CanonicalField[],
  providerFields: ProviderField[],
  protocol: Protocol,
  direction: TransformDirection = 'INPUT'
): FieldLink[] {
  interface Candidate {
    ci: number;
    pi: number;
    scoreValue: number;
  }
  const candidates: Candidate[] = [];
  canonicalFields.forEach((c, ci) => {
    providerFields.forEach((p, pi) => {
      const s = score(c, p);
      if (s >= AUTOSUGGEST_THRESHOLD) {
        candidates.push({ ci, pi, scoreValue: s });
      }
    });
  });

  candidates.sort((a, b) => {
    if (b.scoreValue !== a.scoreValue) {
      return b.scoreValue - a.scoreValue;
    }
    if (a.ci !== b.ci) {
      return a.ci - b.ci;
    }
    return a.pi - b.pi;
  });

  const usedCanonical = new Set<number>();
  const usedProvider = new Set<number>();
  const links: FieldLink[] = [];

  for (const cand of candidates) {
    if (usedCanonical.has(cand.ci) || usedProvider.has(cand.pi)) {
      continue;
    }
    usedCanonical.add(cand.ci);
    usedProvider.add(cand.pi);
    const c = canonicalFields[cand.ci];
    const p = providerFields[cand.pi];
    links.push({
      canonicalPath: c.path,
      providerPath: p.path,
      transformation: defaultTransformation(c.dataType, protocol, direction, p.sample)
    });
  }

  return links;
}

// =====================================================================
// Transformación por defecto por dataType + protocolo + dirección (§8)
// =====================================================================

export function defaultTransformation(
  dataType: CanonicalField['dataType'],
  protocol: Protocol,
  direction: TransformDirection,
  sample = ''
): TransformationId {
  switch (dataType) {
    case 'amount':
      if (protocol === 'ISO8583' || protocol === 'POSICIONAL' || protocol === 'BIAN_JSON') {
        return direction === 'INPUT' ? 'AMOUNT_IMPLICIT_TO_DECIMAL' : 'DECIMAL_TO_PROVIDER_IMPLICIT';
      }
      // REST_JSON / SOAP_XML
      return direction === 'INPUT' ? 'AMOUNT_FLOAT_TO_DECIMAL' : 'DECIMAL_TO_PROVIDER_DECIMAL';

    case 'currency':
      if (protocol === 'REST_JSON' || protocol === 'BIAN_JSON') {
        return 'NONE';
      }
      if (direction === 'INPUT') {
        return 'CURRENCY_PROVIDER_TO_ISO';
      }
      return protocol === 'ISO8583' ? 'CURRENCY_ISO_TO_PROVIDER_NUM' : 'CURRENCY_ISO_TO_PROVIDER_ALPHA';

    case 'date':
      if (direction === 'OUTPUT') {
        return 'NONE'; // no se envía fecha en el pago
      }
      return /^\d{8}$/.test((sample || '').trim())
        ? 'DATE_YYYYMMDD_TO_ISO'
        : 'DATE_DDMMYYYY_TO_ISO';

    case 'string':
    default:
      return 'NONE';
  }
}
