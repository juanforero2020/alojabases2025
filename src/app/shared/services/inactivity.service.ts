import { Injectable } from '@angular/core';
import { DatosConfiguracionService } from 'src/app/servicios/datosConfiguracion.service';

/** Valor por defecto de minutos de inactividad si no viene en configuración */
const DEFAULT_MINUTOS_INACTIVIDAD = 30;

@Injectable()
export class InactivityService {
  private timeoutId: any;
  private listeners: Array<() => void> = [];
  private onInactivityCallback: (() => void) | null = null;

  constructor(private datosConfiguracionService: DatosConfiguracionService) {}

  /**
   * Inicia la vigilancia de inactividad. Ante cualquier interacción (ratón, teclado, touch)
   * se reinicia el temporizador. El tiempo en minutos se obtiene de la configuración (minutosInactividad).
   * @param onInactivity Callback a ejecutar cuando se detecte inactividad (ej: cerrar sesión).
   */
  startWatching(onInactivity: () => void): void {
    this.stopWatching();
    this.onInactivityCallback = onInactivity;

    this.datosConfiguracionService.getDatosConfiguracion().subscribe({
      next: (config) => {
        const minutos = config?.[0]?.minutosInactividad ?? DEFAULT_MINUTOS_INACTIVIDAD;
        console.log('minutos', minutos);
        const inactivityTimeoutMs = minutos * 60 * 1000;
        this.startWatchingWithTimeout(onInactivity, inactivityTimeoutMs);
      },
      error: () => {
        const inactivityTimeoutMs = DEFAULT_MINUTOS_INACTIVIDAD * 60 * 1000;
        this.startWatchingWithTimeout(onInactivity, inactivityTimeoutMs);
      }
    });
  }

  private startWatchingWithTimeout(onInactivity: () => void, inactivityTimeoutMs: number): void {
    this.onInactivityCallback = onInactivity;

    const resetTimer = () => {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
      }
      this.timeoutId = setTimeout(() => this.handleInactivity(), inactivityTimeoutMs);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(eventName => {
      const handler = () => resetTimer();
      document.addEventListener(eventName, handler);
      this.listeners.push(() => document.removeEventListener(eventName, handler));
    });

    resetTimer();
  }

  /**
   * Detiene la vigilancia y elimina los listeners.
   */
  stopWatching(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
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
