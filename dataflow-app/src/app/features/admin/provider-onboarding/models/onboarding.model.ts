// Modelo de datos del wizard de alta de proveedores (simulación frontend).
// Todas las interfaces/enums usadas por los pasos, servicios y parsers.

export type Protocol = 'REST_JSON' | 'BIAN_JSON' | 'SOAP_XML' | 'ISO8583' | 'POSICIONAL';

// NOTA (LOW-4): en esta versión solo CONSULTA (SRV-01) y PAGO (SRV-02) tienen
// mapeo (Paso 3) y prueba (Paso 5). ESTADO y EXTORNO se capturan como METADATOS
// del proveedor (se persisten en ProviderData.operations) pero NO tienen match
// ni ejecución de prueba; la UI no debe sugerir lo contrario.
export type ProviderOperation = 'CONSULTA' | 'PAGO' | 'ESTADO' | 'EXTORNO';

export type SecurityType = 'NINGUNA' | 'API_KEY' | 'OAUTH2' | 'MTLS' | 'HMAC';

// Los dos sub-tabs del paso 3 (dos conjuntos de enlaces independientes).
export type MappingKind = 'CONSULTA' | 'PAGO';

export type ProviderStatus = 'BORRADOR' | 'ACTIVO';

export type ProviderOrigin = 'ESTATICO' | 'DINAMICO';

// --- Paso 1 ---
export interface ClientReferenceRule {
  type: 'NUMERICO'; // fijo en esta versión
  minLength: number; // default 5
  maxLength: number; // default 10
  pattern: string; // regex derivada, p. ej. ^\d{5,10}$
}

export interface ProviderData {
  providerId: string; // autogenerado: prov-<timestamp>
  name: string;
  rubro: string;
  protocol: Protocol;
  securityType: SecurityType;
  clientReference: ClientReferenceRule;
  currencies: string[]; // ISO 4217, multi-select: ['PEN','USD',...]
  operations: ProviderOperation[];
  timeoutMs: number; // default 8000
}

// --- Paso 2 ---
export interface ProviderField {
  path: string; // 'a.b[].c' | 'DEnn' | 'pos:ini-fin' | 'pos:H:ini-fin'
  label: string; // etiqueta legible derivada del path
  sample: string; // valor de ejemplo (string)
}

export interface ParseResult {
  // detección: 1 fila por campo lógico (arrays colapsados a `[]`)
  fields: ProviderField[];
  meta: {
    protocol: Protocol;
    detectedCount: number;
    obligationCount: number;
    warnings: string[];
  };
  // EJECUCIÓN: paths con índice concreto (obligations[0].x, obligations[1].x, ...)
  normalizedSample: Record<string, string>;
}

// --- Paso 3 ---
export type TransformationId =
  // entrada (consulta)
  | 'NONE'
  | 'AMOUNT_FLOAT_TO_DECIMAL'
  | 'AMOUNT_IMPLICIT_TO_DECIMAL' // 12 díg, 2 decimales
  | 'CURRENCY_PROVIDER_TO_ISO'
  | 'DATE_DDMMYYYY_TO_ISO'
  | 'DATE_YYYYMMDD_TO_ISO'
  // salida (pago)
  | 'DECIMAL_TO_PROVIDER_DECIMAL'
  | 'DECIMAL_TO_PROVIDER_IMPLICIT'
  | 'CURRENCY_ISO_TO_PROVIDER_ALPHA' // SOL/DOL
  | 'CURRENCY_ISO_TO_PROVIDER_NUM'; // 604/840

export interface FieldLink {
  canonicalPath: string; // id del campo canónico
  providerPath: string; // path del campo del proveedor
  transformation: TransformationId;
}

export interface CanonicalField {
  path: string; // 'obligations[].totalAmount', ...
  label: string; // etiqueta ES
  required: boolean; // obligatorio para avanzar (solo CONSULTA)
  group: MappingKind;
  dataType: 'string' | 'amount' | 'currency' | 'date'; // guía autosuggest
}

// --- Paso 4 ---
export type HubCode =
  | '00'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '20'
  | '21'
  | '30'
  | '90'
  | '91'
  | '96'
  | '99';

export interface HubCodeDef {
  code: HubCode;
  label: string;
}

export interface CodeMapEntry {
  providerCode: string;
  providerLabel: string;
  hubCode: HubCode; // uno del catálogo
  isDefault: boolean; // prefijado por el adaptador genérico
}

// --- Paso 5 (resultado de prueba) ---
export interface CanonicalObligation {
  obligationId: string;
  dueDate: string; // ISO 8601
  totalAmount: string; // decimal exacto como string
  currency: string; // ISO 4217
  description: string;
}

// FIX-5: el estado del adaptador se homologa a un HubCode con el mapeo fijo
// OK -> '00', NO_DEBT -> '13' (obligación no encontrada), ERROR -> '99'.
export interface TestConsultaResult {
  status: 'OK' | 'NO_DEBT' | 'ERROR';
  payerNameMasked: string;
  obligations: CanonicalObligation[];
  homologatedCode: HubCode; // OK->00, NO_DEBT->13, ERROR->99 (o el codeMap)
  correlationId: string;
  trace: TraceEntry[];
}

// FIX-5: OK -> '00', ERROR -> '99' (salvo validaciones específicas: 30 moneda, 12 monto).
export interface TestPagoResult {
  status: 'OK' | 'ERROR';
  builtProviderRequest: Record<string, string>; // request que el Hub construyó
  homologatedCode: HubCode; // OK->00, ERROR->99 (o 12/30 según validación)
  receipt?: { reference: string; amount: string; currency: string; timestamp: string };
  correlationId: string;
  trace: TraceEntry[];
}

export interface TraceEntry {
  step: string; // 'REQUEST_PROVEEDOR' | 'RESPUESTA' | 'NORMALIZACION' | ...
  detail: string;
  timestamp: string;
}

// --- Config persistida ---
export interface ProviderConfig {
  data: ProviderData;
  mapping: FieldLink[]; // consulta
  paymentMapping: FieldLink[]; // pago
  codeMap: CodeMapEntry[];
  sampleResponse: Record<string, string>; // normalizedSample
  rawSpec: string; // lo que pegó el operador (para reabrir/re-parsear)
  status: ProviderStatus;
  origin: ProviderOrigin;
  createdAt: string;
  updatedAt?: string;
}

// FIX-4: resumen ligero para el catálogo (estáticos + dinámicos).
export interface ProviderSummary {
  providerId: string;
  name: string;
  protocol: Protocol;
  origin: ProviderOrigin;
  status: ProviderStatus;
}
