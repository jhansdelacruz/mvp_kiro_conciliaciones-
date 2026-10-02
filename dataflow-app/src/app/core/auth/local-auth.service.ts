import { Injectable, inject, signal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IAuthService } from './auth-service.interface';
import { environment } from '../../../environments/environment';

interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  role: 'admin' | 'client';
  email: string;
}

@Injectable()
export class LocalAuthService implements IAuthService {
  private http = inject(HttpClient);
  private _currentUser = signal<{ email: string; role: 'admin' | 'client' } | null>(null);
  private idToken: string | null = null;

  get currentUser(): Signal<{ email: string; role: 'admin' | 'client' } | null> {
    return this._currentUser;
  }

  async signIn(email: string, password: string): Promise<void> {
    // POST {apiUrl}/auth/login  => { idToken, accessToken, refreshToken, role, email }
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      );
      this.idToken = res.idToken;
      this._currentUser.set({ email: res.email, role: res.role });
    } catch (err: any) {
      // HttpClient rechaza con HttpErrorResponse: su .message es el texto HTTP genérico de Angular;
      // el mensaje en español del backend viaja en .error.message. Re-lanzamos con ese texto para
      // que login.component.ts (que lee e.message) muestre "Credenciales incorrectas", igual que
      // MockAuthService. Así se preserva la paridad SIN tocar el componente de login.
      throw new Error(err?.error?.message ?? 'Credenciales incorrectas');
    }
  }

  async signOut(): Promise<void> { this.idToken = null; this._currentUser.set(null); }
  async getCurrentUser(): Promise<any> { return this._currentUser(); }
  async getUserRole(): Promise<'admin' | 'client'> { return this._currentUser()?.role ?? 'client'; }
  async getJwtToken(): Promise<string> { return this.idToken ?? ''; }   // interceptor usa idToken
  async isAuthenticated(): Promise<boolean> { return this._currentUser() !== null; }
}
