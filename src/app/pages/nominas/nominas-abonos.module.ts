import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  DxLoadIndicatorModule,
  DxNumberBoxModule,
  DxSelectBoxModule,
  DxTextBoxModule,
} from "devextreme-angular";
import { NominasAbonosComponent } from "./nominas-abonos.component";

@NgModule({
  declarations: [NominasAbonosComponent],
  imports: [
    CommonModule,
    DxSelectBoxModule,
    DxTextBoxModule,
    DxNumberBoxModule,
    DxLoadIndicatorModule,
  ],
  exports: [NominasAbonosComponent],
})
export class NominasAbonosModule {}
