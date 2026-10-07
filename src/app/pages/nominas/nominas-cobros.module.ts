import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  DxDataGridModule,
  DxLoadIndicatorModule,
  DxSelectBoxModule,
  DxTextBoxModule,
} from "devextreme-angular";
import { NominasCobrosComponent } from "./nominas-cobros.component";

@NgModule({
  declarations: [NominasCobrosComponent],
  imports: [
    CommonModule,
    DxDataGridModule,
    DxSelectBoxModule,
    DxTextBoxModule,
    DxLoadIndicatorModule,
  ],
  exports: [NominasCobrosComponent],
})
export class NominasCobrosModule {}
