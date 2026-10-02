import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AUTH_SERVICE } from '../../../core/auth/auth-service.interface';

@Component({
  selector: 'app-client-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CommonModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './client-layout.component.html',
  styleUrls: ['./client-layout.component.scss']
})
export class ClientLayoutComponent {
  private authService = inject(AUTH_SERVICE);
  private router = inject(Router);

  userName = computed(() => this.authService.currentUser()?.email ?? 'Usuario');

  async logout(): Promise<void> {
    await this.authService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
