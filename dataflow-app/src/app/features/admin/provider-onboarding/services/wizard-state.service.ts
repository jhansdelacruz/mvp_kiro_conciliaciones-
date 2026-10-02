// Estado reactivo compartido del wizard (signals). Se provee a nivel del
// contenedor ProviderWizardComponent (NO en root), de modo que su ciclo de vida
// coincida con el del wizard (design.md §4).

import { Injectable, computed, signal } from '@angular/core';
import {
  CanonicalField,
  CodeMapEntry,
  FieldLink,
  HubCodeDef,
  ParseResult,
  ProviderConfig,
  ProviderData,
  TestConsultaResult,
  TestPagoResult
} from '../models/onboarding.model';
import { parseSpec } from './spec-parsers';

// FIX-1 (opción b): validación de contenido del Paso 1, sin step1Form.
export function isProviderDataValid(data: ProviderData | null): boolean {
  if (!data) {
    return false;
  }
  const nonEmpty = (v: string) => !!v && v.trim().length > 0;
  return (
    nonEmpty(data.name) &&
    nonEmpty(data.rubro) &&
    nonEmpty(data.protocol) &&
    nonEmpty(data.securityType) &&
    data.currencies.length >= 1 &&
    data.operations.includes('CONSULTA') &&
    data.timeoutMs >= 1000 &&
    data.timeoutMs <= 60000 &&
    data.clientReference.minLength <= data.clientReference.maxLength
  );
}

const PAGO_REQUIRED_PATHS = ['obligationId', 'paymentAmount.amount', 'paymentAmount.currency'];

@Injectable()
export class WizardStateService {
  // Catálogos (cargados por el contenedor al init)
  canonicalFields = signal<CanonicalField[]>([]);
  paymentFields = signal<CanonicalField[]>([]);
  hubCodes = signal<HubCodeDef[]>([]);

  // Paso 1
  providerData = signal<ProviderData | null>(null);

  // Paso 2
  rawSpec = signal<string>('');
  parseResult = signal<ParseResult | null>(null);
  fieldsConfirmed = signal<boolean>(false); // gate de confirmación manual

  // Paso 3 (dos conjuntos independientes)
  consultaLinks = signal<FieldLink[]>([]);
  pagoLinks = signal<FieldLink[]>([]);

  // Paso 4
  codeMap = signal<CodeMapEntry[]>([]);

  // Paso 5
  consultaTest = signal<TestConsultaResult | null>(null);
  pagoTest = signal<TestPagoResult | null>(null);

  // Modo
  mode = signal<'NEW' | 'EDIT'>('NEW');
  providerId = signal<string | null>(null);

  // --- Validez por paso (computed) ---

  // FIX-1 (opción b): valida el CONTENIDO de providerData, no un FormGroup.
  step1Valid = computed(() => isProviderDataValid(this.providerData()));

  step2Valid = computed(() => this.parseResult() !== null && this.fieldsConfirmed());

  // Regla única (design.md §7.3): required de CONSULTA enlazados y, SOLO si PAGO
  // fue marcada en el Paso 1, los 3 campos obligatorios de PAGO enlazados.
  step3Valid = computed(() => {
    const req = this.canonicalFields()
      .filter((f) => f.required)
      .map((f) => f.path);
    const consultaOk = req.every((p) => this.consultaLinks().some((l) => l.canonicalPath === p));
    const ops = this.providerData()?.operations ?? [];
    if (!ops.includes('PAGO')) {
      return consultaOk;
    }
    const pagoOk = PAGO_REQUIRED_PATHS.every((p) =>
      this.pagoLinks().some((l) => l.canonicalPath === p)
    );
    return consultaOk && pagoOk;
  });

  // Sin mapear => 99 por defecto, siempre válido pero con alerta.
  step4Valid = computed(() => this.codeMap().every((e) => !!e.hubCode));

  step5Valid = computed(() => (this.consultaTest()?.obligations.length ?? 0) > 0);

  reset(): void {
    this.providerData.set(null);
    this.rawSpec.set('');
    this.parseResult.set(null);
    this.fieldsConfirmed.set(false);
    this.consultaLinks.set([]);
    this.pagoLinks.set([]);
    this.codeMap.set([]);
    this.consultaTest.set(null);
    this.pagoTest.set(null);
    this.mode.set('NEW');
    this.providerId.set(null);
  }

  toConfig(): ProviderConfig {
    const data = this.providerData();
    if (!data) {
      throw new Error('No hay datos de proveedor para ensamblar la configuración.');
    }
    return {
      data,
      mapping: this.consultaLinks(),
      paymentMapping: this.pagoLinks(),
      codeMap: this.codeMap(),
      sampleResponse: this.parseResult()?.normalizedSample ?? {},
      rawSpec: this.rawSpec(),
      status: 'BORRADOR',
      origin: 'DINAMICO',
      createdAt: new Date().toISOString()
    };
  }

  // FIX-3: re-parsea rawSpec para regenerar parseResult.fields/meta antes de
  // poblar el resto de los signals y pasar a modo EDIT.
  loadConfig(c: ProviderConfig): void {
    const parsed = parseSpec(c.data.protocol, c.rawSpec);
    this.parseResult.set(parsed);
    this.providerData.set(c.data);
    this.rawSpec.set(c.rawSpec);
    this.fieldsConfirmed.set(true);
    this.consultaLinks.set(c.mapping);
    this.pagoLinks.set(c.paymentMapping);
    this.codeMap.set(c.codeMap);
    this.consultaTest.set(null);
    this.pagoTest.set(null);
    this.providerId.set(c.data.providerId);
    this.mode.set('EDIT');
  }
}
