// Paso 1 — Datos del proveedor.
// FIX-1 (opción b): el formulario reactivo vive en este hijo y escribe
// state.providerData en cada valueChanges. El componente NO posee control del
// stepper; su validez se refleja únicamente a través de state.step1Valid().

import { Component, DestroyRef, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { WizardStateService } from '../services/wizard-state.service';
import { Protocol, ProviderData, ProviderOperation, SecurityType } from '../models/onboarding.model';

@Component({
  selector: 'app-step-provider-data',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule
  ],
  templateUrl: './step-provider-data.component.html',
  styleUrls: ['./step-provider-data.component.scss']
})
export class StepProviderDataComponent implements OnInit {
  protected state = inject(WizardStateService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  protected providerId = '';

  protected readonly protocols: Protocol[] = [
    'REST_JSON',
    'BIAN_JSON',
    'SOAP_XML',
    'ISO8583',
    'POSICIONAL'
  ];
  protected readonly securityTypes: SecurityType[] = [
    'NINGUNA',
    'API_KEY',
    'OAUTH2',
    'MTLS',
    'HMAC'
  ];
  protected readonly currencyOptions = ['PEN', 'USD', 'EUR', 'CLP', 'COP', 'MXN'];

  form!: FormGroup;

  constructor() {
    // Hidratación en modo EDIT: loadConfig() puebla providerData de forma
    // asíncrona después de ngOnInit (el contenido del step se renderiza eager),
    // por lo que re-poblamos el formulario cuando llega una config externa.
    effect(() => {
      const data = this.state.providerData();
      if (!this.form || !data || data.providerId === this.providerId) {
        return;
      }
      this.providerId = data.providerId;
      this.form.patchValue(
        {
          name: data.name,
          rubro: data.rubro,
          protocol: data.protocol,
          securityType: data.securityType,
          currencies: data.currencies,
          opPago: data.operations.includes('PAGO'),
          opEstado: data.operations.includes('ESTADO'),
          opExtorno: data.operations.includes('EXTORNO'),
          refMin: data.clientReference.minLength,
          refMax: data.clientReference.maxLength,
          timeoutMs: data.timeoutMs
        },
        { emitEvent: false }
      );
    });
  }

  protected get derivedPattern(): string {
    const min = this.form?.get('refMin')?.value ?? 5;
    const max = this.form?.get('refMax')?.value ?? 10;
    return `^\\d{${min},${max}}$`;
  }

  ngOnInit(): void {
    const existing = this.state.providerData();
    this.providerId = existing?.providerId ?? `prov-${Date.now()}`;

    this.form = this.fb.group({
      name: [existing?.name ?? '', Validators.required],
      rubro: [existing?.rubro ?? '', Validators.required],
      protocol: [existing?.protocol ?? 'REST_JSON', Validators.required],
      securityType: [existing?.securityType ?? 'NINGUNA', Validators.required],
      currencies: [existing?.currencies ?? ['PEN'], Validators.required],
      opPago: [existing?.operations?.includes('PAGO') ?? false],
      opEstado: [existing?.operations?.includes('ESTADO') ?? false],
      opExtorno: [existing?.operations?.includes('EXTORNO') ?? false],
      refMin: [
        existing?.clientReference.minLength ?? 5,
        [Validators.required, Validators.min(5), Validators.max(10)]
      ],
      refMax: [
        existing?.clientReference.maxLength ?? 10,
        [Validators.required, Validators.min(5), Validators.max(10)]
      ],
      timeoutMs: [
        existing?.timeoutMs ?? 8000,
        [Validators.required, Validators.min(1000), Validators.max(60000)]
      ]
    });

    this.form.valueChanges
      .pipe(startWith(this.form.value), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncState());
  }

  private syncState(): void {
    const v = this.form.getRawValue();
    const operations: ProviderOperation[] = ['CONSULTA'];
    if (v.opPago) operations.push('PAGO');
    if (v.opEstado) operations.push('ESTADO');
    if (v.opExtorno) operations.push('EXTORNO');

    const minLength = Number(v.refMin);
    const maxLength = Number(v.refMax);

    const data: ProviderData = {
      providerId: this.providerId,
      name: (v.name ?? '').trim(),
      rubro: (v.rubro ?? '').trim(),
      protocol: v.protocol,
      securityType: v.securityType,
      currencies: v.currencies ?? [],
      operations,
      timeoutMs: Number(v.timeoutMs),
      clientReference: {
        type: 'NUMERICO',
        minLength,
        maxLength,
        pattern: `^\\d{${minLength},${maxLength}}$`
      }
    };

    this.state.providerData.set(data);
  }
}
