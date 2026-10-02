# Backend LOCAL de DataFlow (Floci + PostgreSQL)

Backend **100% local** para la app Angular `dataflow-app`, sin ninguna cuenta real de AWS.
Usa [Floci](https://hub.docker.com/r/floci/floci) (emulador de AWS compatible con LocalStack,
expone todo en `http://localhost:4566`) más un contenedor **PostgreSQL 16**. Todo se levanta con
`docker compose` + un script de aprovisionamiento idempotente (`provision.mjs`).

Reproduce el contrato que la app ya espera cuando `useMock: false`: API Gateway REST con autorizador
Cognito, 4 Lambdas Node.js 20 que hablan con Postgres, dos buckets S3 y un pool de Cognito con grupos
`admin`/`client`.

---

## Prerrequisitos

- **Docker** 24+ y **Docker Compose v2** (`docker compose ...`), con el socket `/var/run/docker.sock`
  accesible (Floci lanza las Lambdas como contenedores Docker reales).
- **Node.js 22** (para `provision.mjs` y los tests). Las Lambdas corren en `nodejs20.x` dentro de Floci.
- **AWS CLI v2** (opcional, útil para inspeccionar recursos en `:4566`).

---

## Arranque rápido

```bash
cd backend
npm install        # dependencias de provisioning + pg (para tests)
make start         # docker compose up -d  +  node provision.mjs
```

`make start` levanta los contenedores y ejecuta `provision.mjs`, que espera la salud de Floci y
Postgres, crea todos los recursos y corre la verificación end-to-end (9a/9b/9c). Al terminar imprime
la `invokeUrl` y las credenciales de prueba.

Para derribar todo (y borrar datos para re-sembrar en limpio):

```bash
make down          # docker compose down -v
```

### Targets del Makefile

| Target         | Acción                                                            |
|----------------|-------------------------------------------------------------------|
| `make up`      | `docker compose up -d`                                            |
| `make provision` | `node provision.mjs`                                            |
| `make start`   | `up` + `provision`                                               |
| `make down`    | `docker compose down -v` (borra volúmenes y red)                 |
| `make logs`    | `docker compose logs -f`                                         |
| `make seed`    | Re-ejecuta `02_seed.sql` (seguro por `ON CONFLICT DO NOTHING`)   |
| `make test`    | Tests unitarios de `lambdas/common/` (sin Docker)                |

Los mismos targets existen como scripts npm (`npm run start`, `npm run down`, `npm test`, ...).

---

## `invokeUrl` y `outputs.json`

`provision.mjs` escribe `backend/.floci/outputs.json` (gitignored) con:

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

La `invokeUrl` sigue el formato de API Gateway en Floci/LocalStack:
`http://localhost:4566/restapis/{apiId}/{stage}/_user_request_`.

Para conectar el frontend al backend local, copia `invokeUrl` a `apiUrl` y `userPoolId` /
`appClientId` a la sección `cognito` de los `environment.*.ts`, pon `useMock: false` y
`authMode: 'local'`, y arranca `ng serve`. (La integración de frontend se cablea en FEAT-002.)

---

## Credenciales de prueba

| Rol     | Email                 | Contraseña    | Notas                                  |
|---------|-----------------------|---------------|----------------------------------------|
| Admin   | `admin@dataflow.com`  | `Admin123!`   | Grupo `admin`                          |
| Cliente | `cliente@empresa.com` | `Cliente123!` | Grupo `client`, `custom:clientId=client-001` |

> El usuario cliente está mapeado a `custom:clientId = client-001` para que el dashboard muestre los
> 6 procesos sembrados de ese cliente **sin modificar** `dashboard.component.ts`. El handler
> `GET /processes` deriva el `clientId` del claim del id token (ignora el query param que manda el
> dashboard) para el rol cliente; el admin consulta por query param.

Pruebas rápidas con `curl` (sustituye `$URL` por la `invokeUrl`):

```bash
# login admin
curl -s -X POST "$URL/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@dataflow.com","password":"Admin123!"}'

# GET /clients (requiere Bearer idToken)
curl -s "$URL/clients" -H "Authorization: Bearer <idToken>"
```

---

## Cómo encajan las piezas

```
  dataflow-app (Angular, :4200)
        │  Authorization: Bearer <idToken>
        ▼
  API Gateway REST (Floci :4566, stage local)
        │  autorizador COGNITO_USER_POOLS (valida firma + exp del id token)
        ├─ /auth/login  (público)  ─► Lambda auth-login ─► Cognito (InitiateAuth)
        ├─ /clients*    (admin)    ─► Lambda clients    ─┐
        ├─ /processes*  (client)   ─► Lambda processes  ─┼─► PostgreSQL (red dataflow-net)
        └─ /files*      (client)   ─► Lambda files      ─┘   + S3 (presigned PUT/GET)
```

Las Lambdas corren como contenedores Docker en la red `dataflow-net` y resuelven Postgres por el
hostname DNS `postgres`.

---

## Troubleshooting

### (a) Socket Docker no montado / permiso denegado

Floci necesita `/var/run/docker.sock` para lanzar las Lambdas. Si ves errores al crear/invocar
funciones, confirma que el volumen del socket está montado en `compose.yaml` y que tu usuario tiene
permiso sobre el socket.

### (b) Lambda no conecta a Postgres (GET /clients o /processes devuelve 500)

Las Lambdas usan `PGHOST=postgres` y se unen a la red Docker **`dataflow-net`** (nombre fijado con
`name: dataflow-net` en `compose.yaml`, imprescindible: evita el prefijo `<proyecto>_` de Compose).
Floci adjunta cada contenedor Lambda a esa red por `LAMBDA_DOCKER_NETWORK=dataflow-net`.

Si una versión de Floci ignora `LAMBDA_DOCKER_NETWORK`, usa el **fallback**:
`PGHOST=host.docker.internal node provision.mjs` (el puerto `5432` ya está publicado). `provision.mjs`
lee `PGHOST` de su entorno, así que es una variable, no una edición de código.

`provision.mjs` verifica con `docker network inspect dataflow-net` que la red existe antes de crear
las Lambdas, y aborta con mensaje accionable si falta.

### (c) Issuer de Cognito distinto del esperado / `jwks_uri`

`provision.mjs` **no hardcodea** el JWKS: descarga el documento de discovery
`http://localhost:4566/<userPoolId>/.well-known/openid-configuration` y lee de él `issuer` y
`jwks_uri` reales, que registra en `outputs.json`. Además hace un `InitiateAuth` de prueba y, si el
`iss` del token difiere del discovery, emite un WARN y usa el del token. Si el discovery no está
disponible, cae a `.../.well-known/jwks.json` con un WARN.

### (d) CORS / preflight

Todas las respuestas (éxito y error) y el `OPTIONS` de cada recurso incluyen:

```
Access-Control-Allow-Origin: http://localhost:4200
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Authorization,Content-Type
```

Si el navegador bloquea por CORS, confirma que arrancas el frontend en `http://localhost:4200`.

### (e) Dónde vive el enforcement: capa handler en local, autorizador del gateway en producción

**Divergencia importante respecto al diseño original.** Este build de Floci **no aplica** el
autorizador del API Gateway: ni rechaza tokens inválidos ni inyecta
`requestContext.authorizer.claims`. Verificado: aunque los métodos protegidos tienen
`authorizationType = COGNITO_USER_POOLS` + autorizador adjunto, todas las peticiones (sin token, con
token basura, con token válido) llegan a la Lambda con claims vacíos.

Para que el backend **funcione correctamente en local** sin renunciar al enforcement criptográfico, la
verificación del id token se hace en la **capa handler** (`lambdas/common/auth.mjs`): cada ruta
protegida verifica la **firma RS256** del id token contra el **JWKS del pool** (resuelto del documento
de discovery OpenID, no hardcodeado) y comprueba `exp`, `aud` (= app client id), `iss` y
`token_use === 'id'`. El `cognito:groups` y el `custom:clientId` se derivan del token ya verificado,
usando el mismo helper `groupsFrom`/`isAdmin`.

El autorizador nativo `COGNITO_USER_POOLS` **se mantiene adjunto** en el API Gateway por fidelidad con
producción: en **AWS real** el enforcement ocurre en el gateway, y la verificación en el handler queda
como **defensa en profundidad** (inofensiva, valida el mismo token). El contrato de API y lo que ve el
usuario son idénticos en ambos entornos.

El paso 9b de `provision.mjs` **prueba** este enforcement con aserciones negativas (sin token, token
manipulado, firma inválida → `401`/`403`). Si **cualquiera** devolviera `200`, escribe
`authorizerEnforced: false` en `outputs.json` y **falla** con exit ≠ 0.

> Nota: la validación de `exp` con una **firma válida** no es testeable localmente sin la clave privada
> del pool (no se puede forjar un token con firma válida y `exp` pasado). Por eso 9b usa un token con
> firma inválida; el rechazo por `exp` con firma válida lo cubre la verificación del handler en
> ejecución normal.

> Nota de red (análoga a PGHOST): la Lambda descarga el JWKS desde el endpoint **interno**
> `http://floci:4566/...` (no `localhost`), porque corre como contenedor en `dataflow-net`. `auth-login`
> llama a Cognito por el mismo motivo. `provision.mjs` resuelve el `jwks_uri` del discovery y reescribe
> su host al interno antes de pasarlo a las Lambdas.

---

## Teardown

```bash
make down     # docker compose down -v  (borra el volumen dataflow-pgdata y la red)
```

Tras `make down`, el próximo `make start` recrea Postgres vacío y vuelve a correr `01_schema.sql` +
`02_seed.sql`.

---

## Nota de seguridad

La contraseña de Postgres (`dataflow` / `dataflow`) y las contraseñas de los usuarios de prueba son
**valores de desarrollo local**. No usar en ningún entorno real.
