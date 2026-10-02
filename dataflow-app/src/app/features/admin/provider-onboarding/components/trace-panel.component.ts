// Panel de trazabilidad: muestra la lista de TraceEntry de una ejecución de
// prueba junto con el X-Correlation-Id (design.md §9, §5.2).

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TraceEntry } from '../models/onboarding.model';

@Component({
  selector: 'app-trace-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trace-panel.component.html',
  styleUrls: ['./trace-panel.component.scss']
})
export class TracePanelComponent {
  @Input() entries: TraceEntry[] = [];
  @Input() correlationId = '';
}
