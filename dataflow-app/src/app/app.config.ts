import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { routes } from './app.routes';
import { AUTH_SERVICE } from './core/auth/auth-service.interface';
import { MockAuthService } from './core/auth/mock-auth.service';
import { LocalAuthService } from './core/auth/local-auth.service';
import { AuthService } from './core/auth/auth.service';
import { authInterceptor } from './core/auth/auth.interceptor';
import { ApiService } from './core/services/api.service';
import { ProcessHistoryService } from './core/services/process-history.service';
import { ClientService } from './core/services/client.service';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimations(),
    importProvidersFrom(MatSnackBarModule),
    {
      provide: AUTH_SERVICE,
      useFactory: () => {
        switch (environment.authMode) {
          case 'local':   return new LocalAuthService();   // backend Floci local
          case 'cognito': return new AuthService();         // Amplify real
          default:        return new MockAuthService();     // mock (default)
        }
      }
    },
    ApiService,
    ProcessHistoryService,
    ClientService
  ]
};
