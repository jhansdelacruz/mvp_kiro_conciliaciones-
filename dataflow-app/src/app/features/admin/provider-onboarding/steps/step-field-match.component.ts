// Paso 3 — Match visual de campos (dos sub-tabs: CONSULTA y PAGO).
// Reutiliza FieldMatchCanvasComponent por sub-tab, con conjuntos de enlaces
// independientes. Autosuggest por similitud y selector de transformación por
// enlace (design.md §7.3, §8).

import { Component, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { WizardStateService } from '../services/wizard-state.service';
import { FieldMatchCanvasComponent } from '../components/field-match-canvas.component';
import { CanonicalField, FieldLink, MappingKind, Protocol, TransformationId } from '../models/onboarding.model';
import { autosuggestLinks, defaultTransformation } from '../services/transformations';

interface TransformOption {
  id: TransformationId;
  label: string;
}

const PAGO_REQUIRED = ['obligationId', 'paymentAmount.amount', 'paymentAmount.currency'];

// Reuso Consulta -> Pago por campo homónimo (canónico pago -> canónico consulta).
const PAGO_HOMONYMS: Record<string, string> = {
  'payerReference.referenceValue': 'payerReference.referenceValue',
  obligationId: 'obligations[].obligationId',
  'paymentAmount.amount': 'obligations[].totalAmount',
  'paymentAmount.currency': 'obligations[].currency'
};

@Component({
  selector: 'app-step-field-match',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    FieldMatchCanvasComponent
  ],
  templateUrl: './step-field-match.component.html',
  styleUrls: ['./step-field-match.component.scss']
})
export class StepFieldMatchComponent {
  protected state = inject(WizardStateService);

  @ViewChildren(FieldMatchCanvasComponent) canvases!: QueryList<FieldMatchCanvasComponent>;

  protected activeTab = signal<MappingKind>('CONSULTA');

  protected readonly transformOptions: TransformOption[] = [
    { id: 'NONE', label: 'Sin transformación' },
    { id: 'AMOUNT_FLOAT_TO_DECIMAL', label: 'Monto float → decimal' },
    { id: 'AMOUNT_IMPLICIT_TO_DECIMAL', label: 'Monto implícito (12 díg.) → decimal' },
    { id: 'CURRENCY_PROVIDER_TO_ISO', label: 'Moneda proveedor → ISO 4217' },
    { id: 'DATE_DDMMYYYY_TO_ISO', label: 'Fecha dd/MM/yyyy → ISO 8601' },
    { id: 'DATE_YYYYMMDD_TO_ISO', label: 'Fecha AAAAMMDD → ISO 8601' },
    { id: 'DECIMAL_TO_PROVIDER_DECIMAL', label: 'Decimal → decimal proveedor' },
    { id: 'DECIMAL_TO_PROVIDER_IMPLICIT', label: 'Decimal → implícito proveedor' },
    { id: 'CURRENCY_ISO_TO_PROVIDER_ALPHA', label: 'ISO → moneda alfa (SOL/DOL)' },
    { id: 'CURRENCY_ISO_TO_PROVIDER_NUM', label: 'ISO → moneda numérica (604/840)' }
  ];

  protected providerFields = computed(() => this.state.parseResult()?.fields ?? []);

  protected get protocol(): Protocol {
    return this.state.providerData()?.protocol ?? 'REST_JSON';
  }

  protected get showPago(): boolean {
    return this.state.providerData()?.operations.includes('PAGO') ?? false;
  }

  protected consultaLinks = computed(() => this.state.consultaLinks());
  protected pagoLinks = computed(() => this.state.pagoLinks());

  protected unlinkedRequired = computed(() => {
    const missing: string[] = [];
    for (const f of this.state.canonicalFields()) {
      if (f.required && !this.state.consultaLinks().some((l) => l.canonicalPath === f.path)) {
        missing.push(f.label);
      }
    }
    if (this.showPago) {
      const pagoFields = this.state.paymentFields();
      for (const path of PAGO_REQUIRED) {
        if (!this.state.pagoLinks().some((l) => l.canonicalPath === path)) {
          missing.push(pagoFields.find((f) => f.path === path)?.label ?? path);
        }
      }
    }
    return missing;
  });

  // --- interacción de enlaces ---

  private signalFor(kind: MappingKind) {
    return kind === 'CONSULTA' ? this.state.consultaLinks : this.state.pagoLinks;
  }

  private fieldsFor(kind: MappingKind): CanonicalField[] {
    return kind === 'CONSULTA' ? this.state.canonicalFields() : this.state.paymentFields();
  }

  onLink(kind: MappingKind, ev: { canonicalPath: string; providerPath: string }): void {
    const cf = this.fieldsFor(kind).find((f) => f.path === ev.canonicalPath);
    const pf = this.providerFields().find((f) => f.path === ev.providerPath);
    const transformation = cf
      ? defaultTransformation(cf.dataType, this.protocol, kind === 'CONSULTA' ? 'INPUT' : 'OUTPUT', pf?.sample)
      : 'NONE';
    const link: FieldLink = { canonicalPath: ev.canonicalPath, providerPath: ev.providerPath, transformation };
    this.signalFor(kind).update((links) => [
      ...links.filter((l) => l.canonicalPath !== ev.canonicalPath),
      link
    ]);
  }

  onUnlink(kind: MappingKind, canonicalPath: string): void {
    this.signalFor(kind).update((links) => links.filter((l) => l.canonicalPath !== canonicalPath));
  }

  onTransformChange(kind: MappingKind, canonicalPath: string, transformation: TransformationId): void {
    this.signalFor(kind).update((links) =>
      links.map((l) => (l.canonicalPath === canonicalPath ? { ...l, transformation } : l))
    );
  }

  // --- autosuggest ---

  suggest(): void {
    if (this.activeTab() === 'CONSULTA') {
      this.suggestConsulta();
    } else {
      this.suggestPago();
    }
    this.requestRecompute();
  }

  private suggestConsulta(): void {
    const links = autosuggestLinks(
      this.state.canonicalFields(),
      this.providerFields(),
      this.protocol,
      'INPUT'
    );
    this.state.consultaLinks.set(links);
  }

  private suggestPago(): void {
    const auto = autosuggestLinks(
      this.state.paymentFields(),
      this.providerFields(),
      this.protocol,
      'OUTPUT'
    );
    const byCanonical = new Map(auto.map((l) => [l.canonicalPath, l]));

    // Reusar lo enlazado en Consulta para los campos homónimos de Pago.
    for (const pagoField of this.state.paymentFields()) {
      if (byCanonical.has(pagoField.path)) {
        continue;
      }
      const consultaCanonical = PAGO_HOMONYMS[pagoField.path];
      if (!consultaCanonical) {
        continue;
      }
      const consultaLink = this.state.consultaLinks().find((l) => l.canonicalPath === consultaCanonical);
      if (consultaLink) {
        byCanonical.set(pagoField.path, {
          canonicalPath: pagoField.path,
          providerPath: consultaLink.providerPath,
          transformation: defaultTransformation(pagoField.dataType, this.protocol, 'OUTPUT')
        });
      }
    }
    this.state.pagoLinks.set([...byCanonical.values()]);
  }

  // --- tabs / recompute SVG ---

  onTabChange(index: number): void {
    this.activeTab.set(index === 1 ? 'PAGO' : 'CONSULTA');
    this.requestRecompute();
  }

  private requestRecompute(): void {
    this.canvases?.forEach((c) => c.requestRecompute());
  }
}
