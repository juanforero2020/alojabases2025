import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { AuthenService } from 'src/app/servicios/authen.service';

/**
 * - Añade el token Bearer a las peticiones autenticadas.
 * - Ante 401 (sesión expirada o token inválido), cierra sesión y redirige al login.
 * Así el backend puede forzar cierre de sesión por inactividad (p. ej. en móviles).
 */
@Injectable()
export class SessionExpiredInterceptor implements HttpInterceptor {

  constructor(
    private authService: AuthService,
    private authenService: AuthenService,
    private router: Router
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const isExternalApi = request.url.includes('veronica.ec');
    const token = this.authenService.getToken();
    const isLoginOrRegister =
      request.url.includes('/signIn') ||
      request.url.includes('/register') ||
      request.url.includes('/signInGoogle');
    let req = request;
    if (token && !isLoginOrRegister && !isExternalApi) {
      req = request.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
      });
    }
    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        const hasToken = !!localStorage.getItem('token');
        const isOwnBackend401 = err.status === 401 && hasToken && !isExternalApi;
        if (isOwnBackend401) {
          this.authService.logOut(true);
          this.router.navigate(['/login-form']);
        }
        return throwError(() => err);
      })
    );
  }
}
