# DataFlow MVP

Angular 17 frontend with mock authentication, client portal, and admin portal.  
Designed to connect to AWS Cognito + Amplify and an API Gateway backend.

---

## Quickstart

```bash
cd dataflow-app
npm install        # first time only
npx ng serve
```

Open [http://localhost:4200](http://localhost:4200).

---

## Mock login credentials

| Role          | Email                    | Password     |
|---------------|--------------------------|--------------|
| Administrador | admin@dataflow.com       | Admin123!    |
| Cliente       | cliente@empresa.com      | Cliente123!  |

The mock service bypasses Cognito entirely so the app works with no AWS account.

---

## What was built

### Foundation
- Angular 17 standalone components, Angular Material UI, SCSS theming
- `AuthService` with a **mock** backend (`useMock: true`) and a real AWS Amplify path ready to activate
- Route guards (`AuthGuard`, `AdminGuard`) that enforce login and role separation
- HTTP interceptor that attaches the JWT to every API call

### Client portal (`/client/...`)
- **Dashboard** — history table of past processed files with status badges and links to S3 pre-signed URLs
- **File Upload** — drag-and-drop zone accepting `.csv`, `.json`, and `.xlsx`; validates type and size before upload

### Admin portal (`/admin/...`)
- **Client list** — card grid of all registered clients with search/filter
- **Client CRUD** — create, edit, and delete clients; configures delivery method (email or dashboard S3 link) per client

---

## Switching to real AWS

1. Open `dataflow-app/src/environments/environment.ts`
2. Set `useMock: false`
3. Fill in your values:

```ts
export const environment = {
  production: false,
  useMock: false,
  cognito: {
    userPoolId: 'us-east-1_XXXXXXXXX',
    userPoolClientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX',
    region: 'us-east-1',
  },
  apiUrl: 'https://YOUR_API_GATEWAY_ID.execute-api.us-east-1.amazonaws.com/prod',
};
```

4. Run `npx ng serve` — the login page will now call Cognito directly via Amplify.

---

## What to build next

### Backend (recommended order)

1. **AWS Cognito User Pool**
   - Two groups: `Admins` and `Clients`
   - App client with `USER_PASSWORD_AUTH` flow
   - Add `custom:role` attribute (or rely on group membership)

2. **API Gateway + Lambda**
   - `POST /upload` — returns a pre-signed S3 PUT URL; frontend uploads directly to S3
   - `GET /files` — lists processed files for the authenticated client
   - `POST /clients` / `PUT /clients/{id}` / `DELETE /clients/{id}` — admin CRUD, restricted by Cognito Authorizer to the `Admins` group

3. **S3 bucket**
   - One prefix per client: `clients/{clientId}/uploads/`
   - Processed output prefix: `clients/{clientId}/output/`
   - Pre-signed URLs for output delivery (expiry configurable per client)

4. **AgentCore Runtime integration**
   - Lambda triggers on S3 `ObjectCreated` events in the uploads prefix
   - Calls AgentCore Runtime with the file path and client configuration
   - Writes result to the output prefix and (optionally) emails the client via SES

### Frontend follow-ups
- Replace `MockAuthService` stub calls with live `ApiService` calls once the API is deployed
- Add real-time status updates (WebSocket via API Gateway or polling)
- Add pagination to the dashboard history table for large file counts

---

## Project structure

```
dataflow-app/
├── src/
│   ├── app/
│   │   ├── core/            # AuthService, ApiService, guards, interceptor
│   │   ├── features/
│   │   │   ├── auth/        # Login page
│   │   │   ├── client/      # Dashboard + File Upload
│   │   │   └── admin/       # Client List + Client Form (CRUD)
│   │   └── shared/          # FileDropZone component
│   └── environments/        # environment.ts (mock/prod toggle)
└── angular.json
```

---

## Commit history

| Commit    | Description |
|-----------|-------------|
| `9c71c4d` | fix(integration): cross-feature seam verification — production build 0 errors |
| `92794c5` | feat(admin): admin portal with ClientList, ClientForm, production build verified |
| `8b10d0f` | feat(client): client portal with dashboard, file upload, and FileDropZone |
| `656594d` | feat(auth): authentication layer with MockAuthService, guards, interceptor, and login UI |
| `2e8488f` | feat(auth): add authentication service, guards and http interceptor |
| `ff7cf83` | feat(scaffold): Angular 17 DataFlow project with foundation layer |
