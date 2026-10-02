# Diseño técnico — Backend LOCAL de DataFlow con Floci + PostgreSQL

## Visión general

Este diseño define un backend **100% local** para la app Angular "DataFlow", usando
**Floci** (emulador local de AWS, reemplazo drop-in de LocalStack, imagen `floci/floci:latest`,
expone todos los servicios en `http://localhost:4566`) más un contenedor **PostgreSQL 16**.
Todo arranca con `docker compose up` + un script de aprovisionamiento idempotente, sin
ninguna cuenta real de AWS. El backend reproduce el contrato que la app ya espera cuando
`useMock: false`: un API Gateway REST con autorizador Cognito, Lambdas en Node.js 20 que
hablan con Postgres, dos buckets S3 y un pool de Cognito con grupos `admin`/`client`.

El trabajo vive en una carpeta nueva y aislada: `/Users/jhansdelacruz/Documents/kiro/mvp/backend`.
La app Angular (`dataflow-app`) **no se toca** salvo la integración de frontend acotada del
último paso (sección 12). El modo mock sigue siendo el valor por defecto y no se rompe.

El stack queda **bloqueado** al aprobarse este diseño:

| Capa | Tecnología (fija) |
|------|-------------------|
| Emulador AWS | Floci `floci/floci:latest` (puerto 4566), socket Docker montado |
| Base de datos | PostgreSQL 16 (contenedor `postgres:16`) |
| Lambdas | Node.js 20, módulos **ESM** (`"type":"module"` por función) |
| SDK AWS en Lambda | `@aws-sdk/*` v3 (solo las que cada handler necesita) |
| Driver Postgres | `pg` v8 |
| Decodificación JWT (login) | decodificación manual del payload base64url (sin verificación de firma en el handler); **no** se añade `jsonwebtoken` |
| Aprovisionamiento | Node ESM `provision.mjs` con `@aws-sdk/*` v3 apuntando a `AWS_ENDPOINT_URL=http://localhost:4566` |
| Orquestación | Docker Compose v2+ (`compose.yaml`) + `Makefile` |

Decisión de aprovisionamiento: se elige **un único `provision.mjs` en Node** (no bash) porque
necesita empaquetar ZIPs de Lambda, leer/escribir `outputs.json`, hacer reintentos con backoff
y lógica idempotente de "crear-o-actualizar" que en bash sería frágil.

Decisión de módulos Lambda: **ESM** (`import`), consistente con `provision.mjs` y con las
versiones modernas de `@aws-sdk` v3; cada carpeta de función lleva su `package.json` con
`"type":"module"`.

---

## Nuance A — Cableado de autenticación Cognito (autorizador + id token)

Este es el punto que más fácilmente se rompe, así que se fija por completo aquí.

### Qué envía el frontend

`auth.interceptor.ts` adjunta `Authorization: Bearer <idToken>` (ver `auth.service.ts`:
`getJwtToken()` devuelve `session.tokens?.idToken?.toString()`). Por tanto el autorizador del
API Gateway **debe aceptar el ID token**, no solo el access token. El `LocalAuthService` nuevo
replicará esto: `getJwtToken()` devuelve el `idToken` guardado tras el login.

### Endpoints que Floci Cognito expone

Floci implementa los endpoints OpenID/JWKS de Cognito bajo el mismo host `:4566`. Para un pool
con id `<userPoolId>` el **issuer** esperado es:

```
http://localhost:4566/<userPoolId>
```

y publica un **documento de discovery OpenID**:

- OpenID discovery: `http://localhost:4566/<userPoolId>/.well-known/openid-configuration`

> **No se hardcodea la ruta del JWKS.** El `.well-known/jwks.json` es el valor **habitual** en la
> familia LocalStack, pero el diseño **no lo asume**: `provision.mjs` descarga el documento de
> discovery (`.well-known/openid-configuration`) y lee de él los campos reales `issuer` y
> `jwks_uri`, que luego registra en `outputs.json` (`cognitoIssuer`, `cognitoJwksUri`). De ese
> modo, si una versión de Floci publica el JWKS en otra ruta o emite el issuer con otro host, el
> diseño lo descubre en tiempo de aprovisionamiento en vez de romperse por una suposición. Si el
> documento de discovery no está disponible, `provision.mjs` cae a la ruta por defecto
> `http://localhost:4566/<userPoolId>/.well-known/jwks.json` y lo registra con un WARN.

> Nota de red: `localhost:4566` es la vista desde el host y desde el propio contenedor Floci
> (el autorizador del API Gateway lo resuelve **dentro** de Floci, que es donde corre el motor
> del API Gateway). El issuer embebido en los tokens emitidos por Floci coincide con esa URL,
> de modo que la validación `iss` cuadra. Si Floci emitiera el issuer con otro host (p. ej.
> `http://floci:4566`), `provision.mjs` lo detecta leyendo el `iss` de un token de prueba
> emitido durante el aprovisionamiento y ajusta el `providerARNs`/issuer del autorizador en
> consecuencia (ver "Verificación de issuer" abajo). El valor por defecto asumido es
> `http://localhost:4566/<userPoolId>`.

### Configuración del autorizador en API Gateway

Se crea un autorizador de tipo **`COGNITO_USER_POOLS`** en el REST API:

- `name`: `dataflow-cognito-authorizer`
- `type`: `COGNITO_USER_POOLS`
- `identitySource`: `method.request.header.Authorization`
- `providerARNs`: `[ arn:aws:cognito-idp:us-east-1:000000000000:userpool/<userPoolId> ]`
  (ARN que Floci asigna al pool; se obtiene de la respuesta de `CreateUserPool`).

El autorizador Cognito User Pools de API Gateway, en AWS real, valida tokens emitidos por ese
pool y, de forma nativa, **acepta tanto el `id` token como el `access` token** siempre que el
claim `token_use` sea `id` o `access` y la firma valide contra el JWKS del pool. Como el frontend
manda el **id token**, el diseño apunta a ese comportamiento: el autorizador descarga el JWKS del
issuer del pool, valida firma + `exp` + `aud` (el `aud`/`client_id` del app client) y, si pasa,
deja fluir la petición, poblando `event.requestContext.authorizer.claims` con los claims del id
token (incluido `cognito:groups`), de modo que los handlers protegidos leen los grupos sin volver
a llamar a Cognito.

> **Esto NO se asume como un hecho verificado en Floci.** Floci es un emulador de terceros no
> auditable por este diseño, y los emuladores de la familia LocalStack históricamente han tenido
> enforcement **parcial o nulo** del autorizador Cognito. Por tanto el diseño **no da por bueno**
> que el autorizador rechace tokens inválidos: lo **prueba** en el paso 9 de `provision.mjs` con
> aserciones negativas (ver más abajo). Si Floci no hace enforcement, `provision.mjs` **falla** y
> el README documenta el riesgo (rutas protegidas quedarían abiertas en el entorno local) y el
> plan B (authorizer Lambda custom que verifica firma contra `jwks_uri` del discovery). El
> happy-path por sí solo no basta como verificación.

Decisión sobre autorización por grupo (`admin`): el autorizador Cognito **solo autentica** (token
válido), no distingue grupos. La comprobación de "pertenece al grupo `admin`" se hace **dentro de
cada handler de `/clients*`** leyendo `event.requestContext.authorizer.claims['cognito:groups']`.
Si el grupo `admin` no está presente → `403 { "message": "Acceso denegado" }`. Se elige esta vía
(y no un authorizer Lambda custom) porque es la mínima que respeta el contrato y evita una Lambda
extra; el autorizador Cognito nativo ya rellena `event.requestContext.authorizer.claims` con todos
los claims del id token en integraciones `AWS_PROXY`.

#### Parsing uniforme de `cognito:groups` (helper único, resuelve divergencia de forma)

El claim `cognito:groups` se lee en **dos** sitios con **dos** formas potencialmente distintas:

- En `/auth/login` el handler decodifica el payload del id token, donde `cognito:groups` es un
  **array JSON** (`["admin"]`).
- En los handlers protegidos el valor llega desde `event.requestContext.authorizer.claims`, donde
  los claims de tipo array suelen **serializarse a string** (p. ej. `"[admin]"`, `"admin,client"`
  o separados por espacios), y la forma concreta es dependiente de Floci.

Para que ambos caminos se comporten igual (y evitar falsos positivos como un grupo
`admin-readonly` o falsos negativos por serialización), se define **un único helper de
normalización** en `common/http.mjs`, usado por los dos:

```js
// common/http.mjs
export function groupsFrom(claim) {
  if (Array.isArray(claim)) return claim;
  if (typeof claim === 'string')
    return claim.replace(/^\[|\]$/g, '').split(/[,\s]+/).filter(Boolean);
  return [];
}

export function getClaims(event) {
  return event?.requestContext?.authorizer?.claims ?? {};
}

export function isAdmin(claims) {
  return groupsFrom(claims['cognito:groups']).includes('admin'); // match exacto de token, no substring
}
```

- `/auth/login`: `role = groupsFrom(payload['cognito:groups']).includes('admin') ? 'admin' : 'client'`.
- Handlers `/clients*`: `if (!isAdmin(getClaims(event))) return json(403, { message: 'Acceso denegado' })`.

`groupsFrom` compara **tokens exactos** de la lista (nunca `String.includes` sobre la cadena
cruda), lo que elimina el riesgo de substring. Su comportamiento se fija con **unit tests** (ver
Testabilidad): array, string con corchetes, separado por comas, separado por espacios, vacío,
`null`, y el caso `admin-readonly` que **no** debe considerarse `admin`.

### El endpoint `/auth/login` (público)

`POST /auth/login` **no** pasa por el autorizador (es público). Su handler:

1. Lee `{ email, password }` del body.
2. Llama a Cognito **`InitiateAuth`** con `AuthFlow: USER_PASSWORD_AUTH` y
   `AuthParameters: { USERNAME: email, PASSWORD: password }`, usando `ClientId = <appClientId>`
   (app client **sin secret**), con el cliente `@aws-sdk/client-cognito-identity-provider`
   apuntado a `http://localhost:4566`.
3. De `AuthenticationResult` obtiene `IdToken`, `AccessToken`, `RefreshToken`.
4. Decodifica el **payload** del `IdToken` (split por `.`, base64url-decode del segmento central,
   `JSON.parse`) y normaliza `cognito:groups` con el **mismo** helper `groupsFrom` de
   `common/http.mjs` que usan los handlers protegidos:
   `role = groupsFrom(payload['cognito:groups']).includes('admin') ? 'admin' : 'client'`.
   `email` se toma del claim `email` del id token (fallback al email del body).
5. Responde `200 { idToken, accessToken, refreshToken, role, email }`.
6. Credenciales inválidas (`NotAuthorizedException` / `UserNotFoundException`) →
   `401 { "message": "Credenciales incorrectas" }` (texto exacto que el frontend ya espera).

No se verifica la firma del id token en este handler (es un login contra el propio pool que acaba
de emitirlo); la verificación de firma la hace el autorizador en las rutas protegidas. Por eso
**no** se añade `jsonwebtoken` como dependencia; basta `Buffer.from(seg, 'base64url')`.

### Verificación de issuer (robustez del aprovisionamiento)

Durante `provision.mjs`, tras crear el pool, el app client y los usuarios, el script hace un
`InitiateAuth` de prueba con `admin@dataflow.com`, decodifica el id token y guarda el `iss` real
en `outputs.json` (`cognitoIssuer`). Si difiere de `http://localhost:4566/<userPoolId>` se registra
un WARN en consola y en el README (sección troubleshooting), porque el `providerARNs` del autorizador
debe apuntar al pool cuyo issuer coincide con el de los tokens. En la práctica con Floci coinciden.

---

## Nuance B — Red Lambda → PostgreSQL

Floci ejecuta las Lambdas como **contenedores Docker reales** (de ahí el montaje de
`/var/run/docker.sock`). Esos contenedores se lanzan en la red Docker que usa Floci, **no** en la
red del host, así que desde dentro de una Lambda `localhost` apunta al propio contenedor Lambda y
**no** llega a Postgres.

### Decisión concreta

1. En `compose.yaml` se define una red de usuario explícita con **nombre fijado**:
   `networks: dataflow-net: { name: dataflow-net, driver: bridge }`. El `name:` es obligatorio:
   sin él, Compose nombra la red `<project>_dataflow-net` y el valor de `LAMBDA_DOCKER_NETWORK`
   dejaría de coincidir con el nombre real de la red (ver nota en la sección `compose.yaml`).
2. Los servicios `floci` y `postgres` se unen ambos a `dataflow-net`.
3. El servicio Postgres se llama exactamente **`postgres`** (nombre de servicio = hostname DNS en
   la red Docker).
4. Floci lanza los contenedores Lambda **adjuntándolos a la misma red** que el contenedor Floci.
   Para forzarlo se fija la variable de entorno de Floci **`LAMBDA_DOCKER_NETWORK=dataflow-net`**
   en el servicio `floci`. Como la red real se llama literalmente `dataflow-net` (por el `name:`
   fijado), cada contenedor Lambda nace dentro de `dataflow-net` y resuelve el DNS `postgres`.
   `provision.mjs` confirma con `docker network inspect dataflow-net` que la red existe con ese
   nombre exacto antes de crear funciones; si no, aborta indicando que falta `name: dataflow-net`.
5. Las Lambdas reciben, **en el momento de su creación** (`CreateFunction`, campo `Environment.Variables`),
   estas variables:

   | Var | Valor |
   |-----|-------|
   | `PGHOST` | `postgres` (nombre de servicio en `dataflow-net`) |
   | `PGPORT` | `5432` |
   | `PGUSER` | `dataflow` |
   | `PGPASSWORD` | `dataflow` |
   | `PGDATABASE` | `dataflow` |

   **Host elegido: `PGHOST=postgres`.** Fallback documentado: si en un entorno dado los contenedores
   Lambda no se unen a `dataflow-net` (p. ej. una versión de Floci que ignore `LAMBDA_DOCKER_NETWORK`),
   usar `PGHOST=host.docker.internal` y publicar el puerto `5432:5432` (que ya se publica). `provision.mjs`
   lee `PGHOST` de su propio entorno si está definido, de modo que cambiar el fallback es una variable,
   no una edición de código.

6. El pool `pg` dentro de cada handler se construye desde esas env vars (`new Pool()` toma `PGHOST`…
   automáticamente). Se usa un `Pool` a nivel de módulo (fuera del handler) para reutilizar conexión
   entre invocaciones calientes; `max: 1` por contenedor Lambda para no agotar conexiones.

### Verificación obligatoria

`provision.mjs`, al final, invoca un endpoint real (`GET /clients` con el id token de admin) y
comprueba que devuelve los 5 clientes sembrados. Si la Lambda no conecta a Postgres, esa llamada
falla con 500 y el script sale con error describiendo el problema de red (apuntando al troubleshooting
de `PGHOST`). Así "verifica que realmente conecta" no es opcional.

---

## Contrato de API (exacto)

REST API en API Gateway, stage **`local`**. Todas las respuestas son JSON **camelCase** que casa
con las interfaces TS de `AGENTS.md`. Integraciones **`AWS_PROXY`** (Lambda proxy) para que cada
handler reciba el evento completo con `requestContext.authorizer.claims`.

### Clients (admin, protegidas — requieren grupo `admin`)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/clients` | — | `200 Client[]` |
| GET | `/clients/{id}` | — | `200 Client` / `404 { message }` |
| POST | `/clients` | `ClientFormData` | `201 Client` |
| PUT | `/clients/{id}` | `ClientFormData` | `200 Client` / `404` |
| DELETE | `/clients/{id}/deactivate` | — | `204` (sin body); fija `status=INACTIVE` |

### Processes (cliente, protegidas)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| GET | `/processes?clientId={id}` | — | `200 ProcessRecord[]` |
| POST | `/processes/{processId}/retry` | — | `204`; fija `status=PENDING`, limpia `error_message` |

### Files (cliente, protegidas)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| POST | `/files/presigned-upload` | `{ clientId, fileName, fileType, fileSize }` | `200 { url, key, processId }` |
| POST | `/files/trigger` | `{ clientId, processId, key, fileName, fileType, fileSize }` | `200 { processId, status }` |
| GET | `/files/download/{processId}` | — | `200 { url }` / `404` |

> **Alcance de "casa con el frontend":** sólo los endpoints de **auth**, **clients** y **processes**
> tienen un llamador real hoy (`LocalAuthService`, `client.service.ts`, `process-history.service.ts`).
> `file-upload.component.ts` está **totalmente simulado** (barra de progreso con `setInterval`) y
> **no** llama a `/files/presigned-upload`, `/files/trigger` ni `/files/download`. Por tanto los
> endpoints de **Files se aprovisionan por adelantado** (listos para cuando se cablee la subida
> real), no porque exista un consumidor actual que haya que empatar. El enunciado pide tenerlos
> listos, y así quedan.

### Auth (pública)

| Método | Ruta | Body | Respuesta |
|--------|------|------|-----------|
| POST | `/auth/login` | `{ email, password }` | `200 { idToken, accessToken, refreshToken, role, email }` / `401 { message: "Credenciales incorrectas" }` |

### Detalle del handler Processes (aislamiento por tenant y wiring del dashboard)

Contexto del frontend (verificado en `dashboard.component.ts`): el dashboard del cliente llama a
`this.processHistoryService.getHistory('current-user-id')`, un **placeholder hardcodeado**. Con
`useMock: false` eso se traduce en `GET /processes?clientId=current-user-id`. Si el handler
confiara en ese query param, filtraría por un `client_id` inexistente y el dashboard saldría
**vacío**. Además, confiar en el query param violaría el invariante de `AGENTS.md` §8 ("la Lambda
extrae el identificador del cliente del JWT para filtrar datos por cliente"): cualquier cliente
autenticado podría leer procesos de otro.

**Decisión (opción preferida del review): el `clientId` se deriva del token para el rol `client`,
ignorando el query param; el admin sí puede consultar cualquier cliente por query param.**

`GET /processes` resuelve el `clientId` efectivo así:

1. `claims = getClaims(event)`; `admin = isAdmin(claims)`.
2. Si `admin`: `clientId = event.queryStringParameters?.clientId`. Si falta → `400 { message:
   "clientId es obligatorio" }`. (El admin puede inspeccionar cualquier cliente.)
3. Si **no** admin (rol `client`): `clientId = claims['custom:clientId']` (ver Cognito, abajo). El
   query param que manda el frontend (`current-user-id`) se **ignora**. Si el claim
   `custom:clientId` falta → `403 { message: "Acceso denegado" }`.
4. `SELECT ... FROM process_history WHERE client_id = $1 ORDER BY created_at DESC`.

Con esto, el usuario de prueba `cliente@empresa.com` (mapeado a `custom:clientId = client-001`, ver
Cognito) ve exactamente los **6 procesos de `client-001`** que ya muestran los mocks — el dashboard
se puebla igual que en modo mock, sin tocar `dashboard.component.ts`. El invariante de aislamiento
por tenant queda satisfecho: el filtro no depende de entrada del cliente.

`POST /processes/{processId}/retry`: idéntico criterio de autorización — un cliente solo puede
reintentar un proceso cuyo `client_id` coincida con su `custom:clientId` (si no, `403`/`404`); el
admin puede reintentar cualquiera. Fija `status='PENDING'`, limpia `error_message`, responde `204`.

> **Nota de wiring del frontend:** el dashboard sigue enviando `current-user-id`; **no se modifica**
> (está fuera del cambio acotado permitido en `dataflow-app`). Funciona porque el backend ignora
> ese valor para el rol `client` y usa el claim del token. Esto se documenta en la sección 12 y en
> el README. Si en el futuro se quiere que el dashboard mande el `clientId` real, bastaría leerlo de
> `currentUser()`; no es necesario para que el flujo funcione end-to-end ahora.

### Detalle de los handlers Files

- **`/files/presigned-upload`**: genera `processId = "proc-" + randomUUID()`; busca el `s3_prefix`
  del cliente en Postgres; compone `key = <clientId>/<processId>/<fileName>` (ver layout S3) con el
  `s3Prefix` como raíz lógica —se decide usar `key = {s3Prefix}{processId}/{fileName}` para respetar
  el prefijo por cliente que ya existe en los datos; genera presigned **PUT** con
  `@aws-sdk/s3-request-presigner` + `PutObjectCommand` sobre `dataflow-input-local`, expiración =
  `url_expiration` del cliente. Devuelve `{ url, key, processId }`. **No** inserta fila todavía.
- **`/files/trigger`**: inserta una fila en `process_history` con `status='PROCESSING'`,
  `input_s3_key = key`, `created_at = now()`. Aquí va el **stub de AgentCore**:
  `// TODO AgentCore: aquí se invocaría el AgentCore Runtime con input_s3_key (fuera de alcance)`.
  Devuelve `{ processId, status: 'PROCESSING' }`.
- **`/files/download/{processId}`**: lee `output_s3_key` de la fila; si existe genera presigned
  **GET** sobre `dataflow-output-local` (expiración = `url_expiration` del cliente dueño) y devuelve
  `{ url }`; si no hay `output_s3_key` → `404 { message: "Documento no disponible" }`.

### Validación de entrada (por campo)

Reglas aplicadas en los handlers antes de tocar la BD. Fallo de validación → `400 { message, errors? }`.

- `POST /auth/login`: `email` requerido, string, formato email, ≤254 chars; `password` requerido,
  string, 1..256 chars. Falta cualquiera → `400 { message: "email y password son obligatorios" }`.
- `POST /clients` y `PUT /clients/{id}` (`ClientFormData`):
  - `name`: requerido, string, 1..200.
  - `company`: requerido, string, 1..200.
  - `email`: requerido, formato email, ≤254.
  - `status`: requerido, enum `ACTIVE|INACTIVE`.
  - `deliveryMethod`: requerido, enum `EMAIL|DASHBOARD`.
  - `notificationEmail`: opcional (string, formato email si viene; obligatorio si `deliveryMethod=EMAIL`
    → si falta en ese caso, `400`).
  - `s3Prefix`: requerido, string, 1..200, se normaliza para terminar en `/`.
  - `urlExpiration`: requerido, entero, 60..604800 (1 min..7 días).
- `GET /processes`: la regla **depende del rol** (coherente con "Detalle del handler Processes"):
  - rol `admin`: `clientId` query param **obligatorio** → si falta, `400 { message: "clientId es obligatorio" }`.
  - rol `client`: el query param se **ignora** y el `clientId` se deriva del claim `custom:clientId`
    del id token → si el claim falta, `403 { message: "Acceso denegado" }`. (Nunca `400` por `clientId`
    ausente para un cliente: el aislamiento por tenant no depende de entrada del cliente.)
- `POST /files/presigned-upload`: `clientId` requerido y existente; `fileName` requerido, 1..255,
  sin `/` ni `..`; `fileType` enum `CSV|JSON|XLSX`; `fileSize` entero > 0 y ≤ 52428800 (50 MB).
- `{processId}` / `{id}` de path: string no vacío; si no existe la fila → `404`.

### CORS

En **todas** las rutas se crea el método `OPTIONS` (preflight) con respuesta mock y los handlers
`AWS_PROXY` devuelven las mismas cabeceras en sus respuestas reales:

```
Access-Control-Allow-Origin: http://localhost:4200
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Authorization,Content-Type
```

Se define un helper compartido `cors()` en una pequeña util común copiada en cada paquete de Lambda
(o en una capa; se elige **copiar la util** en cada función para evitar la complejidad de Lambda
Layers en Floci). Las respuestas de error también incluyen las cabeceras CORS.

---

## Esquema PostgreSQL

Base de datos **`dataflow`**, usuario/clave **`dataflow` / `dataflow`** (valor de desarrollo local,
documentado en README). El esquema y los seeds se cargan vía SQL auto-ejecutado por el contenedor
Postgres (`/docker-entrypoint-initdb.d/`), que corre los `.sql` en orden alfabético al inicializar
el volumen vacío.

Archivos:

- `backend/db/init/01_schema.sql`
- `backend/db/init/02_seed.sql`

### `01_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS clients (
  client_id          text PRIMARY KEY,
  cognito_username   text NOT NULL,
  name               text NOT NULL,
  company            text NOT NULL,
  email              text NOT NULL,
  status             text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  delivery_method    text NOT NULL CHECK (delivery_method IN ('EMAIL','DASHBOARD')),
  notification_email text,
  s3_prefix          text NOT NULL,
  url_expiration     integer NOT NULL DEFAULT 3600,
  total_processes    integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

CREATE TABLE IF NOT EXISTS process_history (
  process_id     text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES clients(client_id),
  file_name      text NOT NULL,
  file_type      text NOT NULL CHECK (file_type IN ('CSV','JSON','XLSX')),
  file_size      bigint NOT NULL,
  status         text NOT NULL CHECK (status IN ('PENDING','PROCESSING','COMPLETED','ERROR')),
  input_s3_key   text,
  output_s3_key  text,
  download_url   text,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_process_history_client ON process_history(client_id);
```

### Mapeo snake_case (Postgres) ↔ camelCase (JSON/TS)

Los handlers hacen el mapeo **explícito** en dos funciones por tabla (`rowToClient`, `rowToProcess`
y a la inversa `clientBodyToColumns`). No se usa mapeo automático.

**clients**

| Columna (snake) | Campo JSON (camel) | Notas |
|-----------------|--------------------|-------|
| `client_id` | `clientId` | PK, string `client-00X` |
| `cognito_username` | `cognitoUsername` | en POST se setea = `email` |
| `name` | `name` | |
| `company` | `company` | |
| `email` | `email` | |
| `status` | `status` | |
| `delivery_method` | `deliveryMethod` | |
| `notification_email` | `notificationEmail` | omitir si `null` |
| `s3_prefix` | `s3Prefix` | |
| `url_expiration` | `urlExpiration` | number |
| `total_processes` | `totalProcesses` | number |
| `created_at` | `createdAt` | ISO string (`.toISOString()`) |
| `updated_at` | `updatedAt` | ISO string u omitir si `null` |

**process_history**

| Columna (snake) | Campo JSON (camel) | Notas |
|-----------------|--------------------|-------|
| `process_id` | `processId` | PK |
| `client_id` | `clientId` | |
| `file_name` | `fileName` | |
| `file_type` | `fileType` | |
| `file_size` | `fileSize` | number (bigint → Number en JSON; valores pequeños, sin riesgo) |
| `status` | `status` | |
| `download_url` | `downloadUrl` | omitir si `null` |
| `error_message` | `errorMessage` | omitir si `null` |
| `created_at` | `createdAt` | ISO string |
| `completed_at` | `completedAt` | ISO string u omitir si `null` |
| `input_s3_key` | — | interno, no se expone |
| `output_s3_key` | — | interno, no se expone |

Nota: las columnas `timestamptz` las devuelve `pg` como objeto `Date`; los handlers aplican
`.toISOString()`. Las fechas de seed se guardan con el mismo valor literal que los mocks del frontend
(sufijo `Z`).

### `02_seed.sql` — datos en español (copiados de los mocks)

Cinco clientes idénticos a `MOCK_CLIENTS` de `client.service.ts` (incluye `GlobalCorp` INACTIVE):

```sql
INSERT INTO clients (client_id, cognito_username, name, company, email, status, delivery_method, notification_email, s3_prefix, url_expiration, total_processes, created_at, updated_at) VALUES
('client-001','juan.garcia@acme.com','Juan García','ACME Distribuciones S.A.','juan.garcia@acme.com','ACTIVE','DASHBOARD',NULL,'clients/acme/',3600,15,'2024-01-05T08:00:00Z','2024-03-01T10:30:00Z'),
('client-002','maria.lopez@tecnova.mx','María López','Tecnova México','maria.lopez@tecnova.mx','ACTIVE','EMAIL','maria.lopez@tecnova.mx','clients/tecnova/',7200,8,'2024-01-20T09:15:00Z','2024-02-28T14:00:00Z'),
('client-003','carlos.mendez@globalcorp.com','Carlos Méndez','GlobalCorp Latinoamérica','carlos.mendez@globalcorp.com','INACTIVE','EMAIL','carlos.mendez@globalcorp.com','clients/globalcorp/',3600,3,'2024-02-10T11:00:00Z','2024-03-05T09:45:00Z'),
('client-004','ana.torres@solucionespy.com','Ana Torres','Soluciones Paraguay','ana.torres@solucionespy.com','ACTIVE','DASHBOARD',NULL,'clients/solucionespy/',14400,22,'2024-01-12T07:30:00Z','2024-03-10T16:20:00Z'),
('client-005','roberto.vargas@inversiones.co','Roberto Vargas','Inversiones Andinas','roberto.vargas@inversiones.co','ACTIVE','DASHBOARD',NULL,'clients/inversiones/',7200,5,'2024-03-01T12:00:00Z',NULL)
ON CONFLICT (client_id) DO NOTHING;
```

> Decisión sobre `notification_email`: los mocks del frontend no incluyen `notificationEmail`, pero
> para los dos clientes `EMAIL` (`client-002`, `client-003`) se siembra `notification_email` = su
> `email`, coherente con la regla de validación (EMAIL requiere notificationEmail). Los clientes
> `DASHBOARD` llevan `NULL`.

Seis filas de `process_history` que replican exactamente `MOCK_PROCESSES` de
`process-history.service.ts` (todas de `client-001`), más — para cumplir "across a couple clients" —
se reasignan dos de ellas a otro cliente activo manteniendo nombres/fechas. **Decisión:** se mantienen
las 6 filas tal cual (`proc-001..006`) para `client-001` y se añaden 2 filas extra para `client-004`,
dejando 8 filas en total que cubren "un par de clientes" sin alterar los valores que el dashboard mock
muestra para `client-001`.

```sql
INSERT INTO process_history (process_id, client_id, file_name, file_type, file_size, status, input_s3_key, output_s3_key, download_url, error_message, created_at, completed_at) VALUES
('proc-001','client-001','ventas_enero_2024.csv','CSV',245760,'COMPLETED','clients/acme/proc-001/ventas_enero_2024.csv','clients/acme/proc-001/ventas_enero_2024_processed.csv','https://s3.amazonaws.com/bucket/ventas_enero_2024_processed.csv?X-Amz-Signature=mock',NULL,'2024-01-15T09:30:00Z','2024-01-15T09:35:22Z'),
('proc-002','client-001','clientes_q1_2024.json','JSON',98304,'COMPLETED','clients/acme/proc-002/clientes_q1_2024.json','clients/acme/proc-002/clientes_q1_2024_processed.json','https://s3.amazonaws.com/bucket/clientes_q1_2024_processed.json?X-Amz-Signature=mock',NULL,'2024-02-03T14:20:00Z','2024-02-03T14:23:45Z'),
('proc-003','client-001','facturas_2024.xlsx','XLSX',512000,'ERROR','clients/acme/proc-003/facturas_2024.xlsx',NULL,NULL,'El archivo contiene columnas no reconocidas en la fila 45. Por favor revise el formato.','2024-02-20T11:10:00Z','2024-02-20T11:11:30Z'),
('proc-004','client-001','inventario_marzo.csv','CSV',327680,'PROCESSING','clients/acme/proc-004/inventario_marzo.csv',NULL,NULL,NULL,'2024-03-10T08:45:00Z',NULL),
('proc-005','client-001','reporte_trimestral.xlsx','XLSX',1048576,'PENDING',NULL,NULL,NULL,NULL,'2024-03-12T16:00:00Z',NULL),
('proc-006','client-001','pedidos_febrero.json','JSON',163840,'COMPLETED','clients/acme/proc-006/pedidos_febrero.json','clients/acme/proc-006/pedidos_febrero_processed.json','https://s3.amazonaws.com/bucket/pedidos_febrero_processed.json?X-Amz-Signature=mock',NULL,'2024-02-28T10:00:00Z','2024-02-28T10:04:10Z'),
('proc-007','client-004','padron_clientes.csv','CSV',204800,'COMPLETED','clients/solucionespy/proc-007/padron_clientes.csv','clients/solucionespy/proc-007/padron_clientes_processed.csv','https://s3.amazonaws.com/bucket/padron_clientes_processed.csv?X-Amz-Signature=mock',NULL,'2024-03-08T13:00:00Z','2024-03-08T13:05:12Z'),
('proc-008','client-004','exportaciones_q1.xlsx','XLSX',655360,'PROCESSING','clients/solucionespy/proc-008/exportaciones_q1.xlsx',NULL,NULL,NULL,'2024-03-11T09:20:00Z',NULL)
ON CONFLICT (process_id) DO NOTHING;
```

---

## S3

Dos buckets creados por `provision.mjs`:

- `dataflow-input-local` — archivos subidos por el cliente (presigned PUT).
- `dataflow-output-local` — resultados (presigned GET).

Layout de clave: **`{s3Prefix}{processId}/{fileName}`** (p. ej. `clients/acme/proc-xyz/ventas.csv`),
que materializa el `{clientId}/{processId}/<filename>` del enunciado usando el `s3Prefix` por cliente
ya presente en los datos. Las presigned URLs se generan contra el endpoint de Floci; para que la URL
sea alcanzable desde el navegador se usa `forcePathStyle: true` y endpoint `http://localhost:4566` en
el cliente S3, de modo que la URL resultante apunte a `http://localhost:4566/dataflow-input-local/...`.

---

## Cognito (en Floci)

`provision.mjs` crea de forma idempotente:

- **User pool** `dataflow-pool`, creado con un **atributo custom `clientId`** en el `Schema`
  (`Name: 'clientId'`, `AttributeDataType: 'String'`, `Mutable: true`). Este atributo viaja en el
  id token como claim **`custom:clientId`** y es lo que usa el handler de `/processes` para aislar
  por tenant (ver "Detalle del handler Processes"). Se guarda su `Id` y su `Arn`.
- **Grupos** `admin` y `client` (`CreateGroup`).
- **App client** `dataflow-web` con `ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH','ALLOW_REFRESH_TOKEN_AUTH']`,
  **sin** `GenerateSecret` (sin client secret). Se asegura que `custom:clientId` esté en los
  `ReadAttributes` del app client para que se emita en el id token. Se guarda su `ClientId`.
- **Dos usuarios confirmados** con contraseña permanente (vía admin APIs, sin `FORCE_CHANGE_PASSWORD`):
  - `admin@dataflow.com` / `Admin123!` → grupo `admin` (no necesita `custom:clientId`; el admin
    consulta por query param).
  - `cliente@empresa.com` / `Cliente123!` → grupo `client`, con atributo
    **`custom:clientId = client-001`**. Este mapeo es lo que hace que el dashboard del cliente
    muestre los 6 procesos sembrados de `client-001` (resuelve el gap de wiring del dashboard).

  Flujo por usuario: `AdminCreateUser` con `MessageAction: 'SUPPRESS'` y atributos `email` +
  `email_verified=true` (+ `custom:clientId` para el cliente) → `AdminSetUserPassword` con
  `Permanent: true` → `AdminAddUserToGroup`. (Estas credenciales coinciden con los mocks del
  frontend y la tabla de `AGENTS.md`.)

> **Por qué un mapeo y no cambiar el seed:** los 5 clientes sembrados conservan sus
> `cognito_username` exactos de los mocks (`client-001` = `juan.garcia@acme.com`), por fidelidad
> con el frontend. El usuario de login de Cognito es `cliente@empresa.com` (credencial de prueba
> fijada por `AGENTS.md`), que **no** es ninguno de esos 5. En lugar de alterar el seed, se enlaza
> el usuario de login a un `clientId` existente vía el atributo `custom:clientId`. Así el dashboard
> se puebla sin romper ni los seeds ni el contrato del frontend.

Idempotencia: antes de crear, el script lista (`ListUserPools`, `ListGroups`, `ListUserPoolClients`,
`AdminGetUser`) y reutiliza lo que ya exista; si el usuario existe, re-aplica password+grupo.

### Salidas del aprovisionamiento

`provision.mjs` imprime y escribe en **`backend/.floci/outputs.json`**:

```json
{
  "userPoolId": "...",
  "appClientId": "...",
  "cognitoIssuer": "http://localhost:4566/<userPoolId>",
  "cognitoJwksUri": "http://localhost:4566/<userPoolId>/.well-known/jwks.json",
  "authorizerEnforced": true,
  "apiId": "...",
  "invokeUrl": "http://localhost:4566/restapis/<apiId>/local/_user_request_",
  "region": "us-east-1",
  "inputBucket": "dataflow-input-local",
  "outputBucket": "dataflow-output-local"
}
```

> `cognitoIssuer` y `cognitoJwksUri` se leen del documento de discovery OpenID (no se hardcodean).
> `authorizerEnforced` lo escribe el paso 9b: `true` si las aserciones negativas pasaron, `false`
> (y `provision.mjs` sale con error) si el autorizador dejó pasar un token inválido.

> `invokeUrl` sigue el formato de API Gateway en Floci/LocalStack:
> `http://localhost:4566/restapis/{apiId}/{stage}/_user_request_`. También se imprime la URL y las
> credenciales de prueba al terminar. El README documenta cómo copiar `invokeUrl`, `userPoolId` y
> `appClientId` a los `environment.*.ts`.

---

## API Gateway — rutas, público vs protegido

REST API `dataflow-api`, stage `local`, integraciones `AWS_PROXY`. Un recurso por segmento, con los
métodos indicados. Columna **Auth**: `COGNITO` = autorizador Cognito; `NONE` = público. Todas llevan
además `OPTIONS` (NONE, mock) para CORS.

| Recurso | Método | Auth | Lambda |
|---------|--------|------|--------|
| `/auth/login` | POST | NONE | `authLogin` |
| `/clients` | GET, POST | COGNITO (+grupo admin en handler) | `clients` |
| `/clients/{id}` | GET, PUT | COGNITO (+admin) | `clients` |
| `/clients/{id}/deactivate` | DELETE | COGNITO (+admin) | `clients` |
| `/processes` | GET | COGNITO | `processes` |
| `/processes/{processId}/retry` | POST | COGNITO | `processes` |
| `/files/presigned-upload` | POST | COGNITO | `files` |
| `/files/trigger` | POST | COGNITO | `files` |
| `/files/download/{processId}` | GET | COGNITO | `files` |

Decisión de empaquetado: **4 funciones Lambda** por dominio (`authLogin`, `clients`, `processes`,
`files`), cada una enruta internamente por `event.resource` + `event.httpMethod`. Se elige agrupar
por dominio (en vez de una Lambda por endpoint) para reducir el número de ZIPs/creaciones en Floci
y mantener el provisioning rápido, sin dejar de ser un router claro dentro de cada handler.

---

## Estructura de carpetas (`backend/`)

```
backend/
├── compose.yaml
├── Makefile
├── provision.mjs
├── package.json              # scripts npm equivalentes + deps de provisioning
├── README.md                 # en español
├── .floci/
│   └── outputs.json          # generado por provision.mjs (gitignore)
├── db/
│   └── init/
│       ├── 01_schema.sql
│       └── 02_seed.sql
└── lambdas/
    ├── common/
    │   ├── db.mjs            # Pool pg desde env + helpers rowTo*/toColumns
    │   ├── http.mjs         # cors(), json(status,body), parseBody, getClaims, groupsFrom, isAdmin
    │   └── validate.mjs     # validaciones por campo
    ├── auth-login/
    │   ├── package.json     # type:module, @aws-sdk/client-cognito-identity-provider
    │   └── index.mjs
    ├── clients/
    │   ├── package.json     # type:module, pg
    │   └── index.mjs
    ├── processes/
    │   ├── package.json     # type:module, pg
    │   └── index.mjs
    └── files/
        ├── package.json     # type:module, pg, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
        └── index.mjs
```

`common/` se copia dentro de cada ZIP de función en tiempo de empaquetado por `provision.mjs` (no
Layers). Esto evita la fragilidad de Layers en Floci y mantiene cada ZIP autónomo.

### Versiones fijadas (ejemplos, pinneadas exactas en cada `package.json`)

- `pg@8.13.1`
- `@aws-sdk/client-cognito-identity-provider@3.670.0`
- `@aws-sdk/client-s3@3.670.0`
- `@aws-sdk/s3-request-presigner@3.670.0`
- `@aws-sdk/client-api-gateway`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-s3`,
  `@aws-sdk/client-lambda`, `adm-zip@0.5.16` (solo en `backend/package.json` para provisioning).

(Las versiones concretas se congelan en la implementación; aquí se fija el criterio: pin exacto,
paquetes conocidos.)

---

## `compose.yaml` (forma de los servicios)

```yaml
services:
  floci:
    image: floci/floci:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=cognito-idp,apigateway,lambda,s3,iam,sts
      - LAMBDA_DOCKER_NETWORK=dataflow-net
      - DEBUG=1
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
    networks:
      - dataflow-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 5s
      retries: 20

  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=dataflow
      - POSTGRES_USER=dataflow
      - POSTGRES_PASSWORD=dataflow
    volumes:
      - "./db/init:/docker-entrypoint-initdb.d:ro"
      - "dataflow-pgdata:/var/lib/postgresql/data"
    networks:
      - dataflow-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dataflow -d dataflow"]
      interval: 5s
      timeout: 5s
      retries: 20

networks:
  dataflow-net:
    name: dataflow-net      # <- IMPRESCINDIBLE: evita el prefijo <project>_ de Compose
    driver: bridge

volumes:
  dataflow-pgdata:
```

> **Nombre de red fijado explícitamente (resuelve el bug de nuance B).** Docker Compose, por
> defecto, **prefija** el nombre de la red con el nombre del proyecto (p. ej.
> `backend_dataflow-net`). Floci lee `LAMBDA_DOCKER_NETWORK` como un **nombre literal de red
> Docker** y adjunta cada contenedor Lambda a esa red exacta. Si el valor
> (`LAMBDA_DOCKER_NETWORK=dataflow-net`) no coincide con el nombre real de la red, los
> contenedores Lambda no se unen a la red donde `postgres` resuelve por DNS y la conexión falla
> — justo el fallo que nuance B pretende evitar. Por eso se fija `name: dataflow-net` bajo la
> definición de la red: así el nombre real de la red Docker es `dataflow-net` sin prefijo y
> coincide **exactamente** con `LAMBDA_DOCKER_NETWORK=dataflow-net`. El `provision.mjs`
> verifica tras `compose up` que existe una red Docker llamada literalmente `dataflow-net`
> (`docker network inspect dataflow-net`) y aborta con mensaje accionable si no está, antes de
> crear Lambdas.

Notas:
- El healthcheck de Floci usa `/_localstack/health` (Floci es drop-in de LocalStack; si una versión
  expone otro path, el README indica el fallback `/health`). `provision.mjs` igualmente espera salud
  con reintentos propios, así que no depende solo del healthcheck de compose.
- El volumen `dataflow-pgdata` persiste datos; `make down` usa `compose down -v` para borrarlo y que
  los seeds vuelvan a correr en limpio.
- Montaje del socket Docker: imprescindible para que Floci lance contenedores Lambda.

---

## `provision.mjs` — responsabilidades (idempotente)

Orden de ejecución, cada paso "crear-o-reutilizar":

1. **Esperar Floci**: hacer polling a `http://localhost:4566/_localstack/health` hasta healthy
   (timeout ~120 s, backoff). También espera a Postgres (`pg_isready` vía TCP o un `SELECT 1`).
2. **Cognito**: crear/reutilizar pool `dataflow-pool` (con el atributo custom `clientId` en el
   `Schema`), grupos `admin`/`client`, app client `dataflow-web` (USER_PASSWORD_AUTH, sin secret,
   con `custom:clientId` en `ReadAttributes`), y los dos usuarios confirmados con password
   permanente y su grupo; al usuario `cliente@empresa.com` se le fija `custom:clientId=client-001`.
   Guardar `userPoolId`, `appClientId`, `providerArn`.
3. **Verificar issuer y discovery**: descargar `.well-known/openid-configuration`, leer `issuer` y
   `jwks_uri` reales; `InitiateAuth` de prueba con admin, decodificar id token, confirmar que `iss`
   coincide con el `issuer` del discovery (WARN + registro si difiere). Guardar `cognitoIssuer` y
   `cognitoJwksUri` en `outputs.json`.
4. **S3**: crear/reutilizar buckets `dataflow-input-local` y `dataflow-output-local`.
5. **Empaquetar Lambdas**: por cada función, copiar `common/` + fuente, `npm`/instalar deps pinneadas
   (o incluir `node_modules` precalculado), zippear con `adm-zip`.
6. **Crear/actualizar Lambdas** (`CreateFunction`/`UpdateFunctionCode`+`UpdateFunctionConfiguration`),
   runtime `nodejs20.x`, handler `index.handler`, con las env vars `PG*` (nuance B) y, para
   `auth-login`/`files`, `AWS_ENDPOINT_URL=http://localhost:4566`, `COGNITO_APP_CLIENT_ID`,
   `INPUT_BUCKET`, `OUTPUT_BUCKET`, `AWS_REGION=us-east-1`.
7. **API Gateway**: crear/reutilizar REST API `dataflow-api`; crear recursos y métodos de la tabla de
   rutas; crear el autorizador `COGNITO_USER_POOLS` (`providerARNs=[providerArn]`,
   identitySource `method.request.header.Authorization`); conectar métodos protegidos al autorizador y
   `/auth/login` como `NONE`; integraciones `AWS_PROXY` a cada Lambda; permisos `lambda:InvokeFunction`
   para API Gateway; `OPTIONS` mock + cabeceras CORS en cada recurso; `CreateDeployment` al stage `local`.
8. **Escribir salidas**: `backend/.floci/outputs.json` + impresión en consola (invokeUrl, userPoolId,
   appClientId, credenciales de prueba).
9. **Verificación end-to-end** (nuances A y B). Si cualquier aserción falla, salir con código ≠ 0 y
   mensaje accionable. Comprende tres bloques:

   **9a. Happy path (conectividad Lambda→Postgres, nuance B + id token aceptado, nuance A):**
   - Login admin (`POST /auth/login`) → `GET /clients` con `Authorization: Bearer <idToken>` →
     comprobar que devuelve los 5 clientes sembrados (si falla con 500 → problema de red
     Lambda→Postgres; apuntar al troubleshooting de `PGHOST`).
   - Login cliente (`cliente@empresa.com`) → `GET /processes` con su id token → comprobar que el
     handler, derivando el `clientId` del claim del token (ver nuance de dashboard, Finding 4),
     devuelve los 6 registros de ese cliente. (No se consulta `clientId=client-001` a mano: se
     ejerce el mismo camino que usa el dashboard.)

   **9b. Enforcement del autorizador (nuance A — aserciones NEGATIVAS, obligatorias):**
   - `GET /clients` **sin** cabecera `Authorization` → debe responder `401` (o `403`).
   - `GET /clients` con un id token **manipulado** (se toma el id token válido y se altera un byte
     del payload/firma) y con un token **expirado** (se puede forjar un JWT con `exp` en el pasado
     firmado con una clave distinta) → ambos deben responder `401`/`403`.
   - Si **cualquiera** de estas llamadas devuelve `200`, el autorizador Cognito de Floci **no está
     haciendo enforcement**: `provision.mjs` falla con un mensaje explícito ("el autorizador
     Cognito no valida tokens; las rutas protegidas quedarían abiertas — ver README
     troubleshooting / plan B authorizer Lambda") y escribe `authorizerEnforced: false` en
     `outputs.json`. Así una build de Floci que deje todo pasar **no** puede reportar
     "verificación OK".

   **9c. Autorización por grupo (nuance Finding 3):**
   - Login cliente → `GET /clients` con su id token (grupo `client`, no `admin`) → debe responder
     `403 { message: "Acceso denegado" }`. Verifica que el handler aplica correctamente el chequeo
     de grupo con el helper `groupsFrom` sobre el claim tal cual lo serializa el autorizador.

Idempotencia: re-ejecutar `provision.mjs` sobre un stack ya aprovisionado no duplica recursos ni
falla; actualiza código de Lambdas y vuelve a desplegar el stage.

---

## `Makefile` / scripts npm

| Target | Acción |
|--------|--------|
| `make up` | `docker compose up -d` |
| `make provision` | `node provision.mjs` |
| `make start` | `up` + espera salud + `provision` (flujo de un comando) |
| `make down` | `docker compose down -v` (borra volúmenes y red) |
| `make logs` | `docker compose logs -f` |
| `make seed` | re-ejecuta los SQL de seed contra Postgres (vía `psql` en el contenedor o `docker compose exec postgres psql`) sin recrear el contenedor |

`backend/package.json` replica estos como `scripts` (`npm run start`, `npm run provision`, etc.) para
quien prefiera npm. `make seed` ejecuta `02_seed.sql` con `ON CONFLICT DO NOTHING`, por lo que es
seguro repetir.

---

## `README.md` (en español) — contenido

Secciones: prerrequisitos (Docker 29 + Compose, Node 22, AWS CLI v2); arranque (`make start`);
invoke URL y de dónde sale (`outputs.json`); credenciales de prueba (tabla admin/cliente); cómo
encajan las piezas (diagrama Floci↔Postgres↔Lambda↔API GW↔frontend); troubleshooting con al menos:
(a) socket Docker no montado / permiso denegado, (b) Lambda no conecta a Postgres → explicar
`PGHOST=postgres`, el `name: dataflow-net` fijado en la red y el fallback `host.docker.internal`,
(c) issuer de Cognito distinto del esperado y cómo se resuelve el `jwks_uri` del discovery,
(d) CORS/preflight, y (e) **autorizador Cognito que no hace enforcement** (`authorizerEnforced:
false` en `outputs.json`): qué significa (rutas protegidas abiertas en local), por qué
`provision.mjs` falla, y el plan B (authorizer Lambda custom que valida la firma contra el
`jwks_uri` del discovery); y teardown (`make down`). Documenta la contraseña de Postgres como valor
de desarrollo local.

---

## Integración de frontend (único cambio permitido en `dataflow-app`)

Objetivo: mantener intacto el camino mock (default `useMock: true`) y añadir un camino "local backend".

### Switch de configuración

Se introduce **`authMode: 'mock' | 'local' | 'cognito'`** en los tres `environment*.ts`, además de
conservar `useMock` para no romper el interceptor ni los servicios de datos existentes. Relación:

- `useMock` sigue controlando los servicios de datos (`ClientService`, `ProcessHistoryService`) y el
  bypass del interceptor. Para el camino local se pondrá `useMock: false`.
- `authMode` controla **qué `IAuthService`** inyecta el factory.

Decisión: usar un enum `authMode` (más claro que apilar banderas booleanas), y derivar el
comportamiento del interceptor de `apiUrl` (ver abajo). `useMock` queda como está por defecto en
`development`/`ts` (`true`) para no alterar el arranque actual.

`environment.development.ts` (y `.ts`) tras la integración:

```typescript
export const environment = {
  production: false,
  useMock: true,            // sigue true por defecto (modo mock intacto)
  authMode: 'mock' as 'mock' | 'local' | 'cognito',
  apiUrl: 'http://localhost:4566/restapis/REPLACE_API_ID/local/_user_request_',
  cognito: {
    userPoolId: 'REPLACE_ME',
    userPoolClientId: 'REPLACE_ME',
    region: 'us-east-1'
  }
};
```

`environment.prod.ts`: igual estructura, `production: true`, `authMode: 'cognito'`, `useMock: false`.

Para activar el backend Floci local el desarrollador pone `useMock: false` y `authMode: 'local'`, y
pega `apiUrl`, `userPoolId`, `userPoolClientId` desde `backend/.floci/outputs.json`.

> **Dashboard del cliente en modo local:** `dashboard.component.ts` **no se modifica** (sigue
> llamando `getHistory('current-user-id')`). El flujo funciona porque el handler `GET /processes`
> ignora ese valor para el rol `client` y deriva el `clientId` del claim `custom:clientId` del id
> token (`cliente@empresa.com → client-001`), devolviendo los 6 procesos sembrados. El query param
> que viaja es irrelevante para el rol cliente; el aislamiento por tenant lo garantiza el backend.
> Esto se documenta también en el README y en `AGENTS.md`.

### `LocalAuthService` (`dataflow-app/src/app/core/auth/local-auth.service.ts`)

Implementa **toda** la interfaz `IAuthService` (contrato leído de `auth-service.interface.ts`).
El boceto declara **explícitamente** sus imports (`firstValueFrom` de `rxjs`) y el tipo de la
respuesta del backend (`LoginResponse`), de modo que compila tal cual:

```typescript
import { Injectable, inject, signal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IAuthService } from './auth-service.interface';
import { environment } from '../../../environments/environment';

interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  role: 'admin' | 'client';
  email: string;
}

@Injectable()
export class LocalAuthService implements IAuthService {
  private http = inject(HttpClient);
  private _currentUser = signal<{ email: string; role: 'admin' | 'client' } | null>(null);
  private idToken: string | null = null;

  get currentUser(): Signal<{ email: string; role: 'admin' | 'client' } | null> {
    return this._currentUser;
  }

  async signIn(email: string, password: string): Promise<void> {
    // POST {apiUrl}/auth/login  => { idToken, accessToken, refreshToken, role, email }
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      );
      this.idToken = res.idToken;
      this._currentUser.set({ email: res.email, role: res.role });
    } catch (err: any) {
      // HttpClient rechaza con HttpErrorResponse: su .message es el texto HTTP genérico de Angular;
      // el mensaje en español del backend viaja en .error.message. Re-lanzamos con ese texto para
      // que login.component.ts (que lee e.message) muestre "Credenciales incorrectas", igual que
      // MockAuthService. Así se preserva la paridad SIN tocar el componente de login.
      throw new Error(err?.error?.message ?? 'Credenciales incorrectas');
    }
  }

  async signOut(): Promise<void> { this.idToken = null; this._currentUser.set(null); }
  async getCurrentUser(): Promise<any> { return this._currentUser(); }
  async getUserRole(): Promise<'admin' | 'client'> { return this._currentUser()?.role ?? 'client'; }
  async getJwtToken(): Promise<string> { return this.idToken ?? ''; }   // interceptor usa idToken
  async isAuthenticated(): Promise<boolean> { return this._currentUser() !== null; }
}
```

- La forma de `currentUser` (`{ email, role }`) coincide con `MockAuthService`, así guards y login
  component (que llaman `signIn` → `getUserRole`) funcionan sin cambios.
- `getJwtToken()` devuelve el **idToken** guardado, que es lo que el autorizador Cognito acepta
  (nuance A).
- **Mapeo del error 401 (paridad con mock):** `login.component.ts` hace
  `this.errorMessage.set(e?.message ?? 'Error al iniciar sesión')`, es decir lee `e.message`. Ante un
  `401`, `HttpClient` rechaza con un `HttpErrorResponse` cuyo `.message` es el texto HTTP genérico de
  Angular; el `{ message: "Credenciales incorrectas" }` del backend está en `.error.message`. Por eso
  `signIn` envuelve la llamada en `try/catch` y **re-lanza** `new Error(err?.error?.message ?? 'Credenciales incorrectas')`,
  de modo que el usuario ve exactamente "Credenciales incorrectas" en modo local, igual que en mock,
  sin modificar `login.component.ts`.

### Factory `AUTH_SERVICE` en `app.config.ts`

```typescript
{
  provide: AUTH_SERVICE,
  useFactory: () => {
    switch (environment.authMode) {
      case 'local':   return new LocalAuthService();   // backend Floci local
      case 'cognito': return new AuthService();         // Amplify real
      default:        return new MockAuthService();     // mock (default)
    }
  }
}
```

**Mecanismo único (sin providers de clase extra ni `deps`):** se mantiene exactamente el patrón que
el repo ya usa hoy — un `switch` dentro de `useFactory` que hace `new LocalAuthService()` /
`new AuthService()` / `new MockAuthService()`. `useFactory` corre **en contexto de inyección**, así
que el inicializador de campo `private http = inject(HttpClient)` de `LocalAuthService` resuelve
correctamente con `new` (el `HttpClient` ya está provisto por `provideHttpClient`). No hace falta
registrar las tres clases como providers, ni declarar `deps`, ni cambiar el factory a otro
mecanismo: el boceto de arriba es la implementación completa.

### `authInterceptor`

Hoy hace bypass total si `environment.useMock`. Se ajusta mínimamente para que **solo adjunte el
token a peticiones dirigidas a `apiUrl`** y siga haciendo bypass en mock:

```typescript
if (environment.useMock) return next(req);
if (!req.url.startsWith(environment.apiUrl)) return next(req);  // solo apiUrl
// ...resto igual: adjunta Authorization: Bearer <idToken>
```

Esto evita mandar el token a terceros (p. ej. las presigned URLs apuntan a `:4566/dataflow-input-local`,
que **no** empiezan por `apiUrl`, así que el PUT a S3 va sin cabecera `Authorization`, como debe ser).

### Documentación en `AGENTS.md`

Se amplían las secciones **5** (modo de ejecución) y **10** (cómo pasar a backend real) para describir
el tercer modo `authMode: 'local'` y los pasos: `cd backend && make start`, copiar `invokeUrl`/
`userPoolId`/`userPoolClientId` de `outputs.json` a los environment, poner `useMock:false` +
`authMode:'local'`, `ng serve`. Se añade la tabla de credenciales (idénticas al mock).

---

## Manejo de errores (por operación)

| Operación | Condición de fallo | ¿Fatal? | Qué recibe el llamador | Log |
|-----------|--------------------|---------|------------------------|-----|
| `/auth/login` | body inválido | recuperable | `400 { message }` | WARN |
| `/auth/login` | `NotAuthorized`/`UserNotFound` | recuperable | `401 { message:"Credenciales incorrectas" }` | WARN (sin password) |
| `/auth/login` | Cognito/Floci caído | fatal (de la petición) | `502 { message:"Error de autenticación" }` | ERROR |
| rutas protegidas | token ausente/ inválido/ expirado | recuperable | `401` (lo emite el autorizador, no el handler) | — (API GW) |
| `/clients*` | token válido pero sin grupo `admin` | recuperable | `403 { message:"Acceso denegado" }` | WARN |
| `GET /clients/{id}` etc. | id inexistente | recuperable | `404 { message:"Cliente no encontrado" }` | INFO |
| `POST/PUT /clients` | validación de campo | recuperable | `400 { message, errors }` | WARN |
| cualquier handler | error de conexión Postgres | fatal (de la petición) | `500 { message:"Error interno" }` | ERROR (con stack en logs Lambda, sin datos sensibles) |
| `GET /processes` (rol admin) | falta `clientId` query param | recuperable | `400 { message:"clientId es obligatorio" }` | WARN |
| `GET /processes` (rol client) | falta claim `custom:clientId` | recuperable | `403 { message:"Acceso denegado" }` (el query param se ignora, nunca `400`) | WARN |
| `/files/presigned-upload` | cliente/campos inválidos | recuperable | `400`/`404` | WARN |
| `/files/download/{processId}` | sin `output_s3_key` | recuperable | `404 { message:"Documento no disponible" }` | INFO |
| `/files/*` | fallo al generar presigned (S3/Floci) | fatal (de la petición) | `500 { message:"Error interno" }` | ERROR |

Reglas transversales: todo handler envuelve su lógica en try/catch; cualquier excepción no prevista →
`500 { message:"Error interno" }` + log ERROR con el stack (nunca se filtran credenciales ni el
password del login). Todas las respuestas (éxito y error) llevan cabeceras CORS. Los `message` de
cara al cliente van en español.

### Invariantes y qué capa los posee

- **Rol = grupos Cognito** (invariante de autenticación): lo posee Cognito/Floci (emite el claim) y lo
  aplica el handler `/clients*` (grupo `admin`). Razón: el autorizador solo autentica; la autorización
  por rol es lógica de negocio del handler.
- **FK `process_history.client_id → clients.client_id`**: la posee Postgres (constraint). Razón: evita
  procesos huérfanos aunque un handler tenga un bug.
- **Enums `status`/`delivery_method`/`file_type`**: doble propiedad — validación en el handler (mensaje
  amigable) + `CHECK` en Postgres (red de seguridad). Razón: feedback claro al usuario y consistencia
  garantizada en BD.
- **`s3Prefix` termina en `/`**: lo posee el handler de clients (normalización en create/update).
  Razón: el layout de clave S3 depende de ello.
- **`status` tras acciones**: `deactivate`→`INACTIVE`, `retry`→`PENDING`, `trigger`→`PROCESSING`: los
  poseen los handlers correspondientes (UPDATE directo).

---

## Testabilidad

- **Unit test (sin Docker)**: funciones puras de `common/` — `rowToClient`/`rowToProcess`/
  `clientBodyToColumns` (mapeo snake↔camel), `validate.mjs` (reglas por campo), el router por
  `resource`+`method`, la decodificación del payload del id token (`cognito:groups`→role) y, de
  forma destacada, **`groupsFrom`/`isAdmin`** de `common/http.mjs`: casos array (`["admin"]`),
  string con corchetes (`"[admin]"`), separado por comas (`"admin,client"`), separado por espacios,
  cadena vacía, `null`/`undefined`, y el caso trampa `"admin-readonly"` que **no** debe dar `admin`.
  Como login y handlers protegidos usan el **mismo** helper, el test cubre ambos caminos. Son el
  grueso de la lógica y no requieren red.
- **Integración (con el stack arriba)**: la verificación end-to-end de `provision.mjs` (paso 9) actúa
  como test de integración ejecutable: login admin/cliente, `GET /clients` (5), `GET /processes` (6),
  y un ciclo presigned-upload→trigger→download. Comprueba de paso la conectividad Lambda→Postgres
  (nuance B) y la aceptación del id token por el autorizador (nuance A).
- **Frontend**: `LocalAuthService` es testeable con `HttpTestingController` (mock de
  `POST /auth/login`), verificando que `getJwtToken()` devuelve el `idToken` y `currentUser()` la forma
  `{ email, role }`.

Un diseño con los mapeos y validaciones aislados en `common/` mantiene la parte difícil de testear
(red, Docker) reducida a la verificación de integración del provisioning.

---

## Casos borde

- Re-ejecutar `provision.mjs` (idempotencia) sobre recursos ya creados.
- `make down -v` y re-`start`: los seeds vuelven a cargarse en Postgres limpio.
- Usuario en **ambos** grupos: `role='admin'` gana (regla `includes('admin')`).
- `GET /processes` sin `clientId`: para **admin** → `400` (no se listan procesos de todos); para
  **client** el query param es irrelevante y el `clientId` sale del claim `custom:clientId` (si el
  claim falta → `403`).
- Cliente `INACTIVE` (`client-003`): sigue listándose en admin; su login funcionaría si existiera en
  Cognito (solo se siembran los 2 usuarios de prueba; los 5 clientes son filas de BD, no usuarios
  Cognito — coherente con el mock).
- `fileName` con `/` o `..` → 400 (evita path traversal en la clave S3).
- Presigned URL expira según `url_expiration` del cliente (p. ej. `client-004` = 14400 s).
- Token expirado en ruta protegida → 401 del autorizador; el frontend redirige a login vía guard.
- Floci emite issuer con host distinto a `localhost` → detectado en el paso 3 y documentado.

---

## Fuera de alcance

- Invocación real de **AgentCore Runtime** (solo stub comentado en `/files/trigger`).
- Notificación por **SES/correo** (el `deliveryMethod=EMAIL` se almacena pero no envía correos).
- Despliegue a **AWS real** (este backend es exclusivamente local con Floci).
- Procesamiento real de archivos (CSV/JSON/XLSX): no se transforma contenido; el pipeline queda
  preparado para que AgentCore lo haga.
- Verificación de firma JWT dentro del handler de login (la hace el autorizador en rutas protegidas).
- Paginación server-side, WebSockets/polling en tiempo real, y cambios de UI en `dataflow-app` más
  allá de la integración acotada de la sección 12.
- Tests automatizados del frontend más allá de lo señalado como testeable (no se añade suite nueva).

---

## Respuestas a la revisión de diseño (iteración 2)

Revisión de referencia: `.agents/tasks/floci-backend-local/design-review.md`
(`design-review.json`, veredicto `CHANGES_REQUESTED`: 1 HIGH + 3 MEDIUM + 2 NIT).

### Finding 1 — [HIGH] El prefijo de proyecto de Compose rompe `LAMBDA_DOCKER_NETWORK` — **RESUELTO**

Se añadió `name: dataflow-net` bajo la definición de la red en `compose.yaml`, de modo que el
nombre real de la red Docker es `dataflow-net` sin el prefijo `<project>_`, y coincide
**exactamente** con `LAMBDA_DOCKER_NETWORK=dataflow-net`. Nuance B (pasos 1–4) se actualizó para
reflejarlo y `provision.mjs` verifica con `docker network inspect dataflow-net` que la red existe
con ese nombre literal antes de crear Lambdas, abortando con mensaje accionable si falta. El
fallback `host.docker.internal` sigue documentado como camino secundario.

### Finding 2 — [MEDIUM] Verificación del autorizador sólo en happy-path — **RESUELTO**

(a) Se dejó de afirmar como hecho que Floci hace enforcement; se marca como **no asumido** y se
**prueba**. El paso 9 de `provision.mjs` ahora tiene tres bloques: 9a happy-path, **9b aserciones
negativas** (sin token y con token manipulado/expirado deben dar `401`/`403`; si alguno da `200`,
`provision.mjs` falla, escribe `authorizerEnforced: false` y el README documenta el riesgo y el
plan B de authorizer Lambda custom), y 9c autorización por grupo. (b) La ruta del JWKS ya **no se
hardcodea**: se resuelve `issuer` y `jwks_uri` del documento de discovery OpenID y se registran en
`outputs.json` (`cognitoIssuer`, `cognitoJwksUri`).

### Finding 3 — [MEDIUM] Parsing de `cognito:groups` sin especificar y divergente — **RESUELTO**

Se define **un único helper** `groupsFrom` (array|string → `string[]`) e `isAdmin` en
`common/http.mjs`, usado **tanto** por `/auth/login` (decodificación del id token) **como** por los
handlers protegidos (claims del autorizador). Compara tokens exactos (nunca substring, elimina el
falso positivo `admin-readonly`). Se fija su comportamiento con unit tests enumerados en
Testabilidad (array, `"[admin]"`, coma, espacio, vacío, `null`, `admin-readonly`).

### Finding 4 — [MEDIUM] Dashboard del cliente vacío en modo local — **RESUELTO (opción preferida)**

El handler `GET /processes` deriva el `clientId` del claim del token para el rol `client`
(ignorando el query param `current-user-id` que manda el dashboard) y lo exige por query param sólo
al admin; esto implementa además el aislamiento por tenant de `AGENTS.md` §8. Se añade el atributo
custom `clientId` al user pool y se fija `custom:clientId=client-001` al usuario
`cliente@empresa.com`, de modo que el dashboard muestra los 6 procesos sembrados de `client-001`
**sin tocar** `dashboard.component.ts`. El paso 9a de verificación se cambió para ejercer el mismo
camino que el dashboard (login cliente → `GET /processes` con su token → 6 registros), en vez de
consultar `clientId=client-001` a mano, de modo que ya no enmascara el comportamiento real.

### Finding 5 — [NIT] `/files/*` sin llamador en el frontend — **RESUELTO (aclarado)**

Se añadió una nota explícita: sólo auth/clients/processes tienen consumidor real; `file-upload`
sigue simulado y los endpoints de Files se **aprovisionan por adelantado**, no por empatar un
llamador actual.

### Finding 6 — [NIT] Layout de clave S3 difiere de AGENTS.md — **ACEPTADO (se mantiene)**

Se conserva `{s3Prefix}{processId}/{fileName}`, coherente con los `input_s3_key` sembrados y
documentado como materialización del `{clientId}/{processId}/<archivo>` usando el `s3Prefix` por
cliente. El review lo marcó sólo para trazabilidad; no es bloqueante.

---

## Respuestas a la revisión de diseño (iteración 3)

Revisión de referencia: `.agents/tasks/floci-backend-local/design-review.md`
(`design-review.json`, veredicto `CHANGES_REQUESTED`: 0 HIGH, 2 MEDIUM, 2 NIT). Las dos nuances
(A autorizador Cognito/id token, B red Lambda→Postgres) se declararon resueltas por el revisor; los
hallazgos restantes están todos en la integración de frontend acotada (sección 12).

### Finding 1 — [MEDIUM] `LocalAuthService` no mapea el cuerpo 401 al mensaje del login — **RESUELTO**

`LocalAuthService.signIn` ahora envuelve la llamada en `try/catch` y re-lanza
`new Error(err?.error?.message ?? 'Credenciales incorrectas')`. Como `login.component.ts` lee
`e.message`, el usuario ve el texto en español del backend (que llega en `err.error.message` dentro
del `HttpErrorResponse`), preservando la paridad con `MockAuthService` **sin** tocar el componente
de login. El boceto de la sección 12 y la nota adjunta se actualizaron con el `try/catch` y la
explicación del porqué (`.message` genérico vs `.error.message`).

### Finding 2 — [MEDIUM] Conflicto en la validación de `clientId` en `GET /processes` — **RESUELTO**

Se condicionó la regla por rol en los tres lugares que la mencionaban:
- "Validación de entrada": admin → `clientId` obligatorio (`400` si falta); client → se ignora el
  query param y se deriva de `custom:clientId` (`403` si el claim falta, nunca `400`).
- Tabla "Manejo de errores": se reemplazó la fila única por dos filas (admin `400` / client `403`).
- "Casos borde": se aclaró el comportamiento por rol.
Con esto desaparece la contradicción con "Detalle del handler Processes" y queda imposible que un
implementador meta un chequeo de presencia de `clientId` antes de resolver el rol (lo que habría
roto el aislamiento por tenant para el cliente).

### Finding 3 — [NIT] Prosa ambigua sobre el cableado del factory `AUTH_SERVICE` — **RESUELTO**

Se eliminó la frase contradictoria ("registrar las tres como providers y seleccionar con `useFactory`
que llama `inject()`"). Queda un **único mecanismo**: el `switch` dentro de `useFactory` con
`new LocalAuthService()`/`new AuthService()`/`new MockAuthService()`, idéntico al patrón actual del
repo; se explica que `useFactory` corre en contexto de inyección y por eso el `inject(HttpClient)`
del campo de `LocalAuthService` resuelve con `new`, sin `deps` ni providers de clase adicionales.

### Finding 4 — [NIT] Boceto de `LocalAuthService` incompleto (`LoginResponse`, `firstValueFrom`) — **RESUELTO**

El boceto ahora incluye el bloque de `import` completo (incluido `import { firstValueFrom } from 'rxjs'`)
y la declaración `interface LoginResponse { idToken; accessToken; refreshToken; role; email }`, de
modo que compila tal cual sin que el implementador tenga que inferir tipos ni imports.
