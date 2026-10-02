import { Injectable, signal, Signal } from '@angular/core';
import { IAuthService } from './auth-service.interface';

@Injectable()
export class MockAuthService implements IAuthService {
  private _session = signal<{ email: string; role: 'admin' | 'client' } | null>(null);

  get currentUser(): Signal<{ email: string; role: 'admin' | 'client' } | null> {
    return this._session;
  }

  signIn(email: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (email === 'admin@dataflow.com' && password === 'Admin123!') {
          this._session.set({ email, role: 'admin' });
          resolve();
        } else if (email === 'cliente@empresa.com' && password === 'Cliente123!') {
          this._session.set({ email, role: 'client' });
          resolve();
        } else {
          reject(new Error('Credenciales incorrectas'));
        }
      }, 800);
    });
  }

  signOut(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this._session.set(null);
        resolve();
      }, 200);
    });
  }

  getCurrentUser(): Promise<any> {
    return Promise.resolve(this._session());
  }

  getUserRole(): Promise<'admin' | 'client'> {
    return Promise.resolve(this._session()?.role ?? 'client');
  }

  getJwtToken(): Promise<string> {
    return Promise.resolve('mock-jwt-token-' + Date.now());
  }

  isAuthenticated(): Promise<boolean> {
    return Promise.resolve(this._session() !== null);
  }
}
