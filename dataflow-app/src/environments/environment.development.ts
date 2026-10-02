export const environment = {
  production: false,
  useMock: true,
  authMode: 'mock' as 'mock' | 'local' | 'cognito',
  apiUrl: 'http://localhost:4566/restapis/REPLACE_API_ID/local/_user_request_',
  cognito: {
    userPoolId: 'us-east-1_REPLACE_ME',
    userPoolClientId: 'REPLACE_ME',
    region: 'us-east-1'
  }
};
