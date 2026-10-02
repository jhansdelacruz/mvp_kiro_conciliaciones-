# Revisión de diseño — Backend LOCAL de DataFlow (Floci + PostgreSQL)

**Documento revisado:** `.agents/tasks/floci-backend-local/design.md`
**Iteración de revisión:** 4 (fresh review, sin contexto del autor)
**Veredicto:** APPROVED (0 HIGH, 0 MEDIUM; solo NITs)

El diseño resuelve de forma concreta las dos nuances difíciles (A: autorizador Cognito que
acepta el **id token** + login que deriva rol de `cognito:groups`; B: red Lambda→Postgres) sin
suposiciones no verificadas sobre el emulador. El contrato de API coincide **exactamente** con lo
que la app Angular ya invoca cuando `useMock: false` (verificado contra el código fuente). El
esquema, los seeds en español, los buckets S3, la forma del `compose.yaml`, el plan de
aprovisionamiento idempotente y la integración acotada del frontend están todos especificados y
**no rompen** el default mock.

Las observaciones restantes son todas NIT (pulido/trazabilidad), ninguna bloqueante.

---

## Hallazgos

### 1. [NIT] El boceto del factory `AUTH_SERVICE` no muestra el import de `LocalAuthService`

**Dónde:** sección 12, "Factory `AUTH_SERVICE` en `app.config.ts`".

El `switch` usa `new LocalAuthService()`, pero el bloque de imports de `app.config.ts` (hoy importa
`MockAuthService` y `AuthService`) no se muestra actualizado. Es un detalle de implementación obvio,
pero conviene fijarlo para que compile a la primera.

**Fix concreto:** añadir en `app.config.ts`:
```typescript
import { LocalAuthService } from './core/auth/local-auth.service';
```

### 2. [NIT] La aserción negativa de "token expirado" no prueba realmente el `exp`

**Dónde:** paso 9b de `provision.mjs` ("token manipulado/expirado... forjar un JWT con `exp` en el
pasado firmado con una clave distinta").

Un JWT firmado con **otra clave** se rechaza por **firma inválida**, no por expiración; no verifica
que el autorizador honre `exp` sobre un token con firma válida. Como forjar un token válidamente
firmado y expirado requiere la clave privada del pool (no disponible localmente), esta limitación
es inherente, no un defecto subsanable. El test de "sin token" + "byte manipulado" sí cubre la
aceptación/rechazo básica (nuance A positiva en 9a y negativa en 9b).

**Fix concreto:** renombrar el caso a "token con firma inválida" para no dar a entender que se
prueba `exp` de forma independiente, y documentar en el README que la validación de expiración con
firma válida no es testeable localmente sin la clave del pool.

### 3. [NIT] El fallback de "ajuste de issuer" describe una perilla de config que no existe

**Dónde:** Nuance A, "Verificación de issuer" y nota de red ("ajusta el `providerARNs`/issuer del
autorizador en consecuencia").

Un autorizador `COGNITO_USER_POOLS` solo expone `providerARNs` (apuntan al pool); el issuer lo
deriva internamente el motor a partir del pool, no es un campo configurable. "Ajustar el issuer"
no es una acción real. La verdadera red de seguridad es que, si el issuer embebido en los tokens no
cuadra con el que valida el autorizador, el paso **9a falla** y `provision.mjs` aborta con mensaje
accionable — eso sí es correcto.

**Fix concreto:** reescribir la nota como: "si el `iss` real difiere de
`http://localhost:4566/<userPoolId>`, 9a fallará (el autorizador rechazará el id token); se registra
WARN con el `iss` detectado y se documenta en troubleshooting; no hay un campo de issuer que ajustar
en el autorizador Cognito".

### 4. [NIT] Ambigüedad en el empaquetado de dependencias de las Lambdas

**Dónde:** paso 5 de `provision.mjs` ("`npm`/instalar deps pinneadas (o incluir `node_modules`
precalculado)").

El "o" deja dos mecanismos válidos sin elegir uno. Ambos funcionan, pero una decisión fija evita
divergencias en la implementación.

**Fix concreto:** fijar uno, p. ej.: "`provision.mjs` ejecuta `npm ci --omit=dev` dentro de la
carpeta de cada función (con su `package-lock.json` pinneado) y luego zippea `node_modules` + fuente
+ `common/` copiado".

### 5. [NIT] Prosa contradictoria sobre la reasignación de filas de `process_history`

**Dónde:** sección "`02_seed.sql`".

La frase "se reasignan dos de ellas a otro cliente activo manteniendo nombres/fechas" contradice la
"Decisión" inmediatamente posterior ("se mantienen las 6 filas tal cual para `client-001` y se
añaden 2 filas extra para `client-004`"). El SQL es inequívoco (`proc-001..006`→`client-001`,
`proc-007/008`→`client-004`), pero la prosa confunde.

**Fix concreto:** borrar la frase "se reasignan dos de ellas..." y dejar solo la "Decisión" + el SQL.

### 6. [NIT] El layout de clave S3 diverge de `AGENTS.md` §8 (trazabilidad)

**Dónde:** sección "S3" y "Detalle de los handlers Files".

`AGENTS.md` §8 documenta `{clientId}/{processId}/<archivo>`; el diseño usa
`{s3Prefix}{processId}/{fileName}` (p. ej. `clients/acme/proc-xyz/file`, no `client-001/proc-xyz/file`).
Está justificado (fidelidad con los `input_s3_key` sembrados) y no hay consumidor real todavía
(`file-upload` está simulado), así que es solo una divergencia de trazabilidad, no un defecto
funcional.

**Fix concreto:** añadir una línea a `AGENTS.md` §8 aclarando que el layout efectivo es
`{s3Prefix}{processId}/{fileName}` y que `s3Prefix` ya codifica el cliente, para que ambos
documentos no se contradigan.

---

## Assumptions verificadas (leídas contra el código fuente real)

Todas las afirmaciones del diseño sobre el frontend se comprobaron contra el código y **son
correctas**:

1. `auth.interceptor.ts` adjunta `Authorization: Bearer <token>` solo cuando `!useMock`, y
   `auth.service.ts#getJwtToken()` devuelve `session.tokens?.idToken?.toString()` → el frontend
   manda el **id token**. (Verificado.) El cambio propuesto al interceptor (`startsWith(apiUrl)`)
   es coherente con el código actual.
2. `login.component.ts` fija el error con `e?.message ?? 'Error al iniciar sesión'` → el mapeo
   `err.error.message → new Error(...)` de `LocalAuthService` es necesario y correcto. (Verificado.)
3. `dashboard.component.ts` llama `processHistoryService.getHistory('current-user-id')` (placeholder
   hardcodeado). (Verificado.) Justifica derivar `clientId` del token para el rol `client`.
4. `process-history.service.ts`: `GET /processes?clientId=${clientId}` y `POST /processes/${id}/retry`.
   (Verificado — coincide exacto con el contrato del diseño.)
5. `client.service.ts`: `GET /clients`, `GET /clients/{id}`, `POST /clients`, `PUT /clients/{id}`,
   `DELETE /clients/{id}/deactivate`. (Verificado — coincide exacto, incluido el sufijo `/deactivate`.)
6. `app.config.ts` usa hoy `useFactory: () => useMock ? new MockAuthService() : new AuthService()`.
   (Verificado.) El `switch` sobre `authMode` es una extensión consistente del mismo patrón; con
   `authMode:'mock'` por defecto, el default mock queda **intacto**.
7. `mock-auth.service.ts` expone `currentUser` como `Signal<{ email, role } | null>`. (Verificado.)
   La forma de `LocalAuthService` coincide → guards y login funcionan sin cambios.
8. `client.model.ts`: `Client`/`ClientFormData` en camelCase con los campos que el esquema SQL mapea
   (`notificationEmail`, `s3Prefix`, `urlExpiration`, etc.). (Verificado.)
9. `file-upload.component.ts` está **totalmente simulado** (`setInterval` de progreso), no llama a
   `/files/*`. (Verificado.) Justifica aprovisionar Files "por adelantado".
10. Existen los tres `environment*.ts` (`environment.ts`, `environment.development.ts`,
    `environment.prod.ts`) con la forma `{ production, useMock, apiUrl, cognito }`. (Verificado.)
    Añadir `authMode` a los tres es necesario y suficiente para que el factory compile.
11. Datos mock: 5 clientes (incluye `client-003` `GlobalCorp` INACTIVE) y 6 `process_history` todos
    de `client-001`. (Verificado contra `client.service.ts` y `process-history.service.ts`.) El seed
    los replica fielmente; `cliente@empresa.com → custom:clientId=client-001` puebla el dashboard
    con esos 6 procesos sin tocar `dashboard.component.ts`.

### Nuance A — resuelta sin hand-waving (verificado en el diseño)
- No asume validación "solo access token": apunta explícitamente a aceptar el **id token** porque es
  lo que manda el interceptor.
- No hardcodea JWKS/issuer: lee `.well-known/openid-configuration` en runtime (`issuer`, `jwks_uri`)
  con fallback registrado; guarda `cognitoIssuer`/`cognitoJwksUri` en `outputs.json`.
- No asume que Floci haga enforcement: lo **prueba** con aserciones negativas (9b) y aborta +
  `authorizerEnforced:false` + plan B (authorizer Lambda custom) si no.
- `/auth/login` deriva rol de `cognito:groups` con el helper único `groupsFrom`/`isAdmin`
  (match exacto de token, sin substring).

### Nuance B — resuelta sin vaguedad (verificado en el diseño)
- Red de usuario con `name: dataflow-net` fijado (evita el prefijo `<project>_`).
- `LAMBDA_DOCKER_NETWORK=dataflow-net` en el servicio `floci`; `postgres` y `floci` en la misma red.
- `PGHOST=postgres` por env var en `CreateFunction`; fallback `host.docker.internal` + puerto
  publicado, conmutable por variable sin editar código.
- `provision.mjs` verifica `docker network inspect dataflow-net` y hace un `GET /clients` e2e que
  falla con mensaje accionable si la Lambda no conecta a Postgres.

---

## Assumptions no verificadas / dependientes del emulador (externas, no auditables aquí)

Ninguna es un defecto del diseño: todas están **reconocidas** y mitigadas con verificación en
runtime y/o fallback documentado. Se listan por transparencia:

1. **El autorizador Cognito de Floci valida tokens y rellena
   `event.requestContext.authorizer.claims` con `cognito:groups` y `custom:clientId`.** No se puede
   verificar sin ejecutar Floci. Mitigado: 9a/9c fallan y abortan el provisioning si los claims no
   llegan o el enforcement no ocurre; plan B documentado.
2. **Floci publica `.well-known/openid-configuration` y un `jwks_uri` resoluble.** Mitigado:
   descubrimiento en runtime con fallback a `.../.well-known/jwks.json` + WARN.
3. **Floci honra `LAMBDA_DOCKER_NETWORK` y adjunta los contenedores Lambda a `dataflow-net`.**
   Mitigado: verificación de red + prueba e2e DB + fallback `host.docker.internal`.
4. **`localhost:4566` es la vista válida del issuer tanto desde el host como dentro del contenedor
   Floci.** Mitigado: 9a fallaría si el `iss` no cuadra (ver NIT 3).
5. **Healthcheck en `/_localstack/health`.** Mitigado: fallback `/health` documentado + reintentos
   propios de `provision.mjs`.

**No se encontró ninguna assumption *incorrecta* sobre el código del frontend:** cada referencia del
diseño a `dataflow-app` coincide con la fuente real.
