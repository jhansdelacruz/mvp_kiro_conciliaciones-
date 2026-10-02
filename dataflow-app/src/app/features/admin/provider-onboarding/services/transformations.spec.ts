import {
  applyTransformation,
  autosuggestLinks,
  defaultTransformation,
  normalize,
  score
} from './transformations';
import { parseSpec } from './spec-parsers';
import { getDemoPayload } from './demo-payloads';
import { CANONICAL_CONSULTA_FIELDS } from './onboarding.service';
import { Protocol } from '../models/onboarding.model';

const REQUIRED_CONSULTA = CANONICAL_CONSULTA_FIELDS.filter((f) => f.required).map((f) => f.path);

describe('transformations', () => {
  describe('transformaciones puras', () => {
    it('AMOUNT_IMPLICIT_TO_DECIMAL convierte implícito 12 díg a decimal', () => {
      expect(applyTransformation('AMOUNT_IMPLICIT_TO_DECIMAL', '000000012550')).toBe('125.50');
      expect(applyTransformation('AMOUNT_IMPLICIT_TO_DECIMAL', '000000000005')).toBe('0.05');
    });

    it('AMOUNT_FLOAT_TO_DECIMAL normaliza a dos decimales', () => {
      expect(applyTransformation('AMOUNT_FLOAT_TO_DECIMAL', '340.75')).toBe('340.75');
      expect(applyTransformation('AMOUNT_FLOAT_TO_DECIMAL', '130')).toBe('130.00');
    });

    it('DECIMAL_TO_PROVIDER_IMPLICIT y DECIMAL_TO_PROVIDER_DECIMAL', () => {
      expect(applyTransformation('DECIMAL_TO_PROVIDER_IMPLICIT', '125.50')).toBe('000000012550');
      expect(applyTransformation('DECIMAL_TO_PROVIDER_DECIMAL', '125.5')).toBe('125.50');
    });

    it('CURRENCY_PROVIDER_TO_ISO resuelve numéricos y alfa', () => {
      expect(applyTransformation('CURRENCY_PROVIDER_TO_ISO', '604')).toBe('PEN');
      expect(applyTransformation('CURRENCY_PROVIDER_TO_ISO', '840')).toBe('USD');
      expect(applyTransformation('CURRENCY_PROVIDER_TO_ISO', 'SOL')).toBe('PEN');
      expect(applyTransformation('CURRENCY_PROVIDER_TO_ISO', 'DOL')).toBe('USD');
    });

    it('CURRENCY_ISO_TO_PROVIDER_ALPHA y _NUM', () => {
      expect(applyTransformation('CURRENCY_ISO_TO_PROVIDER_ALPHA', 'PEN')).toBe('SOL');
      expect(applyTransformation('CURRENCY_ISO_TO_PROVIDER_NUM', 'PEN')).toBe('604');
      expect(applyTransformation('CURRENCY_ISO_TO_PROVIDER_NUM', 'USD')).toBe('840');
    });

    it('fechas dd/MM/yyyy y yyyyMMdd a ISO 8601', () => {
      expect(applyTransformation('DATE_DDMMYYYY_TO_ISO', '31/12/2025')).toBe('2025-12-31');
      expect(applyTransformation('DATE_YYYYMMDD_TO_ISO', '20251231')).toBe('2025-12-31');
    });

    it('NONE deja el valor intacto', () => {
      expect(applyTransformation('NONE', 'PEN')).toBe('PEN');
    });
  });

  describe('normalize y score', () => {
    it('normalize quita acentos, mayúsculas y símbolos', () => {
      expect(normalize('Fecha-Vencimiento')).toBe('fechavencimiento');
      expect(normalize('Descripción')).toBe('descripcion');
    });

    it('score usa la tabla de alias (Titular -> payer.name)', () => {
      const payerName = CANONICAL_CONSULTA_FIELDS.find((f) => f.path === 'payer.name')!;
      const s = score(payerName, { path: 'Titular', label: 'Titular', sample: 'Ana' });
      expect(s).toBe(1);
    });
  });

  describe('defaultTransformation', () => {
    it('monto implícito en ISO8583/POSICIONAL/BIAN; float en REST/SOAP', () => {
      expect(defaultTransformation('amount', 'ISO8583', 'INPUT')).toBe('AMOUNT_IMPLICIT_TO_DECIMAL');
      expect(defaultTransformation('amount', 'REST_JSON', 'INPUT')).toBe('AMOUNT_FLOAT_TO_DECIMAL');
      expect(defaultTransformation('amount', 'ISO8583', 'OUTPUT')).toBe('DECIMAL_TO_PROVIDER_IMPLICIT');
    });

    it('moneda: ISO salida numérica, SOAP/POSICIONAL alfa, REST/BIAN NONE', () => {
      expect(defaultTransformation('currency', 'ISO8583', 'OUTPUT')).toBe('CURRENCY_ISO_TO_PROVIDER_NUM');
      expect(defaultTransformation('currency', 'POSICIONAL', 'OUTPUT')).toBe('CURRENCY_ISO_TO_PROVIDER_ALPHA');
      expect(defaultTransformation('currency', 'REST_JSON', 'INPUT')).toBe('NONE');
    });

    it('fecha autodetecta el formato por el sample', () => {
      expect(defaultTransformation('date', 'REST_JSON', 'INPUT', '31/12/2025')).toBe('DATE_DDMMYYYY_TO_ISO');
      expect(defaultTransformation('date', 'BIAN_JSON', 'INPUT', '20251231')).toBe('DATE_YYYYMMDD_TO_ISO');
    });
  });

  describe('autosuggest por protocolo', () => {
    const protocols: Protocol[] = ['REST_JSON', 'BIAN_JSON', 'SOAP_XML', 'ISO8583', 'POSICIONAL'];

    protocols.forEach((protocol) => {
      it(`enlaza los 5 campos obligatorios de consulta en ${protocol}`, () => {
        const parsed = parseSpec(protocol, getDemoPayload(protocol));
        const links = autosuggestLinks(CANONICAL_CONSULTA_FIELDS, parsed.fields, protocol, 'INPUT');
        const linkedPaths = links.map((l) => l.canonicalPath);
        REQUIRED_CONSULTA.forEach((required) => {
          expect(linkedPaths).withContext(`${protocol} debe enlazar ${required}`).toContain(required);
        });
      });
    });
  });
});
