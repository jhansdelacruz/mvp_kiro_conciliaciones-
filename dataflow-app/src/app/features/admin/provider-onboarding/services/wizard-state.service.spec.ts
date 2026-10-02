import { WizardStateService } from './wizard-state.service';
import { CANONICAL_CONSULTA_FIELDS } from './onboarding.service';
import { getDemoPayload } from './demo-payloads';
import {
  CodeMapEntry,
  FieldLink,
  ProviderConfig,
  ProviderData,
  TestConsultaResult
} from '../models/onboarding.model';

function validProviderData(): ProviderData {
  return {
    providerId: 'prov-123',
    name: 'Proveedor Demo',
    rubro: 'Servicios',
    protocol: 'REST_JSON',
    securityType: 'API_KEY',
    clientReference: { type: 'NUMERICO', minLength: 5, maxLength: 10, pattern: '^\\d{5,10}$' },
    currencies: ['PEN'],
    operations: ['CONSULTA'],
    timeoutMs: 8000
  };
}

function consultaLinksForAllRequired(): FieldLink[] {
  return CANONICAL_CONSULTA_FIELDS.filter((f) => f.required).map((f) => ({
    canonicalPath: f.path,
    providerPath: `prov.${f.path}`,
    transformation: 'NONE' as const
  }));
}

describe('WizardStateService', () => {
  let svc: WizardStateService;

  beforeEach(() => {
    svc = new WizardStateService();
  });

  describe('step1Valid', () => {
    it('false sin datos; true con datos válidos; false con timeout fuera de rango', () => {
      expect(svc.step1Valid()).toBeFalse();
      svc.providerData.set(validProviderData());
      expect(svc.step1Valid()).toBeTrue();
      svc.providerData.set({ ...validProviderData(), timeoutMs: 500 });
      expect(svc.step1Valid()).toBeFalse();
    });

    it('false si no incluye la operación CONSULTA', () => {
      svc.providerData.set({ ...validProviderData(), operations: ['PAGO'] });
      expect(svc.step1Valid()).toBeFalse();
    });
  });

  describe('step2Valid', () => {
    it('requiere parseResult y confirmación manual', () => {
      expect(svc.step2Valid()).toBeFalse();
      svc.parseResult.set({
        fields: [{ path: 'a', label: 'A', sample: '1' }],
        meta: { protocol: 'REST_JSON', detectedCount: 1, obligationCount: 1, warnings: [] },
        normalizedSample: { a: '1' }
      });
      expect(svc.step2Valid()).toBeFalse();
      svc.fieldsConfirmed.set(true);
      expect(svc.step2Valid()).toBeTrue();
    });
  });

  describe('step3Valid', () => {
    it('true con required de consulta enlazados y sin PAGO', () => {
      svc.canonicalFields.set(CANONICAL_CONSULTA_FIELDS);
      svc.providerData.set(validProviderData());
      expect(svc.step3Valid()).toBeFalse();
      svc.consultaLinks.set(consultaLinksForAllRequired());
      expect(svc.step3Valid()).toBeTrue();
    });

    it('exige los campos de PAGO cuando la operación PAGO está marcada', () => {
      svc.canonicalFields.set(CANONICAL_CONSULTA_FIELDS);
      svc.providerData.set({ ...validProviderData(), operations: ['CONSULTA', 'PAGO'] });
      svc.consultaLinks.set(consultaLinksForAllRequired());
      expect(svc.step3Valid()).toBeFalse();
      svc.pagoLinks.set([
        { canonicalPath: 'obligationId', providerPath: 'p.id', transformation: 'NONE' },
        { canonicalPath: 'paymentAmount.amount', providerPath: 'p.monto', transformation: 'NONE' },
        { canonicalPath: 'paymentAmount.currency', providerPath: 'p.moneda', transformation: 'NONE' }
      ]);
      expect(svc.step3Valid()).toBeTrue();
    });
  });

  describe('step4Valid', () => {
    it('true con codeMap vacío o con hubCode; false si falta hubCode', () => {
      expect(svc.step4Valid()).toBeTrue();
      const entry: CodeMapEntry = { providerCode: 'OK', providerLabel: 'Éxito', hubCode: '00', isDefault: true };
      svc.codeMap.set([entry]);
      expect(svc.step4Valid()).toBeTrue();
      svc.codeMap.set([{ ...entry, hubCode: '' as unknown as CodeMapEntry['hubCode'] }]);
      expect(svc.step4Valid()).toBeFalse();
    });
  });

  describe('step5Valid', () => {
    it('true solo cuando la consulta devuelve obligaciones', () => {
      expect(svc.step5Valid()).toBeFalse();
      const result: TestConsultaResult = {
        status: 'OK',
        payerNameMasked: 'J***',
        obligations: [
          { obligationId: 'O1', dueDate: '2025-01-01', totalAmount: '10.00', currency: 'PEN', description: '' }
        ],
        homologatedCode: '00',
        correlationId: 'hub-abc',
        trace: []
      };
      svc.consultaTest.set(result);
      expect(svc.step5Valid()).toBeTrue();
    });
  });

  describe('loadConfig (FIX-3)', () => {
    it('re-parsea rawSpec y repuebla parseResult.fields; pasa a modo EDIT', () => {
      const config: ProviderConfig = {
        data: validProviderData(),
        mapping: consultaLinksForAllRequired(),
        paymentMapping: [],
        codeMap: [],
        sampleResponse: {},
        rawSpec: getDemoPayload('REST_JSON'),
        status: 'ACTIVO',
        origin: 'DINAMICO',
        createdAt: new Date().toISOString()
      };
      svc.loadConfig(config);
      expect(svc.parseResult()?.fields.length).toBeGreaterThan(0);
      expect(svc.mode()).toBe('EDIT');
      expect(svc.providerId()).toBe('prov-123');
      expect(svc.fieldsConfirmed()).toBeTrue();
    });
  });
});
