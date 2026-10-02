import { parseSpec } from './spec-parsers';
import { getDemoPayload } from './demo-payloads';

describe('spec-parsers', () => {
  describe('REST_JSON', () => {
    it('aplana un JSON de ejemplo y detecta obligaciones', () => {
      const result = parseSpec('REST_JSON', getDemoPayload('REST_JSON'));
      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.meta.obligationCount).toBe(3);
      expect(result.fields.some((f) => f.path === 'obligaciones[].monto')).toBeTrue();
      expect(result.normalizedSample['obligaciones[0].monto']).toBe('125.5');
      expect(result.normalizedSample['referenciaPagador']).toBe('0012345678');
    });

    it('usa el nodo example de un fragmento OpenAPI', () => {
      const spec = JSON.stringify({ example: { referencia: '123', monto: 10 } });
      const result = parseSpec('REST_JSON', spec);
      expect(result.fields.some((f) => f.path === 'referencia')).toBeTrue();
    });

    it('ante JSON malformado devuelve fields vacío y warnings', () => {
      const result = parseSpec('REST_JSON', '{ no es json ');
      expect(result.fields).toEqual([]);
      expect(result.meta.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('BIAN_JSON', () => {
    it('preserva PascalCase y detecta la lista de obligaciones', () => {
      const result = parseSpec('BIAN_JSON', getDemoPayload('BIAN_JSON'));
      expect(result.meta.obligationCount).toBe(2);
      expect(result.fields.some((f) => f.path === 'PaymentOrder.ObligationList[].ObligationId')).toBeTrue();
      expect(result.fields.some((f) => f.path === 'PaymentOrder.PayerReference.ReferenceValue')).toBeTrue();
    });
  });

  describe('SOAP_XML', () => {
    it('recorre el XML de ejemplo y colapsa elementos repetidos', () => {
      const result = parseSpec('SOAP_XML', getDemoPayload('SOAP_XML'));
      expect(result.meta.obligationCount).toBe(3);
      expect(result.fields.some((f) => f.path.endsWith('Obligacion[].IdObligacion'))).toBeTrue();
      expect(result.fields.some((f) => f.path.endsWith('Titular'))).toBeTrue();
    });

    it('extrae nombres de xs:element en modo WSDL/XSD', () => {
      const wsdl = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="IdObligacion"/><xs:element name="Monto"/></xs:schema>`;
      const result = parseSpec('SOAP_XML', wsdl);
      expect(result.fields.map((f) => f.path)).toContain('IdObligacion');
      expect(result.fields.map((f) => f.path)).toContain('Monto');
    });

    it('ante XML malformado reporta parsererror en warnings', () => {
      const result = parseSpec('SOAP_XML', '<a><b></a>');
      expect(result.fields).toEqual([]);
      expect(result.meta.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('ISO8583', () => {
    it('parsea la tabla DE | nombre | ejemplo', () => {
      const result = parseSpec('ISO8583', getDemoPayload('ISO8583'));
      expect(result.meta.obligationCount).toBe(1);
      expect(result.fields.map((f) => f.path)).toContain('DE43');
      expect(result.normalizedSample['DE4']).toBe('000000045900');
    });

    it('ante tabla sin filas válidas devuelve warnings', () => {
      const result = parseSpec('ISO8583', 'sin filas válidas aquí');
      expect(result.fields).toEqual([]);
      expect(result.meta.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('POSICIONAL', () => {
    it('parsea el layout y distingue cabecera de detalle', () => {
      const result = parseSpec('POSICIONAL', getDemoPayload('POSICIONAL'));
      expect(result.meta.obligationCount).toBe(1);
      expect(result.fields.some((f) => f.path === 'pos:H:1-2')).toBeTrue();
      expect(result.fields.some((f) => f.path === 'pos:3-32')).toBeTrue();
      expect(result.normalizedSample['pos:3-32']).toBe('PEDRO SUAREZ');
    });

    it('ante layout sin rangos numéricos devuelve warnings', () => {
      const result = parseSpec('POSICIONAL', '| x | y | z |');
      expect(result.fields).toEqual([]);
      expect(result.meta.warnings.length).toBeGreaterThan(0);
    });
  });
});
