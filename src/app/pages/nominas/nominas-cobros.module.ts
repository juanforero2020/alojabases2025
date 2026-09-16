import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  DxLoadIndicatorModule,
  DxSelectBoxModule,
  DxTextBoxModule,
} from "devextreme-angular";
import { NominasCobrosComponent } from "./nominas-cobros.component";

@NgModule({
  declarations: [NominasCobrosComponent],
  imports: [
    CommonModule,
    DxSelectBoxModule,
    DxTextBoxModule,
    DxLoadIndicatorModule,
  ],
  exports: [NominasCobrosComponent],
})
export class NominasCobrosModule {}
