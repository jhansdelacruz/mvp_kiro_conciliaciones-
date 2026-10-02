# Implementation Plan — Backend LOCAL de DataFlow (Floci + PostgreSQL)

> Fuente: diseño aprobado `.agents/tasks/floci-backend-local/design.md` (review `design-review.md`, veredicto APPROVED).
> Todo lo nuevo vive bajo `/Users/jhansdelacruz/Documents/kiro/mvp/backend`. El ÚNICO cambio permitido en
> `dataflow-app` es la integración acotada de la sección 12 del diseño (fase E). El modo mock
> (`useMock: true`, `authMode: 'mock'`) sigue siendo el default y no se rompe.
>
> Nota de divergencia (trazabilidad, no bloqueante): el skill `servidor-local-pruebas` describe un
> backend Pulumi + Lambda Layers con nomenclatura "warden". El diseño APROBADO eligió explícitamente
> otro enfoque autocontenido (un `provision.mjs` en Node con AWS SDK v3, `common/` copiado en cada ZIP,
> sin Pulumi ni Layers, 4 Lambdas por dominio). Este plan sigue el diseño aprobado, que es la fuente
> autoritativa; no se usa Pulumi ni la convención de nombres de 16 caracteres.
>
> Herramientas verificadas en la máquina: `docker` (/usr/local/bin/docker), `node` v22, `npm`, `make`.
> Comando de build del frontend: `npm run build` (= `ng build`); puede emitir warnings de *budget* (no son errores).
> Tests unitarios del backend: `node --test` (runner nativo de Node 22, sin dependencias extra) — decisión del plan.

---

## Fase A — Scaffolding e infraestructura del backend

- [ ] 1. Crear `backend/package.json` (deps de aprovisionamiento + scripts npm) y `backend/.gitignore`.
      `package.json`: `"type":"module"`, deps pinneadas exactas para provisioning:
      `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-api-gateway`, `@aws-sdk/client-s3`,
      `@aws-sdk/client-lambda`, `@aws-sdk/client-iam`, `@aws-sdk/s3-request-presigner`, `adm-zip@0.5.16`;
      scripts: `up`, `provision`, `start`, `down`, `logs`, `seed`, `test` (espejo del Makefile; `test` =
      `node --test lambdas/common/`). `.gitignore`: `.floci/`, `**/node_modules/`, `**/*.zip`.
      Files: `backend/package.json`, `backend/.gitignore`
      Verify: `cd backend && npm install && node -e "import('@aws-sdk/client-cognito-identity-provider').then(()=>console.log('ok'))"` imprime `ok`.

- [ ] 2. Crear `backend/compose.yaml` con los servicios `floci` y `postgres` en la red `dataflow-net`.
      Copiar la forma exacta de la sección "compose.yaml" del diseño: servicio `floci`
      (`floci/floci:latest`, puerto `4566:4566`, `SERVICES=cognito-idp,apigateway,lambda,s3,iam,sts`,
      `LAMBDA_DOCKER_NETWORK=dataflow-net`, `DEBUG=1`, montaje `/var/run/docker.sock`, healthcheck a
      `/_localstack/health`); servicio `postgres` (`postgres:16`, `5432:5432`, env `POSTGRES_DB/USER/PASSWORD=dataflow`,
      monta `./db/init:/docker-entrypoint-initdb.d:ro` y el volumen `dataflow-pgdata`, healthcheck `pg_isready`);
      red `dataflow-net` con **`name: dataflow-net`** (imprescindible, evita el prefijo `<project>_`); volumen `dataflow-pgdata`.
      Files: `backend/compose.yaml`
      Verify: `cd backend && docker compose config` valida sin error y muestra la red con `name: dataflow-net`.

- [ ] 3. Crear el SQL de inicialización: esquema + seed en español (valores EXACTOS de los mocks).
      `01_schema.sql`: tablas `clients` y `process_history` con los CHECK de enums, FK
      `process_history.client_id → clients.client_id`, índice `idx_process_history_client` (copiar del diseño).
      `02_seed.sql`: 5 clientes idénticos a `MOCK_CLIENTS` de `client.service.ts` (incluye `client-003`
      GlobalCorp INACTIVE; `notification_email` = email para `client-002`/`client-003` EMAIL, NULL para
      DASHBOARD) + 8 filas de `process_history` (`proc-001..006` → `client-001` idénticas a `MOCK_PROCESSES`
      de `process-history.service.ts`, más `proc-007`/`proc-008` → `client-004`). Ambos INSERT con
      `ON CONFLICT ... DO NOTHING`. Usar los bloques SQL literales del diseño.
      Files: `backend/db/init/01_schema.sql`, `backend/db/init/02_seed.sql`
      Verify: `cd backend && docker compose up -d postgres` y luego
      `docker compose exec -T postgres psql -U dataflow -d dataflow -c "SELECT count(*) FROM clients; SELECT count(*) FROM process_history;"`
      devuelve 5 y 8; después `docker compose down -v`.

## Fase B — Librerías compartidas y handlers Lambda

- [ ] 4. Crear la librería compartida `backend/lambdas/common/` (3 módulos) con sus tests unitarios.
      `http.mjs`: `cors()`, `json(status, body)` (incluye cabeceras CORS en todas las respuestas), `parseBody(event)`,
      `getClaims(event)`, `groupsFrom(claim)` (array | string con corchetes | coma | espacio → `string[]`, match
      exacto de token), `isAdmin(claims)` (copiar el helper del diseño). `db.mjs`: `Pool` de `pg` a nivel de módulo
      desde env `PG*` (`max: 1`), + `rowToClient`, `clientBodyToColumns`, `rowToProcess` (mapeo snake↔camel exacto
      de las tablas del diseño; `timestamptz`→`.toISOString()`; omitir campos `null`; `input_s3_key`/`output_s3_key`
      internos, no se exponen). `validate.mjs`: validaciones por campo del diseño (login, ClientFormData, files).
      Tests con `node:test` en `common/*.test.mjs`: `groupsFrom`/`isAdmin` (array `["admin"]`, `"[admin]"`, coma,
      espacio, vacío, `null`, y el caso trampa `"admin-readonly"` que NO es admin), `rowToClient`/`clientBodyToColumns`/
      `rowToProcess`, reglas de `validate.mjs`, y decodificación del payload del id token (base64url → role).
      Files: `backend/lambdas/common/http.mjs`, `backend/lambdas/common/db.mjs`, `backend/lambdas/common/validate.mjs`,
      `backend/lambdas/common/http.test.mjs`, `backend/lambdas/common/validate.test.mjs`, `backend/lambdas/common/db.test.mjs`
      Verify: `cd backend && node --test lambdas/common/` — todos los tests pasan (NO requiere Docker).

- [ ] 5. Crear el handler `auth-login` (público, POST `/auth/login`).
      `index.mjs`: valida body (`email`/`password` → `400 { message:"email y password son obligatorios" }`);
      `InitiateAuth` `USER_PASSWORD_AUTH` con `ClientId=COGNITO_APP_CLIENT_ID` y SDK apuntado a
      `AWS_ENDPOINT_URL`; decodifica el payload del IdToken (base64url) y deriva `role` con `groupsFrom(...).includes('admin')`
      de `common/http.mjs`; responde `200 { idToken, accessToken, refreshToken, role, email }`;
      `NotAuthorized`/`UserNotFound` → `401 { message:"Credenciales incorrectas" }`; Cognito caído → `502 { message:"Error de autenticación" }`.
      `package.json`: `"type":"module"`, dep `@aws-sdk/client-cognito-identity-provider` pinneada. NO añadir `jsonwebtoken`.
      Files: `backend/lambdas/auth-login/index.mjs`, `backend/lambdas/auth-login/package.json`
      Verify: `cd backend && node --check lambdas/auth-login/index.mjs` (sintaxis OK); la prueba funcional real es la fase F (9a/login).

- [ ] 6. Crear el handler `clients` (protegido admin; GET/POST `/clients`, GET/PUT `/clients/{id}`, DELETE `/clients/{id}/deactivate`).
      Router interno por `event.resource` + `event.httpMethod`. Chequeo de grupo: `if (!isAdmin(getClaims(event))) → 403 { message:"Acceso denegado" }`.
      Operaciones contra Postgres con `rowToClient`/`clientBodyToColumns`: GET lista (`200 Client[]`), GET por id (`404 { message:"Cliente no encontrado" }` si falta),
      POST (`cognito_username=email`, normaliza `s3Prefix` para terminar en `/`, `201 Client`), PUT (`200`/`404`),
      deactivate (`UPDATE status='INACTIVE'`, `204` sin body). Validación de `ClientFormData` vía `validate.mjs` (`400 { message, errors }`).
      Error de conexión PG → `500 { message:"Error interno" }`. `package.json`: `"type":"module"`, dep `pg` pinneada.
      Files: `backend/lambdas/clients/index.mjs`, `backend/lambdas/clients/package.json`
      Verify: `cd backend && node --check lambdas/clients/index.mjs`; prueba funcional en fase F (9a/9c).

- [ ] 7. Crear el handler `processes` (protegido; GET `/processes`, POST `/processes/{processId}/retry`).
      Resolución de `clientId` por rol (crítico): admin → `clientId` del query param (`400 { message:"clientId es obligatorio" }` si falta);
      client → `clientId = claims['custom:clientId']` IGNORANDO el query param (`403 { message:"Acceso denegado" }` si el claim falta).
      GET: `SELECT ... FROM process_history WHERE client_id=$1 ORDER BY created_at DESC` → `200 ProcessRecord[]` con `rowToProcess`.
      retry: mismo criterio de autorización por `client_id`; `UPDATE status='PENDING', error_message=NULL`; `204`.
      `package.json`: `"type":"module"`, dep `pg` pinneada.
      Files: `backend/lambdas/processes/index.mjs`, `backend/lambdas/processes/package.json`
      Verify: `cd backend && node --check lambdas/processes/index.mjs`; prueba funcional en fase F (9a cliente).

- [ ] 8. Crear el handler `files` (protegido; POST `/files/presigned-upload`, POST `/files/trigger`, GET `/files/download/{processId}`).
      `presigned-upload`: valida (`clientId` existente, `fileName` sin `/`/`..` 1..255, `fileType` CSV|JSON|XLSX, `fileSize` 1..52428800);
      `processId="proc-"+randomUUID()`; busca `s3_prefix` del cliente; `key={s3Prefix}{processId}/{fileName}`; presigned PUT
      sobre `INPUT_BUCKET` con expiración = `url_expiration`; `200 { url, key, processId }`. `trigger`: inserta fila `process_history`
      con `status='PROCESSING'`, `input_s3_key=key`, `created_at=now()`; incluir comentario stub AgentCore; `200 { processId, status:'PROCESSING' }`.
      `download/{processId}`: lee `output_s3_key`; si existe presigned GET sobre `OUTPUT_BUCKET` → `200 { url }`; si no → `404 { message:"Documento no disponible" }`.
      Cliente S3 con `endpoint=AWS_ENDPOINT_URL` y `forcePathStyle:true`. `package.json`: `"type":"module"`, deps `pg`,
      `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` pinneadas.
      Files: `backend/lambdas/files/index.mjs`, `backend/lambdas/files/package.json`
      Verify: `cd backend && node --check lambdas/files/index.mjs`; prueba funcional en fase F (ciclo presigned→trigger→download).

## Fase C — Aprovisionamiento idempotente y orquestación

- [ ] 9. Crear `backend/provision.mjs` (idempotente, pasos 1–8 del diseño, sin la verificación e2e).
      Node ESM con `@aws-sdk/*` v3 apuntando a `AWS_ENDPOINT_URL=http://localhost:4566` (`PGHOST` leído de env, default `postgres`).
      (1) esperar salud de Floci (`/_localstack/health`, fallback `/health`, backoff ~120s) y Postgres; verificar
      `docker network inspect dataflow-net` (abortar accionable si falta). (2) Cognito crear-o-reutilizar: pool `dataflow-pool`
      con atributo custom `clientId` en Schema, grupos `admin`/`client`, app client `dataflow-web` (USER_PASSWORD_AUTH, sin secret,
      `custom:clientId` en ReadAttributes), 2 usuarios confirmados (`admin@dataflow.com`/`Admin123!`→admin;
      `cliente@empresa.com`/`Cliente123!`→client con `custom:clientId=client-001`) vía `AdminCreateUser`(SUPPRESS)+`AdminSetUserPassword`(Permanent)+`AdminAddUserToGroup`.
      (3) issuer/discovery: descargar `.well-known/openid-configuration`, leer `issuer`+`jwks_uri` (fallback `.../jwks.json`+WARN),
      `InitiateAuth` de prueba con admin, confirmar `iss`. (4) S3: buckets `dataflow-input-local`/`dataflow-output-local`.
      (5) empaquetar Lambdas: por función `npm ci --omit=dev` + copiar `common/` + zippear con `adm-zip`.
      (6) crear/actualizar 4 funciones `nodejs20.x` handler `index.handler` con env `PG*` (nuance B) y, para auth-login/files,
      `AWS_ENDPOINT_URL`, `COGNITO_APP_CLIENT_ID`, `INPUT_BUCKET`, `OUTPUT_BUCKET`, `AWS_REGION=us-east-1`.
      (7) API Gateway `dataflow-api` stage `local`: recursos/métodos de la tabla de rutas, autorizador `COGNITO_USER_POOLS`
      (`providerARNs=[providerArn]`, identitySource `method.request.header.Authorization`), `/auth/login` NONE, integraciones
      `AWS_PROXY`, permisos `lambda:InvokeFunction`, `OPTIONS` mock + CORS por recurso, `CreateDeployment`. (8) escribir
      `backend/.floci/outputs.json` (userPoolId, appClientId, cognitoIssuer, cognitoJwksUri, authorizerEnforced, apiId, invokeUrl, region, inputBucket, outputBucket) + imprimir credenciales.
      Files: `backend/provision.mjs`
      Verify: `cd backend && node --check provision.mjs` (sintaxis OK); ejecución real + idempotencia en fase F.

- [ ] 10. Añadir el bloque de verificación e2e (paso 9 del diseño) a `provision.mjs`.
      Al final de `provision.mjs`, tras escribir outputs: **9a** login admin → `GET /clients` con `Bearer <idToken>` → 5 clientes
      (fallo 500 ⇒ problema de red Lambda→Postgres, apuntar a troubleshooting PGHOST); login `cliente@empresa.com` → `GET /processes`
      con su id token (sin pasar clientId a mano) → 6 registros de `client-001`. **9b** aserciones NEGATIVAS: `GET /clients` sin
      `Authorization` → `401`/`403`; con id token manipulado (byte alterado) y con token de firma inválida → `401`/`403`; si alguna
      da `200` ⇒ escribir `authorizerEnforced:false` y salir con error accionable (plan B authorizer Lambda custom). **9c**
      login cliente → `GET /clients` con su token (grupo client) → `403 { message:"Acceso denegado" }`. Cualquier aserción fallida ⇒ exit ≠ 0.
      Files: `backend/provision.mjs`
      Verify: `cd backend && node --check provision.mjs`; la ejecución real es la fase F.

- [ ] 11. Crear `backend/Makefile` con los targets del diseño.
      `up` (`docker compose up -d`), `provision` (`node provision.mjs`), `start` (`up` + espera salud + `provision`),
      `down` (`docker compose down -v`), `logs` (`docker compose logs -f`), `seed` (re-ejecuta `02_seed.sql` vía
      `docker compose exec postgres psql`, seguro por `ON CONFLICT DO NOTHING`). Deben coincidir con los scripts npm del paso 1.
      Files: `backend/Makefile`
      Verify: `cd backend && make -n start` imprime la secuencia `up` → espera → `provision` sin ejecutarla.

## Fase D — Documentación

- [ ] 12. Crear `backend/README.md` en español.
      Secciones del diseño: prerrequisitos (Docker + Compose, Node 22, AWS CLI v2); arranque (`make start`); invoke URL y de
      dónde sale (`outputs.json`); tabla de credenciales de prueba (admin/cliente, idénticas al mock); diagrama Floci↔Postgres↔Lambda↔API GW↔frontend;
      troubleshooting: (a) socket Docker no montado, (b) Lambda no conecta a Postgres (`PGHOST=postgres`, `name: dataflow-net`, fallback `host.docker.internal`),
      (c) issuer de Cognito distinto / `jwks_uri` del discovery, (d) CORS/preflight, (e) autorizador sin enforcement
      (`authorizerEnforced:false`) y plan B; nota sobre `custom:clientId=client-001` que puebla el dashboard; teardown (`make down`);
      la contraseña de Postgres documentada como valor de desarrollo local. También documentar que la validación de `exp` con firma
      válida no es testeable localmente sin la clave del pool.
      Files: `backend/README.md`
      Verify: lectura manual; confirmar que todas las secciones (a)–(e) y la tabla de credenciales están presentes. (No hay build.)

- [ ] 13. Actualizar `AGENTS.md` para el modo local (secciones 5, 8 y 10).
      §5: describir el tercer modo `authMode: 'local'`. §8: añadir una línea aclarando que el layout efectivo de clave S3 es
      `{s3Prefix}{processId}/{fileName}` y que `s3Prefix` ya codifica al cliente (resuelve la divergencia de trazabilidad con `{clientId}/{processId}`).
      §10: pasos para el backend local (`cd backend && make start`, copiar `invokeUrl`/`userPoolId`/`userPoolClientId` de `outputs.json`
      a los `environment.*.ts`, `useMock:false`+`authMode:'local'`, `ng serve`) + nota de que `dashboard.component.ts` no se toca.
      Files: `AGENTS.md`
      Verify: lectura manual; confirmar que §5/§8/§10 mencionan `authMode:'local'` y el layout `{s3Prefix}{processId}/{fileName}`.

## Fase E — Integración de frontend acotada (único cambio permitido en `dataflow-app`)

- [ ] 14. Añadir `authMode` a los tres archivos de entorno sin romper el default mock.
      En `environment.ts` y `environment.development.ts`: `useMock: true`, `authMode: 'mock' as 'mock' | 'local' | 'cognito'`,
      `apiUrl` con el formato Floci `http://localhost:4566/restapis/REPLACE_API_ID/local/_user_request_`, y los placeholders de `cognito`.
      En `environment.prod.ts`: `production: true`, `useMock: false`, `authMode: 'cognito'`. Conservar `useMock` (el interceptor y los
      servicios de datos siguen leyéndolo). Mantener el default mock intacto.
      Files: `dataflow-app/src/environments/environment.ts`, `dataflow-app/src/environments/environment.development.ts`, `dataflow-app/src/environments/environment.prod.ts`
      Verify: parte del `npm run build` del paso 18 (tipos del literal `authMode` resuelven).

- [ ] 15. Crear `LocalAuthService` implementando `IAuthService` completo.
      Copiar el boceto de la sección 12 del diseño VERBATIM: imports (`Injectable, inject, signal, Signal`, `HttpClient`,
      `firstValueFrom`, `IAuthService`, `environment`), `interface LoginResponse`, `signIn` con `POST ${environment.apiUrl}/auth/login`
      y `try/catch` que re-lanza `new Error(err?.error?.message ?? 'Credenciales incorrectas')`, `getJwtToken()` devuelve el `idToken`
      guardado, `currentUser` como `Signal<{email, role}|null>`, y el resto de métodos de la interfaz.
      Files: `dataflow-app/src/app/core/auth/local-auth.service.ts`
      Verify: parte del `npm run build` del paso 18.

- [ ] 16. Cambiar el factory `AUTH_SERVICE` en `app.config.ts` a un `switch (environment.authMode)`.
      Importar `LocalAuthService`; `useFactory` con `switch`: `case 'local' → new LocalAuthService()`, `case 'cognito' → new AuthService()`,
      `default → new MockAuthService()`. Mantener el resto de providers sin cambios. (Depende del paso 15.)
      Files: `dataflow-app/src/app/app.config.ts`
      Verify: parte del `npm run build` del paso 18.

- [ ] 17. Acotar `auth.interceptor.ts` para adjuntar el token solo a peticiones a `apiUrl`.
      Mantener el bypass en `useMock`; añadir `if (!req.url.startsWith(environment.apiUrl)) return next(req);` antes de adjuntar
      `Authorization: Bearer <idToken>`. Así las presigned URLs (`:4566/dataflow-input-local/...`) van sin cabecera Authorization.
      Files: `dataflow-app/src/app/core/auth/auth.interceptor.ts`
      Verify: parte del `npm run build` del paso 18.

- [ ] 18. Compilar el frontend para verificar la integración.
      Files: (ninguno nuevo)
      Verify: `cd dataflow-app && npm install && npm run build` compila sin errores (los warnings de *budget* son aceptables).

## Fase F — Verificación full-stack (requiere Docker)

- [ ] 19. Levantar el stack, aprovisionar y ejecutar la verificación e2e del diseño; dejar el stack ABAJO.
      Secuencia: `cd backend && make start` (compose up + espera salud + `node provision.mjs`); confirmar que `provision.mjs` termina
      con exit 0, que `.floci/outputs.json` tiene `authorizerEnforced:true`, y que la verificación interna (9a/9b/9c) pasó. Pruebas
      curl explícitas contra `invokeUrl`: `POST /auth/login` con admin (200 + role admin), con cliente (200 + role client), con password
      incorrecta (401 `Credenciales incorrectas`); `GET /clients` con token admin (5 clientes) y sin token (401/403); `GET /processes`
      con token cliente (6 registros) → prueba de conectividad Lambda→Postgres. Re-ejecutar `node provision.mjs` una vez para probar
      idempotencia (exit 0, sin duplicados). Finalmente `make down` (= `docker compose down -v`) y dejar el stack ABAJO.
      Files: (ninguno; verificación operativa)
      Verify: todos los curl devuelven los códigos/cuerpos esperados; `provision.mjs` sale 0 en ambas corridas; `docker compose ps`
      tras `make down` no lista contenedores del proyecto.

---

## Notas y supuestos

- **Runner de tests del backend:** se elige `node --test` (nativo de Node 22) para los unit tests de `common/`, evitando añadir una
  dependencia de framework. Es la verificación "sin Docker" de la fase B.
- **Fallback de red Lambda→Postgres:** si una versión de Floci ignora `LAMBDA_DOCKER_NETWORK`, `provision.mjs` lee `PGHOST` de su
  entorno; cambiar a `PGHOST=host.docker.internal` (puerto 5432 ya publicado) es una variable, no una edición de código.
- **Enforcement del autorizador:** no se asume; el paso 10 (9b) lo prueba y aborta si Floci deja pasar tokens inválidos
  (`authorizerEnforced:false`). Si eso ocurre, el plan B (authorizer Lambda custom contra `jwks_uri`) queda documentado en el README,
  pero su implementación está fuera del alcance de este plan salvo que la verificación lo exija.
- **Dashboard:** `dashboard.component.ts` NO se modifica; funciona porque `/processes` ignora el query param `current-user-id` para el
  rol cliente y deriva el `clientId` del claim `custom:clientId` del id token.
- La fase F depende de que Docker pueda descargar `floci/floci:latest` y `postgres:16`. Si el entorno de ejecución no puede correr
  Docker, la fase B (unit tests) y la fase E (`npm run build`) siguen siendo verificaciones válidas y la fase F se documenta como
  pendiente de un entorno con Docker.
