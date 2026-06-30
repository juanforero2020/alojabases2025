import Swal from "sweetalert2";

const SWAL_NOMINA_ERROR_CLASS = "swal-nomina-sobre-popup";
const SWAL_NOMINA_Z_INDEX = "2147483646";

function normalizarErrorHttp(err: any): any {
  if (typeof err === "function") {
    try {
      return err();
    } catch (error) {
      return error;
    }
  }
  return err;
}

function normalizarCuerpoError(cuerpo: unknown): unknown {
  if (cuerpo == null) {
    return null;
  }

  if (typeof cuerpo === "string") {
    const trimmed = cuerpo.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  return cuerpo;
}

export function obtenerMensajeErrorApi(
  err: any,
  mensajePorDefecto: string
): string {
  const errorHttp = normalizarErrorHttp(err);
  const cuerpo = normalizarCuerpoError(errorHttp?.error);

  if (typeof cuerpo === "string") {
    return cuerpo;
  }

  if (cuerpo && typeof cuerpo === "object") {
    const obj = cuerpo as Record<string, unknown>;
    if (obj.mensaje != null && String(obj.mensaje).trim()) {
      return String(obj.mensaje);
    }
    if (obj.message != null && String(obj.message).trim()) {
      return String(obj.message);
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return obj.error.trim();
    }
    if (obj.errors && typeof obj.errors === "object") {
      const detalles = Object.values(obj.errors as Record<string, unknown>)
        .map((e: any) => e?.message)
        .filter(Boolean);
      if (detalles.length) {
        return detalles.join(" ");
      }
    }
  }

  if (errorHttp?.message && !String(errorHttp.message).startsWith("Http failure")) {
    return String(errorHttp.message);
  }

  if (errorHttp?.status) {
    return `${mensajePorDefecto} (código ${errorHttp.status})`;
  }

  return mensajePorDefecto;
}

function elevarSwalSobrePopups(): void {
  document.querySelectorAll(".swal2-container").forEach((el) => {
    const node = el as HTMLElement;
    node.classList.add(SWAL_NOMINA_ERROR_CLASS);
    node.style.setProperty("z-index", SWAL_NOMINA_Z_INDEX, "important");
    node.style.setProperty("position", "fixed", "important");
  });

  const popup = Swal.getPopup();
  if (popup) {
    popup.style.setProperty("z-index", SWAL_NOMINA_Z_INDEX, "important");
  }
}

export function mostrarPopupErrorNomina(titulo: string, mensaje: string): void {
  Swal.fire({
    title: titulo,
    text: mensaje,
    icon: "error",
    confirmButtonText: "Ok",
    target: "body",
    customClass: {
      container: SWAL_NOMINA_ERROR_CLASS,
    },
    onOpen: elevarSwalSobrePopups,
  });
}

export function mostrarErrorNominaApi(
  titulo: string,
  err: any,
  mensajePorDefecto: string
): void {
  const mensaje = obtenerMensajeErrorApi(err, mensajePorDefecto);
  mostrarPopupErrorNomina(titulo, mensaje);
}
