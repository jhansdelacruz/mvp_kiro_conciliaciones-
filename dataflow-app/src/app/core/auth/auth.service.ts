import { Injectable, signal, Signal } from '@angular/core';
import { IAuthService } from './auth-service.interface';
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchAuthSession
} from 'aws-amplify/auth';

@Injectable()
export class AuthService implements IAuthService {
  private _currentUser = signal<any>(null);

  get currentUser(): Signal<any> {
    return this._currentUser;
  }

  async signIn(email: string, password: string): Promise<void> {
    await amplifySignIn({ username: email, password });
    const user = await getCurrentUser();
    this._currentUser.set(user);
  }

  async signOut(): Promise<void> {
    await amplifySignOut();
    this._currentUser.set(null);
  }

  async getCurrentUser(): Promise<any> {
    return getCurrentUser();
  }

  async getUserRole(): Promise<'admin' | 'client'> {
    const session = await fetchAuthSession();
    const groups =
      (session.tokens?.idToken?.payload['cognito:groups'] as string[]) ?? [];
    return groups.includes('admin') ? 'admin' : 'client';
  }

  async getJwtToken(): Promise<string> {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      await getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }
}
