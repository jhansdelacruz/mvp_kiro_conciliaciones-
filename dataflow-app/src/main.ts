import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

if (!environment.useMock) {
  import('aws-amplify').then(({ Amplify }) => {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: environment.cognito.userPoolId,
          userPoolClientId: environment.cognito.userPoolClientId,
          loginWith: { email: true }
        }
      }
    });
  });
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
