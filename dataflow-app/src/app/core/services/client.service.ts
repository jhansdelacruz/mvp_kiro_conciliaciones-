import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Client, ClientFormData } from '../../shared/models/client.model';
import { environment } from '../../../environments/environment';

const MOCK_CLIENTS: Client[] = [
  {
    clientId: 'client-001',
    cognitoUsername: 'juan.garcia@acme.com',
    name: 'Juan García',
    company: 'ACME Distribuciones S.A.',
    email: 'juan.garcia@acme.com',
    status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD',
    s3Prefix: 'clients/acme/',
    urlExpiration: 3600,
    totalProcesses: 15,
    createdAt: '2024-01-05T08:00:00Z',
    updatedAt: '2024-03-01T10:30:00Z'
  },
  {
    clientId: 'client-002',
    cognitoUsername: 'maria.lopez@tecnova.mx',
    name: 'María López',
    company: 'Tecnova México',
    email: 'maria.lopez@tecnova.mx',
    status: 'ACTIVE',
    deliveryMethod: 'EMAIL',
    s3Prefix: 'clients/tecnova/',
    urlExpiration: 7200,
    totalProcesses: 8,
    createdAt: '2024-01-20T09:15:00Z',
    updatedAt: '2024-02-28T14:00:00Z'
  },
  {
    clientId: 'client-003',
    cognitoUsername: 'carlos.mendez@globalcorp.com',
    name: 'Carlos Méndez',
    company: 'GlobalCorp Latinoamérica',
    email: 'carlos.mendez@globalcorp.com',
    status: 'INACTIVE',
    deliveryMethod: 'EMAIL',
    s3Prefix: 'clients/globalcorp/',
    urlExpiration: 3600,
    totalProcesses: 3,
    createdAt: '2024-02-10T11:00:00Z',
    updatedAt: '2024-03-05T09:45:00Z'
  },
  {
    clientId: 'client-004',
    cognitoUsername: 'ana.torres@solucionespy.com',
    name: 'Ana Torres',
    company: 'Soluciones Paraguay',
    email: 'ana.torres@solucionespy.com',
    status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD',
    s3Prefix: 'clients/solucionespy/',
    urlExpiration: 14400,
    totalProcesses: 22,
    createdAt: '2024-01-12T07:30:00Z',
    updatedAt: '2024-03-10T16:20:00Z'
  },
  {
    clientId: 'client-005',
    cognitoUsername: 'roberto.vargas@inversiones.co',
    name: 'Roberto Vargas',
    company: 'Inversiones Andinas',
    email: 'roberto.vargas@inversiones.co',
    status: 'ACTIVE',
    deliveryMethod: 'DASHBOARD',
    s3Prefix: 'clients/inversiones/',
    urlExpiration: 7200,
    totalProcesses: 5,
    createdAt: '2024-03-01T12:00:00Z'
  }
];

@Injectable()
export class ClientService {
  private apiService = inject(ApiService);

  getClients(): Observable<Client[]> {
    if (environment.useMock) {
      return this.apiService.mockResponse(MOCK_CLIENTS);
    }
    return this.apiService.get<Client[]>('/clients');
  }

  getClient(id: string): Observable<Client> {
    if (environment.useMock) {
      const client = MOCK_CLIENTS.find((c) => c.clientId === id) ?? MOCK_CLIENTS[0];
      return this.apiService.mockResponse(client);
    }
    return this.apiService.get<Client>(`/clients/${id}`);
  }

  createClient(data: ClientFormData): Observable<Client> {
    if (environment.useMock) {
      const newClient: Client = {
        clientId: 'client-' + Date.now(),
        cognitoUsername: data.email,
        name: data.name,
        company: data.company,
        email: data.email,
        status: data.status,
        deliveryMethod: data.deliveryMethod,
        notificationEmail: data.notificationEmail,
        s3Prefix: data.s3Prefix,
        urlExpiration: data.urlExpiration,
        totalProcesses: 0,
        createdAt: new Date().toISOString()
      };
      MOCK_CLIENTS.push(newClient);
      return this.apiService.mockResponse(newClient);
    }
    return this.apiService.post<Client>('/clients', data);
  }

  updateClient(id: string, data: ClientFormData): Observable<Client> {
    if (environment.useMock) {
      const index = MOCK_CLIENTS.findIndex((c) => c.clientId === id);
      const existing = index >= 0 ? MOCK_CLIENTS[index] : MOCK_CLIENTS[0];
      const updated: Client = { ...existing, ...data, updatedAt: new Date().toISOString() };
      if (index >= 0) {
        MOCK_CLIENTS[index] = updated;
      }
      return this.apiService.mockResponse(updated);
    }
    return this.apiService.put<Client>(`/clients/${id}`, data);
  }

  deactivateClient(id: string): Observable<void> {
    if (environment.useMock) {
      const client = MOCK_CLIENTS.find((c) => c.clientId === id);
      if (client) {
        client.status = 'INACTIVE';
        client.updatedAt = new Date().toISOString();
      }
      return this.apiService.mockResponse(undefined as unknown as void);
    }
    return this.apiService.delete<void>(`/clients/${id}/deactivate`);
  }
}
