// Contenedor del wizard de alta de proveedores: MatStepper lineal + estado
// compartido (WizardStateService provisto a nivel de componente) + navegación.
// Carga los catálogos canónicos al iniciar y, con :id, reabre un proveedor
// dinámico guardado (design.md §2.1, §4.1).

import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { WizardStateService } from './services/wizard-state.service';
import { OnboardingService } from './services/onboarding.service';
import { StepProviderDataComponent } from './steps/step-provider-data.component';
import { StepParseSpecComponent } from './steps/step-parse-spec.component';
import { StepFieldMatchComponent } from './steps/step-field-match.component';
import { StepCodeMapComponent } from './steps/step-code-map.component';
import { StepTestActivateComponent } from './steps/step-test-activate.component';

@Component({
  selector: 'app-provider-wizard',
  standalone: true,
  imports: [
    CommonModule,
    MatStepperModule,
    MatButtonModule,
    StepProviderDataComponent,
    StepParseSpecComponent,
    StepFieldMatchComponent,
    StepCodeMapComponent,
    StepTestActivateComponent
  ],
  providers: [WizardStateService],
  templateUrl: './provider-wizard.component.html',
  styleUrls: ['./provider-wizard.component.scss']
})
export class ProviderWizardComponent implements OnInit {
  protected state = inject(WizardStateService);
  private onboarding = inject(OnboardingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  protected loading = signal(true);
  protected notFound = signal(false);

  protected isEditMode = computed(() => this.state.mode() === 'EDIT');
  protected title = computed(() =>
    this.isEditMode() ? 'Editar proveedor dinámico' : 'Alta de proveedor'
  );

  ngOnInit(): void {
    // Catálogos canónicos y códigos del Hub.
    this.onboarding.getCanonicalFields().subscribe((f) => this.state.canonicalFields.set(f));
    this.onboarding.getPaymentFields().subscribe((f) => this.state.paymentFields.set(f));
    this.onboarding.getHubCodes().subscribe((c) => this.state.hubCodes.set(c));

    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id: string | undefined = params['id'];
      if (id) {
        this.loadProvider(id);
      } else {
        this.state.reset();
        this.loading.set(false);
      }
    });
  }

  private loadProvider(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.onboarding.getProvider(id).subscribe({
      next: (config) => {
        this.state.loadConfig(config);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      }
    });
  }

  volverAlCatalogo(): void {
    this.router.navigate(['/admin/providers']);
  }
}
