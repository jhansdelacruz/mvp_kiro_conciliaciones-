import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable()
export class ApiService {
  private http = inject(HttpClient);

  get apiUrl(): string {
    return environment.apiUrl;
  }

  mockResponse<T>(data: T, delayMs = 400): Observable<T> {
    return of(data).pipe(delay(delayMs));
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.apiUrl}${path}`);
  }

  post<T>(path: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.apiUrl}${path}`, body);
  }

  put<T>(path: string, body: any): Observable<T> {
    return this.http.put<T>(`${this.apiUrl}${path}`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.apiUrl}${path}`);
  }
}
