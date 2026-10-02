// Servicio simulado del wizard de alta de proveedores ("endpoints" en memoria).
// Reutiliza el patrón mock del proyecto (ApiService) pero con delay aleatorio
// 300-600 ms. Como environment.useMock es true, NINGUNA rama hace HTTP real;
// se deja la rama `environment.useMock` por consistencia con los demás servicios,
// con la rama real marcada TODO backend (nunca ejecutada en esta fase).

import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError, timer } from 'rxjs';
import { delay, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../../core/services/api.service';
import { environment } from '../../../../../environments/environment';
import {
  CanonicalField,
  CanonicalObligation,
  HubCode,
  HubCodeDef,
  ProviderConfig,
  ProviderSummary,
  TestConsultaResult,
  TestPagoResult,
  TraceEntry
} from '../models/onboarding.model';
import { parseSpec } from './spec-parsers';
import { applyTransformation } from './transformations';

// =====================================================================
// Catálogos canónicos (constantes del servicio, design.md §5.1)
// =====================================================================

export const CANONICAL_CONSULTA_FIELDS: CanonicalField[] = [
  { path: 'payerReference.referenceValue', label: 'Referencia del pagador', required: true, group: 'CONSULTA', dataType: 'string' },
  { path: 'payer.name', label: 'Nombre del titular', required: true, group: 'CONSULTA', dataType: 'string' },
  { path: 'obligations[].obligationId', label: 'ID de obligación', required: true, group: 'CONSULTA', dataType: 'string' },
  { path: 'obligations[].dueDate', label: 'Fecha de vencimiento', required: false, group: 'CONSULTA', dataType: 'date' },
  { path: 'obligations[].totalAmount', label: 'Monto total', required: true, group: 'CONSULTA', dataType: 'amount' },
  { path: 'obligations[].currency', label: 'Moneda', required: true, group: 'CONSULTA', dataType: 'currency' },
  { path: 'obligations[].description', label: 'Descripción', required: false, group: 'CONSULTA', dataType: 'string' }
];

export const CANONICAL_PAGO_FIELDS: CanonicalField[] = [
  { path: 'payerReference.referenceValue', label: 'Referencia del pagador', required: false, group: 'PAGO', dataType: 'string' },
  { path: 'obligationId', label: 'ID de obligación', required: false, group: 'PAGO', dataType: 'string' },
  { path: 'paymentAmount.amount', label: 'Monto a pagar', required: false, group: 'PAGO', dataType: 'amount' },
  { path: 'paymentAmount.currency', label: 'Moneda del pago', required: false, group: 'PAGO', dataType: 'currency' },
  { path: 'hubTransactionId', label: 'ID de transacción del Hub', required: false, group: 'PAGO', dataType: 'string' }
];

export const HUB_CODES: HubCodeDef[] = [
  { code: '00', label: 'Éxito' },
  { code: '10', label: 'Rechazo genérico' },
  { code: '11', label: 'Referencia inválida' },
  { code: '12', label: 'Monto inválido / no coincide' },
  { code: '13', label: 'Obligación no encontrada' },
  { code: '14', label: 'Obligación ya pagada' },
  { code: '15', label: 'Obligación vencida' },
  { code: '20', label: 'Proveedor no disponible' },
  { code: '21', label: 'Timeout del proveedor' },
  { code: '30', label: 'Moneda no soportada' },
  { code: '90', label: 'Error de formato' },
  { code: '91', label: 'Error de seguridad / autenticación' },
  { code: '96', label: 'Error interno del proveedor' },
  { code: '99', label: 'Error no clasificado' }
];

// Semilla de proveedores de referencia estáticos (para el catálogo combinado).
const STATIC_PROVIDERS: ProviderSummary[] = [
  { providerId: 'ref-banco-nacion', name: 'Banco de la Nación', protocol: 'REST_JSON', origin: 'ESTATICO', status: 'ACTIVO' },
  { providerId: 'ref-sunat', name: 'SUNAT', protocol: 'SOAP_XML', origin: 'ESTATICO', status: 'ACTIVO' },
  { providerId: 'ref-sedapal', name: 'Sedapal', protocol: 'POSICIONAL', origin: 'ESTATICO', status: 'ACTIVO' }
];

function randomDelay(): number {
  return 300 + Math.random() * 300;
}

function shortId(): string {
  return Math.random().toString(16).slice(2, 10);
}

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private api = inject(ApiService);

  // Almacén en memoria de proveedores dinámicos (persiste durante la sesión).
  private dynamicProviders: ProviderConfig[] = [];

  private mock<T>(data: T): Observable<T> {
    return of(data).pipe(delay(randomDelay()));
  }

  private mockError<T>(message: string): Observable<T> {
    return timer(randomDelay()).pipe(switchMap(() => throwError(() => new Error(message))));
  }

  getCanonicalFields(): Observable<CanonicalField[]> {
    if (environment.useMock) {
      return this.mock(CANONICAL_CONSULTA_FIELDS.map((f) => ({ ...f })));
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.get<CanonicalField[]>('/api/onboarding/canonical-fields');
  }

  getPaymentFields(): Observable<CanonicalField[]> {
    if (environment.useMock) {
      return this.mock(CANONICAL_PAGO_FIELDS.map((f) => ({ ...f })));
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.get<CanonicalField[]>('/api/onboarding/payment-fields');
  }

  getHubCodes(): Observable<HubCodeDef[]> {
    if (environment.useMock) {
      return this.mock(HUB_CODES.map((c) => ({ ...c })));
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.get<HubCodeDef[]>('/api/onboarding/hub-codes');
  }

  parseSpec(input: { protocol: ProviderConfig['data']['protocol']; spec: string }): Observable<ReturnType<typeof parseSpec>> {
    if (environment.useMock) {
      const trimmed = (input.spec ?? '').trim();
      if (!trimmed) {
        return this.mockError('Debe pegar el estándar o un ejemplo antes de analizar.');
      }
      const result = parseSpec(input.protocol, input.spec);
      if (result.fields.length === 0) {
        const msg = result.meta.warnings[0] ?? 'No se pudo analizar el estándar pegado.';
        return this.mockError(msg);
      }
      return this.mock(result);
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.post('/api/onboarding/parse-spec', input);
  }

  saveProvider(config: ProviderConfig): Observable<ProviderConfig> {
    if (environment.useMock) {
      const now = new Date().toISOString();
      const providerId = config.data.providerId || `prov-${Date.now()}`;
      const saved: ProviderConfig = {
        ...config,
        data: { ...config.data, providerId },
        status: 'ACTIVO',
        origin: 'DINAMICO',
        createdAt: config.createdAt || now,
        updatedAt: now
      };
      const index = this.dynamicProviders.findIndex((p) => p.data.providerId === providerId);
      if (index >= 0) {
        this.dynamicProviders[index] = saved;
      } else {
        this.dynamicProviders.push(saved);
      }
      return this.mock(saved);
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.post<ProviderConfig>('/api/onboarding/providers', config);
  }

  // FIX-4: devuelve resúmenes (ProviderSummary), no configs completas.
  listProviders(): Observable<{ estaticos: ProviderSummary[]; dinamicos: ProviderSummary[] }> {
    if (environment.useMock) {
      const dinamicos: ProviderSummary[] = this.dynamicProviders.map((p) => ({
        providerId: p.data.providerId,
        name: p.data.name,
        protocol: p.data.protocol,
        origin: 'DINAMICO',
        status: p.status
      }));
      return this.mock({ estaticos: STATIC_PROVIDERS.map((s) => ({ ...s })), dinamicos });
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.get<{ estaticos: ProviderSummary[]; dinamicos: ProviderSummary[] }>('/api/onboarding/providers');
  }

  getProvider(id: string): Observable<ProviderConfig> {
    if (environment.useMock) {
      const found = this.dynamicProviders.find((p) => p.data.providerId === id);
      if (!found) {
        return this.mockError(`No se encontró el proveedor con id "${id}".`);
      }
      return this.mock(found);
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.get<ProviderConfig>(`/api/onboarding/providers/${id}`);
  }

  deleteProvider(id: string): Observable<void> {
    if (environment.useMock) {
      this.dynamicProviders = this.dynamicProviders.filter((p) => p.data.providerId !== id);
      return this.mock(undefined as unknown as void);
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.delete<void>(`/api/onboarding/providers/${id}`);
  }

  runTestConsulta(config: ProviderConfig): Observable<TestConsultaResult> {
    if (environment.useMock) {
      return this.mock(this.executeConsulta(config));
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.post<TestConsultaResult>('/api/onboarding/test-consulta', config);
  }

  runTestPago(config: ProviderConfig, obligation: CanonicalObligation): Observable<TestPagoResult> {
    if (environment.useMock) {
      return this.mock(this.executePago(config, obligation));
    }
    // TODO backend (nunca ejecutado en esta fase)
    return this.api.post<TestPagoResult>('/api/onboarding/test-pago', { config, obligation });
  }

  // =====================================================================
  // Adaptador genérico determinístico (design.md §5.2)
  // =====================================================================

  private obligationCountOf(config: ProviderConfig): number {
    try {
      return parseSpec(config.data.protocol, config.rawSpec).meta.obligationCount;
    } catch {
      return 0;
    }
  }

  private readScalarCanonical(config: ProviderConfig, canonicalPath: string): string {
    const link = config.mapping.find((l) => l.canonicalPath === canonicalPath);
    if (!link) {
      return '';
    }
    const raw = config.sampleResponse[link.providerPath] ?? '';
    return applyTransformation(link.transformation, raw);
  }

  private maskName(name: string): string {
    if (!name) {
      return '';
    }
    return name
      .split(/\s+/)
      .map((word) => (word.length <= 1 ? word : word.charAt(0) + '*'.repeat(word.length - 1)))
      .join(' ');
  }

  private executeConsulta(config: ProviderConfig): TestConsultaResult {
    const correlationId = `hub-${shortId()}`;
    const trace: TraceEntry[] = [];
    const stamp = (step: string, detail: string) =>
      trace.push({ step, detail, timestamp: new Date().toISOString() });

    stamp('REQUEST_PROVEEDOR', `Consulta construida para el protocolo ${config.data.protocol}.`);
    stamp('RESPUESTA', 'Respuesta nativa del proveedor recibida (ejemplo normalizado).');

    const payerNameRaw = this.readScalarCanonical(config, 'payer.name');
    const n = this.obligationCountOf(config);

    const listLinks = config.mapping.filter((l) => l.canonicalPath.startsWith('obligations[]'));
    const obligations: CanonicalObligation[] = [];

    for (let i = 0; i < n; i++) {
      const obligation: CanonicalObligation = {
        obligationId: '',
        dueDate: '',
        totalAmount: '',
        currency: '',
        description: ''
      };
      let hasData = false;
      for (const link of listLinks) {
        const resolvedPath = link.providerPath.replace('[]', `[${i}]`);
        const raw = config.sampleResponse[resolvedPath];
        if (raw === undefined) {
          continue;
        }
        hasData = true;
        const value = applyTransformation(link.transformation, raw);
        const field = link.canonicalPath.substring('obligations[].'.length);
        if (field in obligation) {
          (obligation as unknown as Record<string, string>)[field] = value;
        }
      }
      if (hasData) {
        obligations.push(obligation);
      }
    }

    stamp('NORMALIZACION', `Se normalizaron ${obligations.length} obligación(es) canónica(s).`);

    const status: TestConsultaResult['status'] = obligations.length > 0 ? 'OK' : 'NO_DEBT';
    const homologatedCode = this.homologateStatus(status);
    stamp('HOMOLOGACION', `Estado ${status} homologado al código Hub ${homologatedCode}.`);

    return {
      status,
      payerNameMasked: this.maskName(payerNameRaw),
      obligations,
      homologatedCode,
      correlationId,
      trace
    };
  }

  private executePago(config: ProviderConfig, obligation: CanonicalObligation): TestPagoResult {
    const correlationId = `hub-${shortId()}`;
    const trace: TraceEntry[] = [];
    const stamp = (step: string, detail: string) =>
      trace.push({ step, detail, timestamp: new Date().toISOString() });

    const hubTransactionId = `HUB-${Date.now()}`;
    const reference = this.readScalarCanonical(config, 'payerReference.referenceValue');

    // Valor canónico por cada campo de pago antes de la transformación de salida.
    const canonicalValueFor = (canonicalPath: string): string => {
      switch (canonicalPath) {
        case 'payerReference.referenceValue':
          return reference;
        case 'obligationId':
          return obligation.obligationId;
        case 'paymentAmount.amount':
          return obligation.totalAmount;
        case 'paymentAmount.currency':
          return obligation.currency;
        case 'hubTransactionId':
          return hubTransactionId;
        default:
          return '';
      }
    };

    const builtProviderRequest: Record<string, string> = {};
    for (const link of config.paymentMapping) {
      const canonicalValue = canonicalValueFor(link.canonicalPath);
      builtProviderRequest[link.providerPath] = applyTransformation(link.transformation, canonicalValue);
    }
    stamp('REQUEST_PAGO', 'Request de pago construido desde el paymentMapping.');

    // Validación de moneda soportada.
    if (obligation.currency && !config.data.currencies.includes(obligation.currency)) {
      stamp('VALIDACION', `Moneda ${obligation.currency} no soportada por el proveedor.`);
      return {
        status: 'ERROR',
        builtProviderRequest,
        homologatedCode: '30',
        correlationId,
        trace
      };
    }

    stamp('VALIDACION', 'Moneda soportada y monto coincidente con lo adeudado.');
    stamp('HOMOLOGACION', 'Pago aceptado, código Hub 00.');

    return {
      status: 'OK',
      builtProviderRequest,
      homologatedCode: '00',
      receipt: {
        reference,
        amount: obligation.totalAmount,
        currency: obligation.currency,
        timestamp: new Date().toISOString()
      },
      correlationId,
      trace
    };
  }

  // FIX-5: OK -> '00', NO_DEBT -> '13', ERROR -> '99'.
  private homologateStatus(status: 'OK' | 'NO_DEBT' | 'ERROR'): HubCode {
    switch (status) {
      case 'OK':
        return '00';
      case 'NO_DEBT':
        return '13';
      default:
        return '99';
    }
  }
}
