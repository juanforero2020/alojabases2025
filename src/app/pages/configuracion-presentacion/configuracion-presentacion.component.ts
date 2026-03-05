import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import {
  DatosConfiguracionService,
  DatosConfiguracion,
} from 'src/app/servicios/datosConfiguracion.service';

@Component({
  selector: 'app-configuracion-presentacion',
  templateUrl: './configuracion-presentacion.component.html',
  styleUrls: ['./configuracion-presentacion.component.scss'],
})
export class ConfiguracionPresentacionComponent implements OnInit {
  /** Primer registro de configuración (si existe). */
  primerRegistro: DatosConfiguracion | null = null;
  /** Valor editable: solo minutos de inactividad. */
  minutosInactividad: number | null = null;
  cargando = true;

  constructor(private configuracionService: DatosConfiguracionService) {}

  ngOnInit() {
    this.cargarPrimerRegistro();
  }

  cargarPrimerRegistro() {
    this.cargando = true;
    this.configuracionService.getDatosConfiguracion().subscribe({
      next: (res) => {
        const lista = (res || []) as DatosConfiguracion[];
        this.primerRegistro = lista.length > 0 ? lista[0] : null;
        this.minutosInactividad =
          this.primerRegistro?.minutosInactividad ?? null;
        this.cargando = false;
      },
      error: () => {
        this.cargando = false;
        Swal.fire({
          title: 'Error',
          text: 'No se pudo cargar la configuración',
          icon: 'error',
        });
      },
    });
  }

  guardar() {
    const minutos = this.minutosInactividad;
    if (minutos == null || minutos === undefined || minutos < 1) {
      Swal.fire({
        title: 'Dato requerido',
        text: 'Ingrese los minutos de inactividad (mínimo 1).',
        icon: 'warning',
      });
      return;
    }

    const valor = Number(minutos);

    if (this.primerRegistro?._id) {
      this.configuracionService
        .update(this.primerRegistro._id, {
          id: this.primerRegistro.id,
          //urlImage: this.primerRegistro.urlImage,
          minutosInactividad: valor,
        })
        .subscribe({
          next: () => {
            Swal.fire('Correcto', 'Configuración actualizada', 'success');
            this.primerRegistro = { ...this.primerRegistro!, minutosInactividad: valor };
          },
          error: () => {
            Swal.fire('Error', 'No se pudo actualizar', 'error');
          },
        });
    } else {
      this.configuracionService
        .create({ minutosInactividad: valor })
        .subscribe({
          next: (creado) => {
            Swal.fire('Correcto', 'Configuración guardada', 'success');
            this.primerRegistro = creado as DatosConfiguracion;
            this.minutosInactividad = valor;
          },
          error: () => {
            Swal.fire('Error', 'No se pudo guardar', 'error');
          },
        });
    }
  }
}
