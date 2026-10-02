// Paso 2 — Cargar el estándar de API y detectar campos.
// Materializa el "backend se detiene": tras analizar, se muestra la tabla de
// campos detectados y un checkbox de confirmación manual (fieldsConfirmed) que
// bloquea el avance hasta que el operador verifique (design.md §7.2).

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { WizardStateService } from '../services/wizard-state.service';
import { OnboardingService } from '../services/onboarding.service';
import { getDemoPayload } from '../services/demo-payloads';
import { Protocol } from '../models/onboarding.model';

@Component({
  selector: 'app-step-parse-spec',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule
  ],
  templateUrl: './step-parse-spec.component.html',
  styleUrls: ['./step-parse-spec.component.scss']
})
export class StepParseSpecComponent {
  protected state = inject(WizardStateService);
  private onboarding = inject(OnboardingService);

  protected analyzing = signal(false);
  protected error = signal<string | null>(null);

  protected get protocol(): Protocol {
    return this.state.providerData()?.protocol ?? 'REST_JSON';
  }

  protected onSpecChange(value: string): void {
    this.state.rawSpec.set(value);
    // Al cambiar el texto se invalida el análisis previo y la confirmación.
    this.state.fieldsConfirmed.set(false);
    this.state.parseResult.set(null);
    this.error.set(null);
  }

  protected loadDemo(): void {
    const demo = getDemoPayload(this.protocol);
    this.onSpecChange(demo);
  }

  protected analyze(): void {
    this.error.set(null);
    this.analyzing.set(true);
    this.onboarding.parseSpec({ protocol: this.protocol, spec: this.state.rawSpec() }).subscribe({
      next: (result) => {
        this.state.parseResult.set(result);
        this.state.fieldsConfirmed.set(false);
        this.analyzing.set(false);
      },
      error: (err: Error) => {
        this.state.parseResult.set(null);
        this.error.set(err.message);
        this.analyzing.set(false);
      }
    });
  }

  protected toggleConfirmed(checked: boolean): void {
    this.state.fieldsConfirmed.set(checked);
  }
}
