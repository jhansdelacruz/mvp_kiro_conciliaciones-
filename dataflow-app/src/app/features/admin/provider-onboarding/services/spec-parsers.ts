// Parsers por protocolo. Función pura `parseSpec(protocol, spec): ParseResult`,
// sin dependencias de Angular (testeable en aislamiento).
//
// Cada parser produce DOS salidas (ver design.md §3.1):
//   - `fields`: una fila por campo lógico, con paths plantilla (arrays colapsados
//     a `[]`) y el PRIMER elemento como `sample` representativo. Es lo que se
//     dibuja en el canvas del Paso 3.
//   - `normalizedSample`: mapa plano path -> valor con índices concretos
//     (obligations[0].x, obligations[1].x, ...). Lo usa el adaptador del Paso 5.
//
// `meta.obligationCount` = número de elementos de lista detectados (máx índice + 1).
// Ningún parser lanza: ante error devuelve `fields: []` con `meta.warnings`.

import { ParseResult, Protocol, ProviderField } from '../models/onboarding.model';

export function parseSpec(protocol: Protocol, spec: string): ParseResult {
  switch (protocol) {
    case 'REST_JSON':
      return parseJson(spec, protocol, false);
    case 'BIAN_JSON':
      return parseJson(spec, protocol, true);
    case 'SOAP_XML':
      return parseSoapXml(spec);
    case 'ISO8583':
      return parseIso8583(spec);
    case 'POSICIONAL':
      return parsePosicional(spec);
    default:
      return emptyResult(protocol, ['Protocolo no soportado.']);
  }
}

function emptyResult(protocol: Protocol, warnings: string[]): ParseResult {
  return {
    fields: [],
    meta: { protocol, detectedCount: 0, obligationCount: 0, warnings },
    normalizedSample: {}
  };
}

// --- Helpers de etiqueta ---

function humanize(segment: string): string {
  const spaced = segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) {
    return segment;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function deriveLabel(path: string): string {
  const clean = path.replace(/\[\]/g, '');
  const seg = clean.split('.').pop() ?? clean;
  return humanize(seg);
}

// =====================================================================
// REST_JSON / BIAN_JSON (aplanado recursivo de un ejemplo)
// =====================================================================

function parseJson(spec: string, protocol: Protocol, preservePascal: boolean): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(spec);
  } catch {
    return emptyResult(protocol, ['JSON malformado: revise la sintaxis del ejemplo pegado.']);
  }

  // Si es un fragmento OpenAPI con `example` / `examples`, usar ese nodo.
  root = unwrapOpenApiExample(root);

  const templateMap = new Map<string, string>();
  const normalizedSample: Record<string, string> = {};
  const counter = { max: 0 };

  flattenJson(root, '', '', templateMap, normalizedSample, counter, preservePascal);

  const fields: ProviderField[] = [...templateMap.entries()].map(([path, sample]) => ({
    path,
    label: deriveLabel(path),
    sample
  }));

  const warnings: string[] = [];
  if (fields.length === 0) {
    warnings.push('No se detectaron campos en el ejemplo JSON.');
  }

  return {
    fields,
    meta: { protocol, detectedCount: fields.length, obligationCount: counter.max, warnings },
    normalizedSample
  };
}

function unwrapOpenApiExample(root: unknown): unknown {
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const obj = root as Record<string, unknown>;
    if ('example' in obj && obj['example'] !== undefined) {
      return obj['example'];
    }
    if ('examples' in obj && obj['examples'] && typeof obj['examples'] === 'object') {
      const firstKey = Object.keys(obj['examples'] as Record<string, unknown>)[0];
      if (firstKey) {
        const first = (obj['examples'] as Record<string, unknown>)[firstKey];
        if (first && typeof first === 'object' && 'value' in (first as Record<string, unknown>)) {
          return (first as Record<string, unknown>)['value'];
        }
        return first;
      }
    }
  }
  return root;
}

function joinKey(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

function flattenJson(
  node: unknown,
  templatePath: string,
  concretePath: string,
  templateMap: Map<string, string>,
  normalizedSample: Record<string, string>,
  counter: { max: number },
  preservePascal: boolean
): void {
  if (Array.isArray(node)) {
    counter.max = Math.max(counter.max, node.length);
    node.forEach((el, i) => {
      flattenJson(
        el,
        `${templatePath}[]`,
        `${concretePath}[${i}]`,
        templateMap,
        normalizedSample,
        counter,
        preservePascal
      );
    });
    return;
  }

  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      // BIAN preserva PascalCase; REST también conserva las claves tal cual.
      const k = preservePascal ? key : key;
      flattenJson(
        obj[k],
        joinKey(templatePath, k),
        joinKey(concretePath, k),
        templateMap,
        normalizedSample,
        counter,
        preservePascal
      );
    }
    return;
  }

  // Escalar
  const value = node === null || node === undefined ? '' : String(node);
  if (!templateMap.has(templatePath)) {
    templateMap.set(templatePath, value);
  }
  normalizedSample[concretePath] = value;
}

// =====================================================================
// SOAP_XML (DOMParser: WSDL/XSD o XML de ejemplo)
// =====================================================================

function parseSoapXml(spec: string): ParseResult {
  const protocol: Protocol = 'SOAP_XML';
  if (typeof DOMParser === 'undefined') {
    return emptyResult(protocol, ['DOMParser no disponible en este entorno.']);
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(spec, 'text/xml');
  } catch {
    return emptyResult(protocol, ['No se pudo parsear el XML.']);
  }

  if (doc.getElementsByTagName('parsererror').length > 0) {
    return emptyResult(protocol, ['XML malformado: el parser reportó <parsererror>.']);
  }

  const root = doc.documentElement;
  if (!root) {
    return emptyResult(protocol, ['XML vacío o sin elemento raíz.']);
  }

  // Modo WSDL/XSD: tomar los nombres de xs:element.
  if (spec.includes('xs:element')) {
    return parseWsdl(spec, protocol);
  }

  const templateMap = new Map<string, string>();
  const normalizedSample: Record<string, string> = {};
  const counter = { max: 0 };

  walkXmlElement(root, '', '', templateMap, normalizedSample, counter);

  const fields: ProviderField[] = [...templateMap.entries()].map(([path, sample]) => ({
    path,
    label: deriveLabel(path),
    sample
  }));

  const warnings: string[] = [];
  if (fields.length === 0) {
    warnings.push('No se detectaron elementos en el XML de ejemplo.');
  }

  return {
    fields,
    meta: { protocol, detectedCount: fields.length, obligationCount: counter.max, warnings },
    normalizedSample
  };
}

function parseWsdl(spec: string, protocol: Protocol): ParseResult {
  const names: string[] = [];
  const re = /xs:element[^>]*name="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) !== null) {
    names.push(m[1]);
  }
  const seen = new Set<string>();
  const fields: ProviderField[] = [];
  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    fields.push({ path: name, label: humanize(name), sample: '' });
  }
  const warnings: string[] = [];
  if (fields.length === 0) {
    warnings.push('No se encontraron definiciones xs:element en el WSDL/XSD.');
  }
  return {
    fields,
    meta: { protocol, detectedCount: fields.length, obligationCount: fields.length > 0 ? 1 : 0, warnings },
    normalizedSample: {}
  };
}

function localName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

function walkXmlElement(
  el: Element,
  templatePath: string,
  concretePath: string,
  templateMap: Map<string, string>,
  normalizedSample: Record<string, string>,
  counter: { max: number }
): void {
  const childEls = Array.from(el.children);

  if (childEls.length === 0) {
    const value = (el.textContent ?? '').trim();
    if (!templateMap.has(templatePath)) {
      templateMap.set(templatePath, value);
    }
    normalizedSample[concretePath] = value;
    return;
  }

  // Agrupar hijos por nombre de tag (local).
  const groups = new Map<string, Element[]>();
  for (const child of childEls) {
    const tag = localName(child);
    const list = groups.get(tag) ?? [];
    list.push(child);
    groups.set(tag, list);
  }

  for (const [tag, members] of groups) {
    if (members.length > 1) {
      counter.max = Math.max(counter.max, members.length);
      members.forEach((member, i) => {
        walkXmlElement(
          member,
          `${joinKey(templatePath, tag)}[]`,
          `${joinKey(concretePath, tag)}[${i}]`,
          templateMap,
          normalizedSample,
          counter
        );
      });
    } else {
      walkXmlElement(
        members[0],
        joinKey(templatePath, tag),
        joinKey(concretePath, tag),
        templateMap,
        normalizedSample,
        counter
      );
    }
  }
}

// =====================================================================
// ISO 8583 (tabla DE | nombre | ejemplo)
// =====================================================================

function parseIso8583(spec: string): ParseResult {
  const protocol: Protocol = 'ISO8583';
  const fields: ProviderField[] = [];
  const normalizedSample: Record<string, string> = {};
  const seen = new Set<string>();

  for (const rawLine of spec.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-|\s]+$/.test(line)) {
      continue;
    }
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)));

    if (cells.length < 3) {
      continue;
    }
    const deMatch = /^DE\s*(\d+)$/i.exec(cells[0]);
    if (!deMatch) {
      continue; // cabecera u otra fila
    }
    const path = `DE${deMatch[1]}`;
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const label = cells[1] || deriveLabel(path);
    const sample = cells[2] ?? '';
    fields.push({ path, label, sample });
    normalizedSample[path] = sample;
  }

  const warnings: string[] = [];
  if (fields.length === 0) {
    warnings.push('No se detectaron Data Elements (filas DEnn | nombre | ejemplo).');
  }

  return {
    fields,
    meta: {
      protocol,
      detectedCount: fields.length,
      obligationCount: fields.length > 0 ? 1 : 0,
      warnings
    },
    normalizedSample
  };
}

// =====================================================================
// POSICIONAL (layout de longitud fija)
// =====================================================================

function parsePosicional(spec: string): ParseResult {
  const protocol: Protocol = 'POSICIONAL';
  const fields: ProviderField[] = [];
  const normalizedSample: Record<string, string> = {};
  const seen = new Set<string>();
  let headerScope = false;

  for (const rawLine of spec.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    // Marcadores de sección.
    if (/^#/.test(line)) {
      if (/cabecera/i.test(line)) {
        headerScope = true;
      } else if (/detalle/i.test(line)) {
        headerScope = false;
      }
      continue;
    }
    if (/^[-|\s]+$/.test(line)) {
      continue;
    }

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => !(c === '' && (idx === 0 || idx === arr.length - 1)));

    if (cells.length < 2) {
      continue;
    }
    const rangeCell = cells.find((c) => /^\d+-\d+$/.test(c));
    if (!rangeCell) {
      continue; // cabecera de tabla u otra fila
    }
    const isHeaderRow = headerScope || cells.some((c) => c.toUpperCase() === 'H');
    const path = isHeaderRow ? `pos:H:${rangeCell}` : `pos:${rangeCell}`;
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);

    // campo = penúltima celda relevante; ejemplo = última.
    const rangeIdx = cells.indexOf(rangeCell);
    const after = cells.slice(rangeIdx + 1).filter((c) => c.toUpperCase() !== 'H');
    const sample = after.length >= 1 ? after[after.length - 1] : '';
    const campo = after.length >= 2 ? after[after.length - 2] : deriveLabel(path);

    fields.push({ path, label: campo || deriveLabel(path), sample });
    normalizedSample[path] = sample;
  }

  const warnings: string[] = [];
  if (fields.length === 0) {
    warnings.push('No se detectaron filas de layout (| ini-fin | long | tipo | campo | ejemplo |).');
  }

  return {
    fields,
    meta: {
      protocol,
      detectedCount: fields.length,
      obligationCount: fields.length > 0 ? 1 : 0,
      warnings
    },
    normalizedSample
  };
}
