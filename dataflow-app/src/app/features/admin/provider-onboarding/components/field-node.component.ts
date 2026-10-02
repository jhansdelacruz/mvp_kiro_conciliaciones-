// Nodo clicable del match visual (campo canónico o del proveedor).
// Accesible: role=button, tabindex=0, aria-pressed, Enter/Espacio. Expone
// getAnchorRect() para que el canvas calcule las líneas SVG (design.md §9.3).

import { Component, ElementRef, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-field-node',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './field-node.component.html',
  styleUrls: ['./field-node.component.scss']
})
export class FieldNodeComponent {
  @Input({ required: true }) path!: string;
  @Input({ required: true }) label!: string;
  @Input() sample = '';
  @Input() side: 'canonical' | 'provider' = 'canonical';
  @Input() selected = false;
  @Input() linked = false;
  @Input() required = false;
  /** Descripción del enlace para el lector de pantalla (p. ej. "DE2"). */
  @Input() linkedTo: string | null = null;

  @Output() activate = new EventEmitter<string>();

  private host = inject(ElementRef<HTMLElement>);

  get ariaLabel(): string {
    const base = `${this.label}${this.required ? ' (obligatorio)' : ''}`;
    if (this.linked) {
      return `${base}, enlazado${this.linkedTo ? ' a ' + this.linkedTo : ''}`;
    }
    if (this.selected) {
      return `${base}, seleccionado`;
    }
    return base;
  }

  onActivate(): void {
    this.activate.emit(this.path);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.onActivate();
    }
  }

  /** Rectángulo del nodo en coordenadas de viewport, usado por el canvas SVG. */
  getAnchorRect(): DOMRect {
    const el = this.host.nativeElement.querySelector('.field-node') as HTMLElement | null;
    return (el ?? this.host.nativeElement).getBoundingClientRect();
  }
}
