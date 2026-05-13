import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './services/auth.service';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token;

  if (!token || !request.url.startsWith('/api')) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  );
};
