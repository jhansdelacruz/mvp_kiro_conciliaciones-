import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ProcessRecord } from '../../shared/models/process.model';
import { environment } from '../../../environments/environment';

const MOCK_PROCESSES: ProcessRecord[] = [
  {
    processId: 'proc-001',
    clientId: 'client-001',
    fileName: 'ventas_enero_2024.csv',
    fileType: 'CSV',
    fileSize: 245760,
    status: 'COMPLETED',
    downloadUrl:
      'https://s3.amazonaws.com/bucket/ventas_enero_2024_processed.csv?X-Amz-Signature=mock',
    createdAt: '2024-01-15T09:30:00Z',
    completedAt: '2024-01-15T09:35:22Z'
  },
  {
    processId: 'proc-002',
    clientId: 'client-001',
    fileName: 'clientes_q1_2024.json',
    fileType: 'JSON',
    fileSize: 98304,
    status: 'COMPLETED',
    downloadUrl:
      'https://s3.amazonaws.com/bucket/clientes_q1_2024_processed.json?X-Amz-Signature=mock',
    createdAt: '2024-02-03T14:20:00Z',
    completedAt: '2024-02-03T14:23:45Z'
  },
  {
    processId: 'proc-003',
    clientId: 'client-001',
    fileName: 'facturas_2024.xlsx',
    fileType: 'XLSX',
    fileSize: 512000,
    status: 'ERROR',
    errorMessage:
      'El archivo contiene columnas no reconocidas en la fila 45. Por favor revise el formato.',
    createdAt: '2024-02-20T11:10:00Z',
    completedAt: '2024-02-20T11:11:30Z'
  },
  {
    processId: 'proc-004',
    clientId: 'client-001',
    fileName: 'inventario_marzo.csv',
    fileType: 'CSV',
    fileSize: 327680,
    status: 'PROCESSING',
    createdAt: '2024-03-10T08:45:00Z'
  },
  {
    processId: 'proc-005',
    clientId: 'client-001',
    fileName: 'reporte_trimestral.xlsx',
    fileType: 'XLSX',
    fileSize: 1048576,
    status: 'PENDING',
    createdAt: '2024-03-12T16:00:00Z'
  },
  {
    processId: 'proc-006',
    clientId: 'client-001',
    fileName: 'pedidos_febrero.json',
    fileType: 'JSON',
    fileSize: 163840,
    status: 'COMPLETED',
    downloadUrl:
      'https://s3.amazonaws.com/bucket/pedidos_febrero_processed.json?X-Amz-Signature=mock',
    createdAt: '2024-02-28T10:00:00Z',
    completedAt: '2024-02-28T10:04:10Z'
  }
];

@Injectable()
export class ProcessHistoryService {
  private apiService = inject(ApiService);

  getHistory(clientId: string): Observable<ProcessRecord[]> {
    if (environment.useMock) {
      return this.apiService.mockResponse(MOCK_PROCESSES);
    }
    return this.apiService.get<ProcessRecord[]>(`/processes?clientId=${clientId}`);
  }

  retryProcess(processId: string): Observable<void> {
    if (environment.useMock) {
      return this.apiService.mockResponse(undefined as unknown as void);
    }
    return this.apiService.post<void>(`/processes/${processId}/retry`, {});
  }
}
