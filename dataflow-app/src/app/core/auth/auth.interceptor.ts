import { inject } from '@angular/core';
import { HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AUTH_SERVICE } from './auth-service.interface';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (
  req,
  next
): Observable<HttpEvent<any>> => {
  if (environment.useMock) {
    return next(req);
  }

  // Solo adjuntar el token a peticiones dirigidas a apiUrl; así las presigned URLs
  // (p. ej. :4566/dataflow-input-local/...) viajan sin cabecera Authorization.
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const auth = inject(AUTH_SERVICE);

  const tokenPromise = auth
    .getJwtToken()
    .then((token) =>
      req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    )
    .catch(() => req);

  return from(tokenPromise).pipe(switchMap((authReq) => next(authReq)));
};
