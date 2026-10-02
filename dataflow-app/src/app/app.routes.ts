import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/auth/login',
    pathMatch: 'full'
  },
  {
    path: 'auth/login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(
        (m) => m.LoginComponent
      )
  },
  {
    path: 'client',
    canActivate: [authGuard, roleGuard('client')],
    loadComponent: () =>
      import('./features/client/layout/client-layout.component').then(
        (m) => m.ClientLayoutComponent
      ),
    loadChildren: () =>
      import('./features/client/client.routes').then(
        (m) => m.CLIENT_ROUTES
      )
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard('admin')],
    loadComponent: () =>
      import('./features/admin/layout/admin-layout.component').then(
        (m) => m.AdminLayoutComponent
      ),
    loadChildren: () =>
      import('./features/admin/admin.routes').then(
        (m) => m.ADMIN_ROUTES
      )
  },
  {
    path: '**',
    redirectTo: '/auth/login'
  }
];
