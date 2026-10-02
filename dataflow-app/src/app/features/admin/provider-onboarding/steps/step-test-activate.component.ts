// Paso 5 — Probar y activar.
// Ejecuta la consulta (y el pago opcional) con el adaptador simulado, muestra el
// resultado canónico, el request construido y la traza. Activar solo se habilita
// si la consulta devolvió obligaciones (design.md §7.5).

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WizardStateService } from '../services/wizard-state.service';
import { OnboardingService } from '../services/onboarding.service';
import { ProviderConfig } from '../models/onboarding.model';
import { TracePanelComponent } from '../components/trace-panel.component';

@Component({
  selector: 'app-step-test-activate',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatSlideToggleModule, TracePanelComponent],
  templateUrl: './step-test-activate.component.html',
  styleUrls: ['./step-test-activate.component.scss']
})
export class StepTestActivateComponent {
  protected state = inject(WizardStateService);
  private onboarding = inject(OnboardingService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  protected testingConsulta = signal(false);
  protected testingPago = signal(false);
  protected activating = signal(false);

  // Toggles opcionales para demostrar caminos alternativos (design.md §5.2).
  protected forceNoDebt = signal(false);
  protected forcePaymentError = signal(false);

  protected get showPago(): boolean {
    const ops = this.state.providerData()?.operations ?? [];
    return ops.includes('PAGO') && this.state.pagoLinks().length > 0;
  }

  protected canPagar = computed(() => (this.state.consultaTest()?.obligations.length ?? 0) > 0);
  protected canActivate = computed(() => (this.state.consultaTest()?.obligations.length ?? 0) > 0);

  protected builtRequestEntries = computed(() => {
    const req = this.state.pagoTest()?.builtProviderRequest ?? {};
    return Object.keys(req).map((k) => ({ key: k, value: req[k] }));
  });

  probarConsulta(): void {
    this.testingConsulta.set(true);
    this.state.pagoTest.set(null);
    const config = this.buildConsultaConfig();
    this.onboarding.runTestConsulta(config).subscribe({
      next: (result) => {
        this.state.consultaTest.set(result);
        this.testingConsulta.set(false);
      },
      error: () => {
        this.testingConsulta.set(false);
        this.snackBar.open('Error al ejecutar la consulta de prueba.', 'Cerrar', { duration: 4000 });
      }
    });
  }

  probarPago(): void {
    const obligation = this.state.consultaTest()?.obligations[0];
    if (!obligation) {
      return;
    }
    this.testingPago.set(true);
    const config = this.state.toConfig();
    const target = this.forcePaymentError()
      ? { ...obligation, currency: 'XXX' } // moneda no soportada => rechazo (código 30)
      : obligation;
    this.onboarding.runTestPago(config, target).subscribe({
      next: (result) => {
        this.state.pagoTest.set(result);
        this.testingPago.set(false);
      },
      error: () => {
        this.testingPago.set(false);
        this.snackBar.open('Error al ejecutar el pago de prueba.', 'Cerrar', { duration: 4000 });
      }
    });
  }

  activar(): void {
    if (!this.canActivate()) {
      return;
    }
    this.activating.set(true);
    this.onboarding.saveProvider(this.state.toConfig()).subscribe({
      next: () => {
        this.snackBar.open('Proveedor activado y disponible en el catálogo.', 'Cerrar', {
          duration: 4000
        });
        this.router.navigate(['/admin/providers']);
      },
      error: () => {
        this.activating.set(false);
        this.snackBar.open('No se pudo activar el proveedor.', 'Cerrar', { duration: 4000 });
      }
    });
  }

  // Para forzar NO_DEBT se quita el mapeo de obligaciones de un config clonado.
  private buildConsultaConfig(): ProviderConfig {
    const config = this.state.toConfig();
    if (!this.forceNoDebt()) {
      return config;
    }
    return {
      ...config,
      mapping: config.mapping.filter((l) => !l.canonicalPath.startsWith('obligations[]'))
    };
  }
}
