// Canvas de match visual: dos columnas de FieldNodeComponent (canónico /
// proveedor) y un overlay SVG que dibuja las líneas de cada FieldLink.
// Se instancia dos veces en el Paso 3 (sub-tabs CONSULTA / PAGO), con conjuntos
// de enlaces independientes (design.md §9).

import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CanonicalField, FieldLink, ProviderField } from '../models/onboarding.model';
import { FieldNodeComponent } from './field-node.component';

/** Coordenadas de una línea SVG, relativas al contenedor del overlay. */
export interface LineCoord {
  id: string;
  d: string;
}

/**
 * Geometría pura (testeable sin DOM): calcula el path Bézier horizontal entre
 * el borde derecho del nodo canónico y el borde izquierdo del nodo proveedor,
 * en coordenadas relativas al rectángulo del SVG.
 */
export function computeLine(rectA: DOMRect, rectB: DOMRect, rectSvg: DOMRect): LineCoord {
  const x1 = rectA.right - rectSvg.left;
  const y1 = rectA.top + rectA.height / 2 - rectSvg.top;
  const x2 = rectB.left - rectSvg.left;
  const y2 = rectB.top + rectB.height / 2 - rectSvg.top;
  const mx = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  return { id: '', d };
}

@Component({
  selector: 'app-field-match-canvas',
  standalone: true,
  imports: [CommonModule, FieldNodeComponent],
  templateUrl: './field-match-canvas.component.html',
  styleUrls: ['./field-match-canvas.component.scss']
})
export class FieldMatchCanvasComponent implements AfterViewInit, OnDestroy {
  canonicalFields = input<CanonicalField[]>([]);
  providerFields = input<ProviderField[]>([]);
  links = input<FieldLink[]>([]);

  @Output() link = new EventEmitter<{ canonicalPath: string; providerPath: string }>();
  @Output() unlink = new EventEmitter<string>();

  @ViewChild('svg') svgRef?: ElementRef<SVGSVGElement>;
  @ViewChildren(FieldNodeComponent) nodes!: QueryList<FieldNodeComponent>;

  private injector = inject(Injector);

  selectedCanonical = signal<string | null>(null);
  lines = signal<LineCoord[]>([]);

  private scrollHandler = (): void => this.recomputeNow();

  // Lista accesible de enlaces (texto) debajo del canvas.
  linkDescriptions = computed(() =>
    this.links().map((l) => ({
      canonical: this.canonicalLabel(l.canonicalPath),
      provider: this.providerLabel(l.providerPath)
    }))
  );

  constructor() {
    // Recalcular las líneas cuando cambian los enlaces o los campos. La escritura
    // de lines() ocurre dentro de afterNextRender para medir el DOM ya pintado.
    effect(() => {
      this.links();
      this.providerFields();
      this.canonicalFields();
      afterNextRender(() => this.lines.set(this.computeLines()), { injector: this.injector });
    });
  }

  ngAfterViewInit(): void {
    // Scroll en fase de captura a nivel document: cubre el contenedor scrolleable
    // del layout (main.content) sin acoplarse a su DOM (design.md §9.2).
    document.addEventListener('scroll', this.scrollHandler, true);
    this.requestRecompute();
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.scrollHandler, true);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.recomputeNow();
  }

  /** Recalcula tras el próximo render (cambios de layout, cambio de sub-tab). */
  requestRecompute(): void {
    afterNextRender(() => this.lines.set(this.computeLines()), { injector: this.injector });
  }

  // --- interacción ---

  isCanonicalLinked(path: string): boolean {
    return this.links().some((l) => l.canonicalPath === path);
  }

  isProviderLinked(path: string): boolean {
    return this.links().some((l) => l.providerPath === path);
  }

  linkedProviderFor(canonicalPath: string): string | null {
    const found = this.links().find((l) => l.canonicalPath === canonicalPath);
    return found ? this.providerLabel(found.providerPath) : null;
  }

  onCanonicalActivate(path: string): void {
    if (this.isCanonicalLinked(path)) {
      // Clic en un canónico enlazado => quitar enlace (toggle).
      this.unlink.emit(path);
      this.selectedCanonical.set(null);
      return;
    }
    this.selectedCanonical.set(this.selectedCanonical() === path ? null : path);
  }

  onProviderActivate(path: string): void {
    const canonical = this.selectedCanonical();
    if (!canonical) {
      return;
    }
    this.link.emit({ canonicalPath: canonical, providerPath: path });
    this.selectedCanonical.set(null);
  }

  // --- labels ---

  canonicalLabel(path: string): string {
    return this.canonicalFields().find((f) => f.path === path)?.label ?? path;
  }

  providerLabel(path: string): string {
    return this.providerFields().find((f) => f.path === path)?.label ?? path;
  }

  // --- geometría ---

  private recomputeNow(): void {
    this.lines.set(this.computeLines());
  }

  private computeLines(): LineCoord[] {
    const svg = this.svgRef?.nativeElement;
    if (!svg || !this.nodes) {
      return [];
    }
    const rectSvg = svg.getBoundingClientRect();
    const findNode = (side: 'canonical' | 'provider', path: string): FieldNodeComponent | undefined =>
      this.nodes.find((n) => n.side === side && n.path === path);

    const result: LineCoord[] = [];
    for (const l of this.links()) {
      const a = findNode('canonical', l.canonicalPath);
      const b = findNode('provider', l.providerPath);
      if (!a || !b) {
        continue;
      }
      const geo = computeLine(a.getAnchorRect(), b.getAnchorRect(), rectSvg);
      result.push({ id: l.canonicalPath, d: geo.d });
    }
    return result;
  }
}
