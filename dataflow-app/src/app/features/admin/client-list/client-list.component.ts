import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Client } from '../../../shared/models/client.model';
import { ClientService } from '../../../core/services/client.service';

@Component({
  selector: 'app-client-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule
  ],
  templateUrl: './client-list.component.html',
  styleUrls: ['./client-list.component.scss']
})
export class ClientListComponent implements OnInit {
  private clientService = inject(ClientService);
  private router = inject(Router);

  allClients = signal<Client[]>([]);
  searchQuery = signal<string>('');
  isLoading = signal(true);

  filteredClients = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.allClients();
    return this.allClients().filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q)
    );
  });

  totalClients = computed(() => this.allClients().length);
  activeClients = computed(() =>
    this.allClients().filter((c) => c.status === 'ACTIVE').length
  );
  totalProcesses = computed(() =>
    this.allClients().reduce((sum, c) => sum + (c.totalProcesses ?? 0), 0)
  );

  displayedColumns: string[] = [
    'avatar', 'name', 'email', 'deliveryMethod', 'status', 'totalProcesses', 'actions'
  ];

  ngOnInit(): void {
    this.clientService.getClients().subscribe((data) => {
      this.allClients.set(data);
      this.isLoading.set(false);
    });
  }

  onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  navigateToNew(): void {
    this.router.navigate(['/admin/clients/new']);
  }

  navigateToNewProvider(): void {
    this.router.navigate(['/admin/providers/new']);
  }

  editClient(id: string): void {
    this.router.navigate(['/admin/clients', id]);
  }

  deactivateClient(client: Client): void {
    this.clientService.deactivateClient(client.clientId).subscribe(() => {
      this.clientService.getClients().subscribe((data) => this.allClients.set(data));
    });
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  getAvatarColor(name: string): string {
    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'
    ];
    return colors[name.charCodeAt(0) % colors.length];
  }
}
