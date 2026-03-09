import { Injectable, NgZone } from '@angular/core';
import { DatosConfiguracionService } from 'src/app/servicios/datosConfiguracion.service';
import { AuthenService } from 'src/app/servicios/authen.service';

const DEFAULT_MINUTOS_INACTIVIDAD = 30;
/** Intervalo del heartbeat al servidor (mantiene sesión viva y permite que el servidor expire por inactividad). */
const HEARTBEAT_INTERVAL_MS = 90 * 1000; // 90 segundos

@Injectable({
  providedIn: 'root'
})
export class InactivityService {

  private checkIntervalId: any;
  private heartbeatIntervalId: any;
  private listeners: Array<() => void> = [];
  private onInactivityCallback: (() => void) | null = null;

  private lastActivity = Date.now();
  private inactivityTimeoutMs = DEFAULT_MINUTOS_INACTIVIDAD * 60 * 1000;

  constructor(
    private datosConfiguracionService: DatosConfiguracionService,
    private authenService: AuthenService,
    private ngZone: NgZone
  ) {}

  startWatching(onInactivity: () => void): void {

    this.stopWatching();
    this.onInactivityCallback = onInactivity;

    this.datosConfiguracionService.getDatosConfiguracion().subscribe({
      next: (config) => {

        const minutos = config?.[0]?.minutosInactividad ?? DEFAULT_MINUTOS_INACTIVIDAD;

        this.inactivityTimeoutMs = minutos * 60 * 1000;

        console.log('Tiempo de inactividad configurado:', minutos, 'min');

        this.initializeListeners();
        this.startIntervalCheck();

      },
      error: () => {

        this.inactivityTimeoutMs = DEFAULT_MINUTOS_INACTIVIDAD * 60 * 1000;

        this.initializeListeners();
        this.startIntervalCheck();
      }
    });
  }

  private initializeListeners(): void {

    const updateActivity = () => {
      this.lastActivity = Date.now();
    };

    const events = [
      'pointerdown',
      'pointermove',
      'keydown',
      'scroll',
      'touchstart',
      'touchmove'
    ];

    events.forEach(event => {

      const handler = () => updateActivity();

      document.addEventListener(event, handler, true);

      this.listeners.push(() =>
        document.removeEventListener(event, handler, true)
      );
    });

    // Al volver a la pestaña/app: preguntamos al SERVIDOR si la sesión sigue vigente.
    // El backend devuelve 401 si pasó el tiempo de inactividad → el interceptor cierra sesión.
    // Así funciona en móviles aunque visibility/focus no se disparen bien.
    const checkSessionOnReturn = () => {
      if (!localStorage.getItem('token')) return;
      this.ngZone.run(() => {
        this.authenService.checkSession().subscribe({
          next: () => { this.lastActivity = Date.now(); },
          error: () => { /* 401 manejado por SessionExpiredInterceptor */ }
        });
      });
    };

    // 1) visibilitychange: estándar para pestaña/app visible de nuevo
    const visibilityHandler = () => {
      if (!document.hidden) {
        checkSessionOnReturn();
        this.startHeartbeat();
      } else {
        this.stopHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.listeners.push(() =>
      document.removeEventListener('visibilitychange', visibilityHandler)
    );

    // 2) focus: en móviles a veces es más fiable que visibilitychange al volver
    const focusHandler = () => {
      checkSessionOnReturn();
      if (!document.hidden) this.startHeartbeat();
    };
    window.addEventListener('focus', focusHandler);
    this.listeners.push(() => window.removeEventListener('focus', focusHandler));

    // 3) pageshow: se dispara al volver desde bfcache o cambio de pestaña en varios móviles
    const pageShowHandler = (e: PageTransitionEvent) => {
      if (e.persisted || !document.hidden) {
        checkSessionOnReturn();
        this.startHeartbeat();
      }
    };
    window.addEventListener('pageshow', pageShowHandler);
    this.listeners.push(() => window.removeEventListener('pageshow', pageShowHandler));

    this.lastActivity = Date.now();
    if (!document.hidden) this.startHeartbeat();
  }

  /** Heartbeat al servidor para que actualice last_activity; al dejar la app se detiene y el servidor puede expirar la sesión. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalId = setInterval(() => {
      if (document.hidden || !localStorage.getItem('token')) return;
      this.authenService.checkSession().subscribe({
        next: () => { this.lastActivity = Date.now(); },
        error: () => { /* 401 → interceptor cierra sesión */ }
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  private startIntervalCheck(): void {

    this.ngZone.runOutsideAngular(() => {

      this.checkIntervalId = setInterval(() => {

        const now = Date.now();
        const diff = now - this.lastActivity;

        if (diff > this.inactivityTimeoutMs) {

          this.ngZone.run(() => {
            this.handleInactivity();
          });

        }

      }, 10000); // revisa cada 10 segundos

    });

  }

  stopWatching(): void {

    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }

    this.stopHeartbeat();

    this.listeners.forEach(remove => remove());

    this.listeners = [];

    this.onInactivityCallback = null;
  }

  private handleInactivity(): void {

    const callback = this.onInactivityCallback;

    this.stopWatching();

    if (callback) {
      callback();
    }

  }

}