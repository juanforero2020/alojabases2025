import { Injectable, NgZone } from '@angular/core';
import { DatosConfiguracionService } from 'src/app/servicios/datosConfiguracion.service';

const DEFAULT_MINUTOS_INACTIVIDAD = 30;

@Injectable({
  providedIn: 'root'
})
export class InactivityService {

  private checkIntervalId: any;
  private listeners: Array<() => void> = [];
  private onInactivityCallback: (() => void) | null = null;

  private lastActivity = Date.now();
  private inactivityTimeoutMs = DEFAULT_MINUTOS_INACTIVIDAD * 60 * 1000;

  constructor(
    private datosConfiguracionService: DatosConfiguracionService,
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

    // Al volver a la pestaña/app: si pasó más del tiempo de inactividad → cerrar sesión.
    // No dependemos de "hidden" (en móvil a veces no se dispara).
    const checkInactivityOnReturn = () => {
      const elapsed = Date.now() - this.lastActivity;
      if (elapsed >= this.inactivityTimeoutMs) {
        this.ngZone.run(() => this.handleInactivity());
      } else {
        this.lastActivity = Date.now();
      }
    };

    // 1) visibilitychange: estándar para pestaña/app visible de nuevo
    const visibilityHandler = () => {
      if (!document.hidden) {
        checkInactivityOnReturn();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.listeners.push(() =>
      document.removeEventListener('visibilitychange', visibilityHandler)
    );

    // 2) focus: en móviles a veces es más fiable que visibilitychange al volver
    const focusHandler = () => checkInactivityOnReturn();
    window.addEventListener('focus', focusHandler);
    this.listeners.push(() => window.removeEventListener('focus', focusHandler));

    // 3) pageshow: se dispara al volver desde bfcache o cambio de pestaña en varios móviles
    const pageShowHandler = (e: PageTransitionEvent) => {
      if (e.persisted || !document.hidden) {
        checkInactivityOnReturn();
      }
    };
    window.addEventListener('pageshow', pageShowHandler);
    this.listeners.push(() => window.removeEventListener('pageshow', pageShowHandler));

    this.lastActivity = Date.now();
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