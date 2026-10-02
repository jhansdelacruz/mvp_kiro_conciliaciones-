export const environment = {
  production: true,
  useMock: false,
  authMode: 'cognito' as 'mock' | 'local' | 'cognito',
  apiUrl: 'https://REPLACE_ME.execute-api.us-east-1.amazonaws.com/prod',
  cognito: {
    userPoolId: 'us-east-1_REPLACE_ME',
    userPoolClientId: 'REPLACE_ME',
    region: 'us-east-1'
  }
};
