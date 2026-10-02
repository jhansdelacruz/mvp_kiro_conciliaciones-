# DataFlow — Contexto e Instrucciones del Proyecto

> Documento de referencia del proyecto. Captura la visión, la arquitectura, las
> decisiones técnicas y las convenciones usadas para implementar DataFlow.
> Léelo antes de modificar o extender el código.

---

## 1. Qué es DataFlow

DataFlow es una plataforma **multi-tenant** donde:

- **Clientes finales** inician sesión, suben archivos (`CSV`, `JSON`, `XLSX`) y
  consultan un **historial de procesos** con el resultado de cada archivo
  procesado.
- Un **administrador** gestiona a todos los clientes y configura, por cada
  cliente, cómo recibirá los documentos procesados: **por correo** (Amazon SES)
  o **por el dashboard** mediante un **enlace S3 con URL prefirmada**.

El procesamiento de los archivos lo realiza un **AgentCore Runtime** (Amazon
Bedrock), al que se llega a través de un backend publicado con **API Gateway**.

### Separación de roles

El rol se determina por **grupos de Cognito**:

| Grupo Cognito | Portal        | Rutas         |
|---------------|---------------|---------------|
| `admin`       | Administrador | `/admin/...`  |
| `client`      | Cliente       | `/client/...` |

---

## 2. Estado actual

**Fase completada: Frontend en modo mock.**

La aplicación Angular está 100% navegable **sin ninguna cuenta de AWS**. Toda la
autenticación y las llamadas al backend están simuladas (`useMock: true`). El
código ya está estructurado para pasar a AWS real cambiando una sola bandera.

Pendiente: backend (Lambdas + API Gateway + S3 + DynamoDB), Cognito User Pool e
integración con AgentCore Runtime.

---

## 3. Stack tecnológico

| Capa              | Tecnología                                      |
|-------------------|-------------------------------------------------|
| Framework         | Angular 17+ (standalone components, sin NgModules) |
| Autenticación     | AWS Amplify v6 (imports modulares) + Cognito    |
| UI                | Angular Material 17                             |
| Estilos           | SCSS con variables globales                     |
| Estado reactivo   | Angular Signals (`signal()`, `computed()`)      |
| Backend (previsto)| AWS Lambda (Node.js 20)                         |
| API (previsto)    | AWS API Gateway REST con Cognito Authorizer     |
| Storage (previsto)| Amazon S3 (buckets input/output)                |
| BD (previsto)     | Amazon DynamoDB                                 |
| Procesamiento     | Amazon Bedrock AgentCore Runtime                |
| Email (previsto)  | Amazon SES                                      |

---

## 4. Arquitectura objetivo (end-to-end)

```
Login (Cognito) ──► rol admin/client (grupos Cognito)
      │
      ├─ Cliente: Dashboard (historial) + Carga de archivos
      │     └─ sube a S3 vía URL prefirmada (PUT, sin pasar por Lambda)
      │
      └─ Admin: Lista de clientes + CRUD + config de entrega

Flujo de procesamiento:
  Cliente sube archivo
    → Lambda genera presigned URL (bucket input)
    → Frontend sube directo a S3
    → S3 Event / endpoint /trigger → Lambda crea registro DynamoDB (PROCESSING)
    → Lambda invoca AgentCore Runtime con el path del archivo
    → AgentCore procesa y escribe resultado en bucket output
    → Lambda callback actualiza DynamoDB (COMPLETED, outputPath)
       ├─ si deliveryMethod = EMAIL     → Amazon SES notifica
       └─ si deliveryMethod = DASHBOARD → URL prefirmada en el historial
```

---

## 5. Modo mock (cómo funciona hoy)

El pilar del diseño es que **todo funcione sin AWS** y que el salto a producción
no requiera tocar componentes.

### Bandera única

`dataflow-app/src/environments/environment.development.ts` (y `environment.prod.ts`):

```typescript
export const environment = {
  production: false,
  useMock: true, // ← servicios de datos + bypass del interceptor
  authMode: 'mock' as 'mock' | 'local' | 'cognito', // ← qué IAuthService inyecta el factory
  apiUrl: 'http://localhost:4566/restapis/REPLACE_API_ID/local/_user_request_',
  cognito: {
    userPoolId: 'us-east-1_REPLACE_ME',
    userPoolClientId: 'REPLACE_ME',
    region: 'us-east-1'
  }
};
```

`useMock` controla los servicios de datos (`ClientService`, `ProcessHistoryService`)
y el bypass del interceptor; `authMode` controla **qué `IAuthService`** inyecta el
factory. El default de `environment.ts`/`environment.development.ts` es
`useMock: true` + `authMode: 'mock'` (modo mock intacto).

### Inyección condicional

`app.config.ts` resuelve el servicio de auth con un factory según `authMode`:

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

- `authMode: 'mock'`    → `MockAuthService` (credenciales en memoria, delay ~800 ms).
- `authMode: 'local'`   → `LocalAuthService` (POST `{apiUrl}/auth/login` al backend
  Floci local; `getJwtToken()` devuelve el `idToken`; el 401 se mapea a
  "Credenciales incorrectas"). Requiere `useMock: false`.
- `authMode: 'cognito'` → `AuthService` real con Amplify v6. Requiere `useMock: false`.

El interceptor solo adjunta `Authorization: Bearer <idToken>` a peticiones cuya URL
empieza por `environment.apiUrl`; así las presigned URLs a S3 (`:4566/dataflow-input-local/...`)
viajan sin cabecera `Authorization`.

Los componentes **siempre** inyectan el token `AUTH_SERVICE`, nunca una clase
concreta. Por eso el cambio a producción no toca componentes.

Los servicios de datos (`ClientService`, `ProcessHistoryService`) revisan
`environment.useMock` en cada método: si está activo devuelven datos simulados
con delay; si no, llaman al `ApiService` real.

### Credenciales de prueba (solo mock)

| Rol   | Email                 | Contraseña   |
|-------|-----------------------|--------------|
| Admin | `admin@dataflow.com`  | `Admin123!`  |
| Cliente | `cliente@empresa.com` | `Cliente123!` |

Cualquier otra combinación devuelve "Credenciales incorrectas".

---

## 6. Estructura del código

```
dataflow-app/src/app/
├── core/
│   ├── auth/
│   │   ├── auth-service.interface.ts   # AUTH_SERVICE InjectionToken + contrato
│   │   ├── mock-auth.service.ts        # impl. simulada (credenciales hardcoded)
│   │   ├── auth.service.ts             # impl. real (Amplify v6 modular)
│   │   ├── auth.guard.ts               # authGuard + roleGuard(role) factory
│   │   └── auth.interceptor.ts         # inyecta Authorization: Bearer <jwt>
│   └── services/
│       ├── api.service.ts              # wrapper HTTP + mockResponse() helper
│       ├── client.service.ts           # CRUD clientes (mock: MOCK_CLIENTS)
│       └── process-history.service.ts  # historial (mock: 6 registros)
├── features/
│   ├── auth/login/                     # formulario reactivo + navegación por rol
│   ├── client/
│   │   ├── client.routes.ts            # CLIENT_ROUTES (lazy)
│   │   ├── layout/                     # sidebar #1e2d4e, topbar, logout
│   │   ├── dashboard/                  # 4 cards + tabla Material + filtros
│   │   └── file-upload/                # drag&drop + progreso simulado
│   └── admin/
│       ├── admin.routes.ts             # ADMIN_ROUTES (lazy)
│       ├── layout/                     # sidebar #0f172a, acento ámbar #f59e0b
│       ├── client-list/                # búsqueda + tabla + badges
│       └── client-form/                # 2 tabs: datos / configuración
└── shared/
    ├── models/
    │   ├── client.model.ts             # Client + ClientFormData
    │   └── process.model.ts            # ProcessRecord + enums
    └── components/file-drop-zone/      # dropzone reutilizable
```

---

## 7. Modelo de datos

### `ProcessRecord` (`process.model.ts`)

```typescript
type ProcessStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR';
type FileType = 'CSV' | 'JSON' | 'XLSX';

interface ProcessRecord {
  processId: string;
  clientId: string;
  fileName: string;
  fileType: FileType;
  fileSize: number;
  status: ProcessStatus;
  downloadUrl?: string;    // URL prefirmada S3 cuando COMPLETED + DASHBOARD
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}
```

### `Client` (`client.model.ts`)

```typescript
type DeliveryMethod = 'EMAIL' | 'DASHBOARD';

interface Client {
  clientId: string;
  cognitoUsername: string;
  name: string;
  company: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  deliveryMethod: DeliveryMethod;
  notificationEmail?: string;  // usado cuando deliveryMethod = EMAIL
  s3Prefix: string;            // carpeta del cliente en el bucket
  urlExpiration: number;       // segundos de validez de la URL prefirmada
  totalProcesses?: number;
  createdAt: string;
  updatedAt?: string;
}
```

### DynamoDB previsto

- **Tabla `clients`**: espeja la interfaz `Client`.
- **Tabla `process_history`**: espeja `ProcessRecord`, con `inputS3Key` y
  `outputS3Key`.

---

## 8. Endpoints de API previstos

Todos protegidos con **Cognito Authorizer** en API Gateway. La Lambda extrae el
`sub` del JWT para filtrar datos por cliente; el admin accede a todo.

| Método | Endpoint                      | Descripción                         |
|--------|-------------------------------|-------------------------------------|
| POST   | `/files/presigned-upload`     | Genera URL prefirmada (PUT) a S3    |
| POST   | `/files/trigger`              | Inicia procesamiento en AgentCore   |
| GET    | `/files/history`              | Historial del cliente autenticado   |
| GET    | `/files/download/{processId}` | URL prefirmada (GET) de descarga    |
| GET    | `/admin/clients`              | Lista todos los clientes            |
| POST   | `/admin/clients`              | Crea cliente (+ usuario Cognito)    |
| PUT    | `/admin/clients/{id}`         | Actualiza cliente y su config       |
| DELETE | `/admin/clients/{id}`         | Desactiva cliente                   |

### Buckets S3 previstos

| Bucket                   | Propósito                   | Acceso              |
|--------------------------|-----------------------------|---------------------|
| `dataflow-input-{env}`   | Archivos subidos por cliente| Presigned URL (PUT) |
| `dataflow-output-{env}`  | Resultados de AgentCore     | Presigned URL (GET) |

Estructura: `{clientId}/{processId}/<archivo>`.

> Backend local (Floci): el layout efectivo de clave S3 es `{s3Prefix}{processId}/{fileName}`,
> donde `s3Prefix` (p. ej. `clients/acme/`) ya codifica al cliente. Es la materialización de
> `{clientId}/{processId}/<archivo>` usando el prefijo por cliente que ya existe en los datos.

> Enforcement de autenticación en local vs producción (divergencia Floci): este build de Floci
> **no aplica** el autorizador Cognito del API Gateway (ni rechaza tokens inválidos ni inyecta
> `requestContext.authorizer.claims`). Por eso, en local, cada Lambda protegida verifica el id token
> en la **capa handler** (`backend/lambdas/common/auth.mjs`): firma RS256 contra el JWKS del pool
> (resuelto del discovery, no hardcodeado) + `exp`/`aud`/`iss`/`token_use`. El autorizador nativo
> `COGNITO_USER_POOLS` se mantiene adjunto en el gateway por fidelidad con producción: en AWS real
> el gateway valida y la verificación del handler queda como defensa en profundidad. El contrato de
> API y lo que ve el usuario son idénticos en ambos entornos.

---

## 9. Convenciones del proyecto

- **Standalone components** siempre; nada de NgModules. Imports declarados
  explícitamente en cada componente.
- Preferir `inject()` sobre inyección por constructor.
- Estado reactivo con **signals** (`signal()`, `computed()`), no con `BehaviorSubject`
  salvo que haya un motivo concreto.
- Los componentes dependen de **abstracciones** (token `AUTH_SERVICE`), nunca de
  implementaciones concretas, para preservar el switch mock ↔ real.
- **Amplify v6 modular** únicamente:
  `import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth'`.
  Prohibido el estilo legacy v5 (`Auth.signIn()`).
- Datos mock realistas y **en español**.
- Paleta cliente: `#1e2d4e` / `#3b82f6` / `#60a5fa`. Paleta admin: `#0f172a` /
  `#f59e0b`. Estados: éxito `#10b981`, aviso `#f59e0b`, error `#ef4444`.

---

## 10. Cómo pasar a backend local (Floci) o a AWS real

### Backend local con Floci (`authMode: 'local'`)

1. Levantar el backend: `cd backend && make start` (Docker Compose + `provision.mjs`
   idempotente). Al terminar escribe `backend/.floci/outputs.json`.
2. Copiar de `outputs.json` a `environment.development.ts` (y/o `environment.ts`):
   `invokeUrl` → `apiUrl`, `userPoolId` → `cognito.userPoolId`,
   `appClientId` → `cognito.userPoolClientId`.
3. Poner `useMock: false` y `authMode: 'local'`.
4. `cd dataflow-app && npx ng serve`. El login llamará a `POST {apiUrl}/auth/login`;
   los servicios de datos usarán el API local.

   > El dashboard del cliente sigue llamando a `getHistory('current-user-id')` y
   > **no se modifica** (`dashboard.component.ts` queda fuera del cambio acotado):
   > funciona porque el handler `/processes` ignora ese query param para el rol
   > `client` y deriva el `clientId` del claim `custom:clientId` del id token
   > (`cliente@empresa.com` → `client-001`), poblando el historial igual que en mock.

   Credenciales de prueba (idénticas al mock): `admin@dataflow.com` / `Admin123!`
   y `cliente@empresa.com` / `Cliente123!`.

### AWS real (`authMode: 'cognito'`)

1. Crear el **Cognito User Pool** con grupos `admin` y `client`, y un App Client
   con flujo `USER_PASSWORD_AUTH`.
2. Desplegar backend (API Gateway + Lambdas + S3 + DynamoDB) e integrar AgentCore.
3. En `environment.development.ts` y `environment.prod.ts`:
   ```typescript
   useMock: false,
   authMode: 'cognito',
   apiUrl: 'https://TU_API.execute-api.us-east-1.amazonaws.com/prod',
   cognito: {
     userPoolId: 'us-east-1_TU_POOL_ID',
     userPoolClientId: 'TU_CLIENT_ID',
     region: 'us-east-1'
   }
   ```
4. `npx ng serve`. El login llamará a Cognito vía Amplify; los servicios usarán
   el API real. **No hay que tocar ningún componente.**

---

## 11. Comandos

```bash
cd dataflow-app
npm install        # primera vez
npx ng serve       # desarrollo en http://localhost:4200
npm run build      # build de producción (verifica compilación)
```

> Nota: el build genera warnings de *budget* (tamaño de bundle/CSS ligeramente
> sobre el límite por defecto). Son avisos, no errores; se pueden ajustar en
> `angular.json` si se desea.

---

## 12. Próximos pasos

1. **Backend**: Cognito User Pool → API Gateway + Lambdas → S3 → DynamoDB.
2. **AgentCore**: Lambda de trigger + callback de resultado.
3. **SES**: plantillas de notificación por correo.
4. **Frontend follow-ups**: estado en tiempo real (WebSocket o polling),
   paginación server-side del historial, reemplazo progresivo de mocks por
   llamadas reales conforme se despliega cada endpoint.
