// Aprovisionamiento idempotente del backend LOCAL de DataFlow sobre Floci + PostgreSQL.
// Ejecuta: espera de salud -> Cognito -> discovery/issuer -> S3 -> empaquetado+Lambdas ->
// API Gateway (autorizador Cognito + CORS + stage local) -> outputs.json -> verificación e2e.
//
// Idempotente: re-ejecutar sobre un stack ya aprovisionado reutiliza recursos y actualiza
// el código de las Lambdas y el deployment del stage.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  CreateUserPoolCommand,
  CreateGroupCommand,
  ListUserPoolClientsCommand,
  CreateUserPoolClientCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  AddPermissionCommand
} from '@aws-sdk/client-lambda';
import {
  APIGatewayClient,
  GetRestApisCommand,
  CreateRestApiCommand,
  GetResourcesCommand,
  CreateResourceCommand,
  PutMethodCommand,
  PutIntegrationCommand,
  PutMethodResponseCommand,
  PutIntegrationResponseCommand,
  GetAuthorizersCommand,
  CreateAuthorizerCommand,
  CreateDeploymentCommand
} from '@aws-sdk/client-api-gateway';
import { IAMClient, CreateRoleCommand } from '@aws-sdk/client-iam';
import AdmZip from 'adm-zip';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const ENDPOINT = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
// Endpoint que ven las Lambdas (contenedores en dataflow-net): deben alcanzar Floci por su
// nombre de servicio DNS, NO por localhost (mismo motivo que PGHOST=postgres, nuance B).
// Solo lo usa auth-login, que hace una llamada REAL a Cognito (InitiateAuth). El handler files
// mantiene localhost:4566 porque solo FIRMA presigned URLs (sin red) y la URL debe ser
// alcanzable desde el navegador. Fallback configurable por entorno.
const LAMBDA_ENDPOINT = process.env.LAMBDA_AWS_ENDPOINT_URL || 'http://floci:4566';
const REGION = process.env.AWS_REGION || 'us-east-1';
const ACCOUNT_ID = '000000000000';
const NETWORK = 'dataflow-net';

// PGHOST que reciben las Lambdas (dentro de dataflow-net). Default 'postgres'; fallback documentado:
// host.docker.internal. provision.mjs lo lee de su propio entorno, así que cambiarlo es una variable.
const LAMBDA_PGHOST = process.env.PGHOST || 'postgres';
const PG = {
  PGHOST: LAMBDA_PGHOST,
  // Puerto INTERNO de Postgres en dataflow-net (siempre 5432). No se liga a process.env.PGPORT,
  // que solo configura el puerto del lado HOST para la comprobación de salud de provision.mjs.
  PGPORT: '5432',
  PGUSER: process.env.PGUSER || 'dataflow',
  PGPASSWORD: process.env.PGPASSWORD || 'dataflow',
  PGDATABASE: process.env.PGDATABASE || 'dataflow'
};

const INPUT_BUCKET = 'dataflow-input-local';
const OUTPUT_BUCKET = 'dataflow-output-local';

const POOL_NAME = 'dataflow-pool';
const APP_CLIENT_NAME = 'dataflow-web';
const API_NAME = 'dataflow-api';
const STAGE = 'local';
const AUTHORIZER_NAME = 'dataflow-cognito-authorizer';
const LAMBDA_ROLE_NAME = 'dataflow-lambda-role';

const USERS = [
  { email: 'admin@dataflow.com', password: 'Admin123!', group: 'admin', clientId: null },
  { email: 'cliente@empresa.com', password: 'Cliente123!', group: 'client', clientId: 'client-001' }
];

const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const sdk = { endpoint: ENDPOINT, region: REGION, credentials };

const cognito = new CognitoIdentityProviderClient(sdk);
const s3 = new S3Client({ ...sdk, forcePathStyle: true });
const lambda = new LambdaClient(sdk);
const apigw = new APIGatewayClient(sdk);
const iam = new IAMClient(sdk);

// Definición de las 4 funciones Lambda y sus variables de entorno.
const FUNCTIONS = {
  authLogin: {
    dir: 'auth-login',
    env: {
      AWS_ENDPOINT_URL: LAMBDA_ENDPOINT, // Cognito via DNS 'floci' (llamada real desde la Lambda)
      COGNITO_APP_CLIENT_ID: '', // se completa tras crear el app client
      AWS_REGION: REGION
    }
  },
  clients: { dir: 'clients', env: { ...PG } },
  processes: { dir: 'processes', env: { ...PG } },
  files: {
    dir: 'files',
    env: {
      ...PG,
      AWS_ENDPOINT_URL: ENDPOINT,
      INPUT_BUCKET,
      OUTPUT_BUCKET,
      AWS_REGION: REGION
    }
  }
};

// Tabla de rutas del API Gateway. auth=true => protegida con autorizador Cognito.
const ROUTES = [
  { path: '/auth/login', method: 'POST', fn: 'authLogin', auth: false },
  { path: '/clients', method: 'GET', fn: 'clients', auth: true },
  { path: '/clients', method: 'POST', fn: 'clients', auth: true },
  { path: '/clients/{id}', method: 'GET', fn: 'clients', auth: true },
  { path: '/clients/{id}', method: 'PUT', fn: 'clients', auth: true },
  { path: '/clients/{id}/deactivate', method: 'DELETE', fn: 'clients', auth: true },
  { path: '/processes', method: 'GET', fn: 'processes', auth: true },
  { path: '/processes/{processId}/retry', method: 'POST', fn: 'processes', auth: true },
  { path: '/files/presigned-upload', method: 'POST', fn: 'files', auth: true },
  { path: '/files/trigger', method: 'POST', fn: 'files', auth: true },
  { path: '/files/download/{processId}', method: 'GET', fn: 'files', auth: true }
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[provision]', ...a);
const warn = (...a) => console.warn('[provision][WARN]', ...a);

function fnName(key) {
  return `dataflow-${FUNCTIONS[key].dir}`;
}

// Ejecuta una llamada SDK ignorando errores de "ya existe".
async function ignoreExists(promise, ...names) {
  try {
    return await promise;
  } catch (err) {
    if (names.includes(err?.name)) return null;
    throw err;
  }
}

// --- Paso 1: esperar salud de Floci y Postgres, verificar la red ---
async function waitForFloci() {
  const paths = ['/_localstack/health', '/health'];
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const p of paths) {
      try {
        const res = await fetch(`${ENDPOINT}${p}`);
        if (res.ok) {
          log(`Floci saludable (${p})`);
          return;
        }
      } catch {
        /* reintenta */
      }
    }
    await sleep(2000);
  }
  throw new Error('Floci no respondió saludable en 120s. ¿Está arriba el contenedor floci?');
}

async function waitForPostgres() {
  const { Client } = require('pg');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const client = new Client({
      host: 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: PG.PGUSER,
      password: PG.PGPASSWORD,
      database: PG.PGDATABASE
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      log('Postgres saludable (localhost:5432)');
      return;
    } catch {
      try { await client.end(); } catch { /* noop */ }
      await sleep(2000);
    }
  }
  throw new Error('Postgres no respondió en 120s. ¿Está arriba el contenedor postgres?');
}

function verifyNetwork() {
  try {
    execSync(`docker network inspect ${NETWORK}`, { stdio: 'ignore' });
    log(`Red Docker '${NETWORK}' encontrada`);
  } catch {
    throw new Error(
      `No existe la red Docker '${NETWORK}'. Verifica que compose.yaml declara ` +
        `'networks.dataflow-net.name: ${NETWORK}' y que 'docker compose up' se ejecutó. ` +
        `Sin esta red, las Lambdas no resuelven el host 'postgres'.`
    );
  }
}

// --- Paso 2: Cognito ---
async function provisionCognito() {
  // Pool (crear-o-reutilizar por nombre).
  let userPoolId;
  const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const existing = (pools.UserPools || []).find((p) => p.Name === POOL_NAME);
  if (existing) {
    userPoolId = existing.Id;
    log(`User pool reutilizado: ${userPoolId}`);
  } else {
    const created = await cognito.send(
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        Schema: [
          { Name: 'clientId', AttributeDataType: 'String', Mutable: true },
          { Name: 'email', AttributeDataType: 'String', Mutable: true, Required: true }
        ]
      })
    );
    userPoolId = created.UserPool.Id;
    log(`User pool creado: ${userPoolId}`);
  }
  const providerArn = `arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${userPoolId}`;

  // Grupos.
  for (const group of ['admin', 'client']) {
    await ignoreExists(
      cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: group })),
      'GroupExistsException'
    );
  }

  // App client (crear-o-reutilizar).
  let appClientId;
  const clients = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 })
  );
  const existingClient = (clients.UserPoolClients || []).find((c) => c.ClientName === APP_CLIENT_NAME);
  if (existingClient) {
    appClientId = existingClient.ClientId;
    log(`App client reutilizado: ${appClientId}`);
  } else {
    const createdClient = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: APP_CLIENT_NAME,
        GenerateSecret: false,
        ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
        ReadAttributes: ['email', 'custom:clientId']
      })
    );
    appClientId = createdClient.UserPoolClient.ClientId;
    log(`App client creado: ${appClientId}`);
  }

  // Usuarios (crear-o-reutilizar; siempre re-aplicar password + grupo).
  for (const u of USERS) {
    const attrs = [
      { Name: 'email', Value: u.email },
      { Name: 'email_verified', Value: 'true' }
    ];
    if (u.clientId) attrs.push({ Name: 'custom:clientId', Value: u.clientId });

    await ignoreExists(
      cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: u.email,
          MessageAction: 'SUPPRESS',
          UserAttributes: attrs
        })
      ),
      'UsernameExistsException'
    );
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: u.email,
        Password: u.password,
        Permanent: true
      })
    );
    await ignoreExists(
      cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: u.email,
          GroupName: u.group
        })
      ),
      'ResourceConflictException'
    );
    log(`Usuario listo: ${u.email} (${u.group})`);
  }

  return { userPoolId, appClientId, providerArn };
}

// --- Paso 3: discovery / issuer ---
async function discoverIssuer(userPoolId, appClientId) {
  const defaultIssuer = `${ENDPOINT}/${userPoolId}`;
  let issuer = defaultIssuer;
  let jwksUri = `${defaultIssuer}/.well-known/jwks.json`;

  try {
    const res = await fetch(`${defaultIssuer}/.well-known/openid-configuration`);
    if (res.ok) {
      const doc = await res.json();
      if (doc.issuer) issuer = doc.issuer;
      if (doc.jwks_uri) jwksUri = doc.jwks_uri;
      log(`Discovery OK: issuer=${issuer}`);
    } else {
      warn(`Discovery no disponible (HTTP ${res.status}); usando jwks por defecto`);
    }
  } catch {
    warn('Discovery no disponible; usando issuer/jwks por defecto');
  }

  // InitiateAuth de prueba con admin para confirmar el iss real del token.
  try {
    const auth = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: appClientId,
        AuthParameters: { USERNAME: USERS[0].email, PASSWORD: USERS[0].password }
      })
    );
    const idToken = auth.AuthenticationResult?.IdToken;
    const payload = decodeJwt(idToken);
    if (payload.iss && payload.iss !== issuer) {
      warn(`El iss del token (${payload.iss}) difiere del discovery (${issuer}); se usa el del token`);
      issuer = payload.iss;
    }
  } catch (err) {
    warn('No se pudo confirmar el issuer con InitiateAuth de prueba:', err?.name || err);
  }

  return { issuer, jwksUri };
}

function decodeJwt(token) {
  if (typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// --- Paso 4: S3 ---
async function provisionBuckets() {
  for (const bucket of [INPUT_BUCKET, OUTPUT_BUCKET]) {
    await ignoreExists(
      s3.send(new CreateBucketCommand({ Bucket: bucket })),
      'BucketAlreadyOwnedByYou',
      'BucketAlreadyExists'
    );
    log(`Bucket listo: ${bucket}`);
  }
}

// --- Paso 5: empaquetado ---
function packageFunction(key) {
  const def = FUNCTIONS[key];
  const srcDir = path.join(__dirname, 'lambdas', def.dir);
  const commonDir = path.join(__dirname, 'lambdas', 'common');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `dataflow-${def.dir}-`));

  // index.mjs + package.json
  fs.copyFileSync(path.join(srcDir, 'index.mjs'), path.join(stage, 'index.mjs'));
  fs.copyFileSync(path.join(srcDir, 'package.json'), path.join(stage, 'package.json'));

  // common/ (solo módulos, sin tests)
  const stageCommon = path.join(stage, 'common');
  fs.mkdirSync(stageCommon, { recursive: true });
  for (const file of fs.readdirSync(commonDir)) {
    if (file.endsWith('.mjs') && !file.endsWith('.test.mjs')) {
      fs.copyFileSync(path.join(commonDir, file), path.join(stageCommon, file));
    }
  }

  // Dependencias de producción.
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: stage, stdio: 'ignore' });

  // ZIP
  const zip = new AdmZip();
  zip.addLocalFolder(stage);
  const zipPath = path.join(__dirname, 'lambdas', def.dir, `${def.dir}.zip`);
  zip.writeZip(zipPath);
  fs.rmSync(stage, { recursive: true, force: true });
  log(`Empaquetada ${fnName(key)} -> ${path.basename(zipPath)}`);
  return zipPath;
}

// --- Rol IAM para las Lambdas (crear-o-reutilizar) ---
async function ensureLambdaRole() {
  const assume = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }
    ]
  };
  await ignoreExists(
    iam.send(
      new CreateRoleCommand({
        RoleName: LAMBDA_ROLE_NAME,
        AssumeRolePolicyDocument: JSON.stringify(assume)
      })
    ),
    'EntityAlreadyExists',
    'EntityAlreadyExistsException'
  );
  return `arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}`;
}

// Reescribe una URL pública (localhost:4566) a su equivalente interno (floci:4566),
// alcanzable desde los contenedores Lambda en dataflow-net.
function toInternalUrl(url) {
  if (typeof url === 'string' && url.startsWith(ENDPOINT)) {
    return LAMBDA_ENDPOINT + url.slice(ENDPOINT.length);
  }
  return url;
}

// --- Paso 6: crear/actualizar Lambdas ---
async function provisionLambdas(appClientId, roleArn, authEnv) {
  FUNCTIONS.authLogin.env.COGNITO_APP_CLIENT_ID = appClientId;
  // Las Lambdas protegidas verifican el id token en la capa handler (enforcement local,
  // porque Floci no aplica el autorizador del API Gateway). Reciben issuer, JWKS interno y audiencia.
  for (const key of ['clients', 'processes', 'files']) {
    Object.assign(FUNCTIONS[key].env, authEnv);
  }
  const arns = {};

  for (const key of Object.keys(FUNCTIONS)) {
    const zipPath = packageFunction(key);
    const buffer = fs.readFileSync(zipPath);
    const name = fnName(key);
    const Variables = { ...FUNCTIONS[key].env };

    try {
      const created = await lambda.send(
        new CreateFunctionCommand({
          FunctionName: name,
          Runtime: 'nodejs20.x',
          Role: roleArn,
          Handler: 'index.handler',
          Code: { ZipFile: buffer },
          Timeout: 30,
          Environment: { Variables }
        })
      );
      arns[key] = created.FunctionArn;
      log(`Lambda creada: ${name}`);
    } catch (err) {
      if (err?.name === 'ResourceConflictException') {
        await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: buffer }));
        await waitUpdate(name);
        await lambda.send(
          new UpdateFunctionConfigurationCommand({
            FunctionName: name,
            Runtime: 'nodejs20.x',
            Handler: 'index.handler',
            Role: roleArn,
            Timeout: 30,
            Environment: { Variables }
          })
        );
        arns[key] = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${name}`;
        log(`Lambda actualizada: ${name}`);
      } else {
        throw err;
      }
    }
  }
  return arns;
}

async function waitUpdate(name) {
  // Pequeña espera para que Floci termine la actualización de código antes de reconfigurar.
  await sleep(1500);
}

// --- Paso 7: API Gateway ---
async function provisionApi(functionArns, providerArn) {
  // REST API (crear-o-reutilizar por nombre).
  let apiId;
  const apis = await apigw.send(new GetRestApisCommand({ limit: 500 }));
  const existing = (apis.items || []).find((a) => a.name === API_NAME);
  if (existing) {
    apiId = existing.id;
    log(`REST API reutilizada: ${apiId}`);
  } else {
    const created = await apigw.send(new CreateRestApiCommand({ name: API_NAME }));
    apiId = created.id;
    log(`REST API creada: ${apiId}`);
  }

  // Autorizador Cognito (crear-o-reutilizar).
  let authorizerId;
  const authorizers = await apigw.send(new GetAuthorizersCommand({ restApiId: apiId }));
  const existingAuth = (authorizers.items || []).find((a) => a.name === AUTHORIZER_NAME);
  if (existingAuth) {
    authorizerId = existingAuth.id;
  } else {
    const createdAuth = await apigw.send(
      new CreateAuthorizerCommand({
        restApiId: apiId,
        name: AUTHORIZER_NAME,
        type: 'COGNITO_USER_POOLS',
        identitySource: 'method.request.header.Authorization',
        providerARNs: [providerArn]
      })
    );
    authorizerId = createdAuth.id;
  }
  log(`Autorizador Cognito listo: ${authorizerId}`);

  // Mapa de recursos existentes por path.
  const rootId = await getRootResourceId(apiId);
  const resourceByPath = await buildResourceMap(apiId);

  // Crea los recursos de todas las rutas (y OPTIONS para CORS).
  const paths = new Set();
  for (const route of ROUTES) paths.add(route.path);
  for (const p of paths) {
    await ensureResourcePath(apiId, rootId, resourceByPath, p);
  }

  // Métodos + integraciones.
  for (const route of ROUTES) {
    const resourceId = resourceByPath[route.path];
    const fnArn = functionArns[route.fn];
    await putMethodAndIntegration(apiId, resourceId, route, authorizerId, fnArn);
  }

  // OPTIONS (CORS preflight, mock) por recurso de la tabla.
  for (const p of paths) {
    await putCorsOptions(apiId, resourceByPath[p]);
  }

  // Deployment al stage.
  await apigw.send(new CreateDeploymentCommand({ restApiId: apiId, stageName: STAGE }));
  log(`Deployment al stage '${STAGE}' creado`);

  const invokeUrl = `${ENDPOINT}/restapis/${apiId}/${STAGE}/_user_request_`;
  return { apiId, invokeUrl };
}

async function getRootResourceId(apiId) {
  const res = await apigw.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }));
  return res.items.find((r) => r.path === '/').id;
}

async function buildResourceMap(apiId) {
  const res = await apigw.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }));
  const map = {};
  for (const r of res.items) map[r.path] = r.id;
  return map;
}

// Crea recursos para cada segmento de un path, de forma idempotente.
async function ensureResourcePath(apiId, rootId, map, fullPath) {
  const segments = fullPath.split('/').filter(Boolean);
  let parentId = rootId;
  let acc = '';
  for (const seg of segments) {
    acc += `/${seg}`;
    if (map[acc]) {
      parentId = map[acc];
      continue;
    }
    const created = await apigw.send(
      new CreateResourceCommand({ restApiId: apiId, parentId, pathPart: seg })
    );
    map[acc] = created.id;
    parentId = created.id;
  }
}

async function putMethodAndIntegration(apiId, resourceId, route, authorizerId, fnArn) {
  const authParams =
    route.auth
      ? { authorizationType: 'COGNITO_USER_POOLS', authorizerId }
      : { authorizationType: 'NONE' };

  await ignoreExists(
    apigw.send(
      new PutMethodCommand({
        restApiId: apiId,
        resourceId,
        httpMethod: route.method,
        apiKeyRequired: false,
        ...authParams
      })
    ),
    'ConflictException'
  );

  const uri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${fnArn}/invocations`;
  await apigw.send(
    new PutIntegrationCommand({
      restApiId: apiId,
      resourceId,
      httpMethod: route.method,
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri
    })
  );

  // Permiso para que API Gateway invoque la Lambda.
  const name = fnArn.split(':function:')[1];
  await ignoreExists(
    lambda.send(
      new AddPermissionCommand({
        FunctionName: name,
        StatementId: `apigw-${route.method}-${resourceId}`,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${apiId}/*/${route.method}${route.path}`
      })
    ),
    'ResourceConflictException'
  );
}

async function putCorsOptions(apiId, resourceId) {
  await ignoreExists(
    apigw.send(
      new PutMethodCommand({
        restApiId: apiId,
        resourceId,
        httpMethod: 'OPTIONS',
        authorizationType: 'NONE',
        apiKeyRequired: false
      })
    ),
    'ConflictException'
  );
  await apigw.send(
    new PutIntegrationCommand({
      restApiId: apiId,
      resourceId,
      httpMethod: 'OPTIONS',
      type: 'MOCK',
      requestTemplates: { 'application/json': '{"statusCode": 200}' }
    })
  );
  await ignoreExists(
    apigw.send(
      new PutMethodResponseCommand({
        restApiId: apiId,
        resourceId,
        httpMethod: 'OPTIONS',
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Headers': true
        }
      })
    ),
    'ConflictException'
  );
  await apigw.send(
    new PutIntegrationResponseCommand({
      restApiId: apiId,
      resourceId,
      httpMethod: 'OPTIONS',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': "'http://localhost:4200'",
        'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
        'method.response.header.Access-Control-Allow-Headers': "'Authorization,Content-Type'"
      }
    })
  );
}

// --- Paso 8: outputs ---
function writeOutputs(outputs) {
  const dir = path.join(__dirname, '.floci');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'outputs.json'), JSON.stringify(outputs, null, 2));
  log('Escrito .floci/outputs.json');
}

// ---------------------------------------------------------------------------
// Paso 9: verificación end-to-end (9a happy path, 9b enforcement, 9c grupo)
// ---------------------------------------------------------------------------
async function login(invokeUrl, email, password) {
  const res = await fetch(`${invokeUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function getStatus(url, headers = {}) {
  const res = await fetch(url, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, body };
}

async function verifyE2E(invokeUrl, outputs) {
  log('--- Verificación e2e ---');

  // 9a. Happy path (conectividad Lambda->Postgres + id token aceptado).
  const admin = await login(invokeUrl, USERS[0].email, USERS[0].password);
  assert(admin.status === 200 && admin.body.role === 'admin', `login admin falló: ${admin.status}`);
  const adminToken = admin.body.idToken;

  const clientsRes = await getStatus(`${invokeUrl}/clients`, { Authorization: `Bearer ${adminToken}` });
  if (clientsRes.status === 500) {
    throw new Error(
      'GET /clients devolvió 500: probable fallo de red Lambda->Postgres. ' +
        'Revisa PGHOST=postgres, name: dataflow-net y el fallback host.docker.internal (README).'
    );
  }
  assert(
    clientsRes.status === 200 && Array.isArray(clientsRes.body) && clientsRes.body.length === 5,
    `GET /clients (admin) esperaba 5 clientes, obtuvo ${clientsRes.status}/${clientsRes.body?.length}`
  );

  const client = await login(invokeUrl, USERS[1].email, USERS[1].password);
  assert(client.status === 200 && client.body.role === 'client', `login cliente falló: ${client.status}`);
  const clientToken = client.body.idToken;

  const procRes = await getStatus(`${invokeUrl}/processes?clientId=current-user-id`, {
    Authorization: `Bearer ${clientToken}`
  });
  assert(
    procRes.status === 200 && Array.isArray(procRes.body) && procRes.body.length === 6,
    `GET /processes (cliente) esperaba 6 registros de client-001, obtuvo ${procRes.status}/${procRes.body?.length}`
  );

  // 9b. Enforcement (aserciones NEGATIVAS). Como este Floci no aplica el autorizador del
  // API Gateway, el enforcement vive en la capa handler: el id token se verifica (firma RS256
  // contra el JWKS del pool + exp/aud/iss/token_use) dentro de clients/processes/files.
  const noAuth = await getStatus(`${invokeUrl}/clients`);
  const tampered = tamperToken(adminToken);
  const tamperedRes = await getStatus(`${invokeUrl}/clients`, { Authorization: `Bearer ${tampered}` });
  const forged = forgeToken();
  const forgedRes = await getStatus(`${invokeUrl}/clients`, { Authorization: `Bearer ${forged}` });

  const enforced =
    [noAuth.status, tamperedRes.status, forgedRes.status].every((s) => s === 401 || s === 403);
  if (!enforced) {
    outputs.authorizerEnforced = false;
    writeOutputs(outputs);
    throw new Error(
      'El enforcement NO está activo: una petición sin token ' +
        `(${noAuth.status}), con token manipulado (${tamperedRes.status}) o con firma inválida ` +
        `(${forgedRes.status}) devolvió 200. Las rutas protegidas quedarían ABIERTAS. ` +
        'Revisa la verificación del id token en la capa handler (common/auth.mjs) y el JWKS interno.'
    );
  }
  log('9b OK: rutas protegidas rechazan sin token / token manipulado / firma inválida');

  // 9c. Autorización por grupo: cliente no puede entrar a /clients.
  const clientOnAdmin = await getStatus(`${invokeUrl}/clients`, { Authorization: `Bearer ${clientToken}` });
  assert(
    clientOnAdmin.status === 403,
    `GET /clients con token de grupo client esperaba 403, obtuvo ${clientOnAdmin.status}`
  );
  log('9c OK: cliente recibe 403 en /clients');

  log('--- Verificación e2e superada ---');
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// Altera un byte del payload del id token válido (debe invalidar la firma).
function tamperToken(token) {
  const parts = token.split('.');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  const mutated = payload.replace(/./, (c) => (c === 'a' ? 'b' : 'a'));
  parts[1] = Buffer.from(mutated).toString('base64url');
  return parts.join('.');
}

// Forja un JWT con exp en el pasado y firma falsa.
function forgeToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'forged',
      'cognito:groups': ['admin'],
      token_use: 'id',
      exp: Math.floor(Date.now() / 1000) - 3600
    })
  ).toString('base64url');
  return `${header}.${payload}.firma-invalida`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await waitForFloci();
  await waitForPostgres();
  verifyNetwork();

  const { userPoolId, appClientId, providerArn } = await provisionCognito();
  const { issuer, jwksUri } = await discoverIssuer(userPoolId, appClientId);
  await provisionBuckets();

  // Env de verificación para los handlers protegidos: issuer público (= iss del token),
  // JWKS resuelto del discovery pero reescrito a la URL interna (floci) para que el contenedor
  // lo alcance, y audiencia = app client id.
  const authEnv = {
    COGNITO_ISSUER: issuer,
    COGNITO_JWKS_URI: toInternalUrl(jwksUri),
    COGNITO_APP_CLIENT_ID: appClientId
  };

  const roleArn = await ensureLambdaRole();
  const functionArns = await provisionLambdas(appClientId, roleArn, authEnv);
  const { apiId, invokeUrl } = await provisionApi(functionArns, providerArn);

  const outputs = {
    userPoolId,
    appClientId,
    cognitoIssuer: issuer,
    cognitoJwksUri: jwksUri,
    authorizerEnforced: true,
    apiId,
    invokeUrl,
    region: REGION,
    inputBucket: INPUT_BUCKET,
    outputBucket: OUTPUT_BUCKET
  };
  writeOutputs(outputs);

  console.log('\n==================== DataFlow backend local ====================');
  console.log(`  invokeUrl   : ${invokeUrl}`);
  console.log(`  userPoolId  : ${userPoolId}`);
  console.log(`  appClientId : ${appClientId}`);
  console.log('  Credenciales de prueba:');
  console.log('    admin   -> admin@dataflow.com / Admin123!');
  console.log('    cliente -> cliente@empresa.com / Cliente123!');
  console.log('================================================================\n');

  await verifyE2E(invokeUrl, outputs);

  // Re-escribe outputs con authorizerEnforced:true confirmado.
  writeOutputs(outputs);
  log('Aprovisionamiento completo.');
}

main().catch((err) => {
  console.error('[provision][ERROR]', err?.message || err);
  process.exit(1);
});
