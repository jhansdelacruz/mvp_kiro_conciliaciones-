// Catálogo de proveedores: bloque "Referencia" (estáticos) + bloque "Dinámico"
// (dados de alta por el wizard). Los dinámicos se reabren o eliminan
// (design.md §1.3).

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { OnboardingService } from './services/onboarding.service';
import { ProviderSummary } from './models/onboarding.model';

@Component({
  selector: 'app-provider-list',
  standalone: true,
  imports: [CommonModule, MatButtonModule],
  templateUrl: './provider-list.component.html',
  styleUrls: ['./provider-list.component.scss']
})
export class ProviderListComponent implements OnInit {
  private onboarding = inject(OnboardingService);
  private router = inject(Router);

  protected estaticos = signal<ProviderSummary[]>([]);
  protected dinamicos = signal<ProviderSummary[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.onboarding.listProviders().subscribe((result) => {
      this.estaticos.set(result.estaticos);
      this.dinamicos.set(result.dinamicos);
      this.loading.set(false);
    });
  }

  navigateToNewProvider(): void {
    this.router.navigate(['/admin/providers/new']);
  }

  openProvider(id: string): void {
    this.router.navigate(['/admin/providers', id]);
  }

  deleteProvider(provider: ProviderSummary): void {
    const confirmed = window.confirm(`¿Eliminar el proveedor "${provider.name}"?`);
    if (!confirmed) {
      return;
    }
    this.onboarding.deleteProvider(provider.providerId).subscribe(() => this.load());
  }
}
