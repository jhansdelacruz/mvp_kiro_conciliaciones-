import { InjectionToken, Signal } from '@angular/core';

export interface IAuthService {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<any>;
  getUserRole(): Promise<'admin' | 'client'>;
  getJwtToken(): Promise<string>;
  isAuthenticated(): Promise<boolean>;
  currentUser: Signal<any>;
}

export const AUTH_SERVICE = new InjectionToken<IAuthService>('AUTH_SERVICE');
