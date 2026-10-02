import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AUTH_SERVICE } from '../../../core/auth/auth-service.interface';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private authService = inject(AUTH_SERVICE);
  private router = inject(Router);

  isLoading = signal(false);
  errorMessage = signal<string | null>(null);

  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(6)])
  });

  async onSubmit(): Promise<void> {
    if (this.form.invalid) return;

    const email = this.form.value.email!;
    const password = this.form.value.password!;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      await this.authService.signIn(email, password);
      const role = await this.authService.getUserRole();
      if (role === 'admin') {
        this.router.navigate(['/admin/clients']);
      } else {
        this.router.navigate(['/client/dashboard']);
      }
    } catch (e: any) {
      this.errorMessage.set(e?.message ?? 'Error al iniciar sesión');
    } finally {
      this.isLoading.set(false);
    }
  }
}
