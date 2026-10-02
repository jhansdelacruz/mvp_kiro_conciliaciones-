import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AUTH_SERVICE } from '../../../core/auth/auth-service.interface';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CommonModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss']
})
export class AdminLayoutComponent {
  private authService = inject(AUTH_SERVICE);
  private router = inject(Router);

  userName = computed(() => this.authService.currentUser()?.email ?? 'Administrador');

  async logout(): Promise<void> {
    await this.authService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
