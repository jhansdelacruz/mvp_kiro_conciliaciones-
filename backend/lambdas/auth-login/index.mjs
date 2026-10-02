// Handler público POST /auth/login. No pasa por el autorizador.
// Autentica contra Cognito (Floci) con USER_PASSWORD_AUTH y devuelve los tokens + role.
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { json, parseBody, decodeTokenPayload, roleFromGroups } from './common/http.mjs';
import { validateLogin } from './common/validate.mjs';

const client = new CognitoIdentityProviderClient({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_REGION || 'us-east-1'
});

export async function handler(event) {
  if (event?.httpMethod === 'OPTIONS') return json(200, {});

  const body = parseBody(event);
  const invalid = validateLogin(body);
  if (invalid) return json(400, invalid);

  try {
    const res = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_APP_CLIENT_ID,
        AuthParameters: { USERNAME: body.email, PASSWORD: body.password }
      })
    );

    const auth = res.AuthenticationResult ?? {};
    const payload = decodeTokenPayload(auth.IdToken);
    const role = roleFromGroups(payload['cognito:groups']);
    const email = payload.email ?? body.email;

    return json(200, {
      idToken: auth.IdToken,
      accessToken: auth.AccessToken,
      refreshToken: auth.RefreshToken,
      role,
      email
    });
  } catch (err) {
    const name = err?.name || '';
    if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') {
      console.warn('Login fallido:', name);
      return json(401, { message: 'Credenciales incorrectas' });
    }
    console.error('Error de autenticación:', err);
    return json(502, { message: 'Error de autenticación' });
  }
}
