export type ProcessStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR';

export type FileType = 'CSV' | 'JSON' | 'XLSX';

export interface ProcessRecord {
  processId: string;
  clientId: string;
  fileName: string;
  fileType: FileType;
  fileSize: number;
  status: ProcessStatus;
  downloadUrl?: string;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}
