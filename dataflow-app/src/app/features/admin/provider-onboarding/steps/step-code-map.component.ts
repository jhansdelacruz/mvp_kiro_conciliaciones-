// Paso 4 — Homologar códigos de respuesta.
// Tabla prefijada con los códigos técnicos que el adaptador genérico puede
// emitir; permite agregar códigos propios del proveedor. Sin mapear => 99 con
// alerta ámbar (design.md §7.4).

import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { WizardStateService } from '../services/wizard-state.service';
import { CodeMapEntry, HubCode } from '../models/onboarding.model';

const DEFAULT_CODE_MAP: CodeMapEntry[] = [
  { providerCode: 'OK', providerLabel: 'Operación exitosa', hubCode: '00', isDefault: true },
  { providerCode: 'AMOUNT_INVALID', providerLabel: 'Monto inválido', hubCode: '12', isDefault: true },
  { providerCode: 'CURRENCY_UNSUPPORTED', providerLabel: 'Moneda no soportada', hubCode: '30', isDefault: true },
  { providerCode: 'TIMEOUT', providerLabel: 'Timeout del proveedor', hubCode: '21', isDefault: true },
  { providerCode: 'SECURITY_ERROR', providerLabel: 'Error de seguridad', hubCode: '91', isDefault: true },
  { providerCode: 'FORMAT_ERROR', providerLabel: 'Error de formato', hubCode: '90', isDefault: true }
];

@Component({
  selector: 'app-step-code-map',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './step-code-map.component.html',
  styleUrls: ['./step-code-map.component.scss']
})
export class StepCodeMapComponent implements OnInit {
  protected state = inject(WizardStateService);

  protected unmappedCount = computed(
    () => this.state.codeMap().filter((e) => e.providerCode.trim() && !e.hubCode).length
  );

  ngOnInit(): void {
    if (this.state.codeMap().length === 0) {
      this.state.codeMap.set(DEFAULT_CODE_MAP.map((e) => ({ ...e })));
    }
  }

  addCode(): void {
    this.state.codeMap.update((rows) => [
      ...rows,
      { providerCode: '', providerLabel: '', hubCode: '' as HubCode, isDefault: false }
    ]);
  }

  removeCode(index: number): void {
    this.state.codeMap.update((rows) => rows.filter((_, i) => i !== index));
  }

  updateField(index: number, field: 'providerCode' | 'providerLabel', value: string): void {
    this.state.codeMap.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  updateHubCode(index: number, hubCode: HubCode): void {
    this.state.codeMap.update((rows) => rows.map((r, i) => (i === index ? { ...r, hubCode } : r)));
  }
}
