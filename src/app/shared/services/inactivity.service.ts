import { Injectable } from '@angular/core';

/** Tiempo de inactividad en milisegundos (30 minutos) */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

@Injectable()
export class InactivityService {
  private timeoutId: any;
  private listeners: Array<() => void> = [];
  private onInactivityCallback: (() => void) | null = null;

  constructor() {}

  /**
   * Inicia la vigilancia de inactividad. Ante cualquier interacción (ratón, teclado, touch)
   * se reinicia el temporizador. Tras 30 minutos sin actividad se ejecuta el callback.
   * @param onInactivity Callback a ejecutar cuando se detecte inactividad (ej: cerrar sesión).
   */
  startWatching(onInactivity: () => void): void {
    this.stopWatching();
    this.onInactivityCallback = onInactivity;

    const resetTimer = () => {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
      }
      this.timeoutId = setTimeout(() => this.handleInactivity(), INACTIVITY_TIMEOUT_MS);
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
