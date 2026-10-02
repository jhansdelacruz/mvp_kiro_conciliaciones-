// Payloads demo por protocolo, en español (design.md §6.2).
//
// Contrato duro: cada demo expone un campo del proveedor para cada uno de los 5
// campos canónicos obligatorios de CONSULTA (referencia, nombre del titular,
// id de obligación, monto y moneda) más una fecha de vencimiento. ISO8583 incluye
// DE43 (titular) y POSICIONAL incluye un campo NOMBRE (pos:3-32).
// REST/BIAN/SOAP traen 2-3 obligaciones; ISO/POSICIONAL una sola.

import { Protocol } from '../models/onboarding.model';

const REST_JSON_DEMO = `{
  "referenciaPagador": "0012345678",
  "pagador": {
    "nombre": "Juan García Pérez",
    "documento": "DNI 45218796"
  },
  "obligaciones": [
    {
      "idObligacion": "DEU-2025-0001",
      "vencimiento": "15/02/2025",
      "monto": 125.50,
      "moneda": "PEN",
      "descripcion": "Cuota de febrero 2025"
    },
    {
      "idObligacion": "DEU-2025-0002",
      "vencimiento": "15/03/2025",
      "monto": 130.00,
      "moneda": "PEN",
      "descripcion": "Cuota de marzo 2025"
    },
    {
      "idObligacion": "DEU-2025-0003",
      "vencimiento": "15/04/2025",
      "monto": 130.00,
      "moneda": "PEN",
      "descripcion": "Cuota de abril 2025"
    }
  ]
}`;

const BIAN_JSON_DEMO = `{
  "PaymentOrder": {
    "PayerReference": { "ReferenceValue": "0098765432" },
    "CustomerName": "María López Rodríguez",
    "ObligationList": [
      {
        "ObligationId": "OBL-0001",
        "DueDateTime": "20250228",
        "Amount": "000000018900",
        "CurrencyCode": "PEN",
        "Description": "Servicio de enero 2025"
      },
      {
        "ObligationId": "OBL-0002",
        "DueDateTime": "20250331",
        "Amount": "000000019900",
        "CurrencyCode": "PEN",
        "Description": "Servicio de febrero 2025"
      }
    ]
  }
}`;

const SOAP_XML_DEMO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ConsultaDeudaResponse>
      <ReferenciaPagador>0045612300</ReferenciaPagador>
      <Titular>Carlos Ramírez Soto</Titular>
      <Obligacion>
        <IdObligacion>OBL-SOAP-01</IdObligacion>
        <Vencimiento>10/01/2025</Vencimiento>
        <Monto>340.75</Monto>
        <Moneda>SOL</Moneda>
        <Descripcion>Matrícula 2025</Descripcion>
      </Obligacion>
      <Obligacion>
        <IdObligacion>OBL-SOAP-02</IdObligacion>
        <Vencimiento>10/02/2025</Vencimiento>
        <Monto>340.75</Monto>
        <Moneda>SOL</Moneda>
        <Descripcion>Pensión febrero 2025</Descripcion>
      </Obligacion>
      <Obligacion>
        <IdObligacion>OBL-SOAP-03</IdObligacion>
        <Vencimiento>10/03/2025</Vencimiento>
        <Monto>340.75</Monto>
        <Moneda>SOL</Moneda>
        <Descripcion>Pensión marzo 2025</Descripcion>
      </Obligacion>
    </ConsultaDeudaResponse>
  </soap:Body>
</soap:Envelope>`;

const ISO8583_DEMO = `| DE   | Nombre                    | Ejemplo          |
|------|---------------------------|------------------|
| DE2  | Referencia del pagador    | 0071234567       |
| DE43 | Nombre del titular        | ANA TORRES VEGA  |
| DE37 | Referencia de obligación  | OBL000000123     |
| DE4  | Monto de la transacción   | 000000045900     |
| DE49 | Código de moneda          | 604              |
| DE13 | Fecha de vencimiento      | 20250315         |`;

const POSICIONAL_DEMO = `# CABECERA
| ini-fin | long | tipo | campo         | ejemplo |
| 1-2     | 2    | N    | TIPO_REGISTRO | 01      |
# DETALLE
| ini-fin | long | tipo | campo        | ejemplo        |
| 3-32    | 30   | A    | NOMBRE       | PEDRO SUAREZ   |
| 33-42   | 10   | N    | REFERENCIA   | 0052341000     |
| 43-54   | 12   | N    | MONTO        | 000000078450   |
| 55-57   | 3    | A    | MONEDA       | SOL            |
| 58-65   | 8    | N    | VENCIMIENTO  | 20250520       |
| 66-80   | 15   | A    | IDOBLIGACION | OBLPOS00099    |`;

const DEMOS: Record<Protocol, string> = {
  REST_JSON: REST_JSON_DEMO,
  BIAN_JSON: BIAN_JSON_DEMO,
  SOAP_XML: SOAP_XML_DEMO,
  ISO8583: ISO8583_DEMO,
  POSICIONAL: POSICIONAL_DEMO
};

export function getDemoPayload(protocol: Protocol): string {
  return DEMOS[protocol] ?? '';
}
