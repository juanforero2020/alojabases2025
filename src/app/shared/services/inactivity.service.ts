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
  /** Momento en que la pestaña pasó a segundo plano (para móviles). */
  private hiddenAt: number | null = null;

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

    this.hiddenAt = null;

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

    // Crítico para móviles: al salir guardamos cuándo se ocultó; al volver comprobamos tiempo oculto
    const visibilityHandler = () => {
      if (document.hidden) {
        this.hiddenAt = Date.now();
      } else {
        // El usuario volvió a la pestaña (o a la app en móvil)
        if (this.hiddenAt !== null) {
          const hiddenDurationMs = Date.now() - this.hiddenAt;
          if (hiddenDurationMs >= this.inactivityTimeoutMs) {
            this.ngZone.run(() => this.handleInactivity());
            return;
          }
          this.hiddenAt = null;
        }
        this.lastActivity = Date.now();
      }
    };

    document.addEventListener('visibilitychange', visibilityHandler);

    this.listeners.push(() =>
      document.removeEventListener('visibilitychange', visibilityHandler)
    );

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
    this.hiddenAt = null;

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