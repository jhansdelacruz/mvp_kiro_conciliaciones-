import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AUTH_SERVICE } from './auth-service.interface';

export const authGuard: CanActivateFn = async (_route, _state) => {
  // inject() must run synchronously, before any await, or the injection
  // context is lost and inject() throws.
  const auth = inject(AUTH_SERVICE);
  const router = inject(Router);

  const isAuth = await auth.isAuthenticated();
  if (!isAuth) {
    router.navigate(['/auth/login']);
    return false;
  }
  return true;
};

export const roleGuard =
  (requiredRole: 'admin' | 'client'): CanActivateFn =>
  async (_route, _state) => {
    const auth = inject(AUTH_SERVICE);
    const router = inject(Router);

    const role = await auth.getUserRole();
    if (role !== requiredRole) {
      router.navigate([role === 'admin' ? '/admin/clients' : '/client/dashboard']);
      return false;
    }
    return true;
  };
