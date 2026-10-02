import {
  Component,
  WritableSignal,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FileDropZoneComponent } from '../../../shared/components/file-drop-zone/file-drop-zone.component';

type UploadStatus = 'pending' | 'uploading' | 'queued' | 'error';

interface UploadItem {
  file: File;
  progress: WritableSignal<number>;
  status: WritableSignal<UploadStatus>;
}

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatProgressBarModule,
    MatIconModule,
    MatSnackBarModule,
    FileDropZoneComponent
  ],
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss']
})
export class FileUploadComponent {
  private snackBar = inject(MatSnackBar);

  pendingFiles = signal<UploadItem[]>([]);
  showSuccess = signal(false);

  isUploading = computed(() =>
    this.pendingFiles().some(f => f.status() === 'uploading')
  );

  // "Listo" en el flujo asíncrono = todos los archivos subidos y encolados
  // para procesamiento en segundo plano (no esperamos a que terminen de procesar).
  allDone = computed(() =>
    this.pendingFiles().length > 0 &&
    this.pendingFiles().every(f => f.status() === 'queued')
  );

  constructor() {
    effect(
      () => {
        if (this.allDone()) {
          this.showSuccess.set(true);
        }
      },
      { allowSignalWrites: true }
    );
  }

  onFilesSelected(files: File[]): void {
    const current = this.pendingFiles();
    const remaining = 5 - current.length;

    if (remaining <= 0) {
      this.snackBar.open('Máximo 5 archivos permitidos', 'Cerrar', {
        duration: 3000
      });
      return;
    }

    const toAdd = files.slice(0, remaining);
    const newItems: UploadItem[] = toAdd.map(file => ({
      file,
      progress: signal(0),
      status: signal<UploadStatus>('pending')
    }));

    this.pendingFiles.update(existing => [...existing, ...newItems]);

    if (files.length > remaining) {
      this.snackBar.open(
        `Solo se agregaron ${remaining} archivos (límite de 5)`,
        'Cerrar',
        { duration: 3000 }
      );
    }
  }

  removeFile(index: number): void {
    this.pendingFiles.update(files => files.filter((_, i) => i !== index));
  }

  // Simulación de carga ASÍNCRONA (solo frontend por ahora).
  // Fase 1: subida del archivo con progreso determinado (0 → 100%).
  // Fase 2: al completar la subida, el archivo queda ENCOLADO; el procesamiento
  //         se realiza en segundo plano y el usuario no espera a que termine.
  // Cuando la integración real exista, aquí se pedirá la presigned URL,
  // se subirá a S3 y se llamará a /files/trigger para encolar el procesamiento.
  startProcessing(): void {
    if (this.isUploading() || this.pendingFiles().length === 0) return;

    this.showSuccess.set(false);
    const files = this.pendingFiles();

    files.forEach(item => {
      if (item.status() !== 'pending') return;
      item.status.set('uploading');

      const interval = setInterval(() => {
        const current = item.progress();
        const next = Math.min(current + 5, 100);
        item.progress.set(next);
        if (next >= 100) {
          clearInterval(interval);
          // Subida completa → encolado para procesamiento asíncrono en segundo plano.
          item.status.set('queued');
        }
      }, 100);
    });
  }

  resetUpload(): void {
    this.pendingFiles.set([]);
    this.showSuccess.set(false);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getFileTypeClass(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return `ft-${ext}`;
  }

  getStatusIcon(status: string): string {
    const map: Record<string, string> = {
      pending: '⏳',
      uploading: '🔄',
      queued: '📨',
      error: '❌'
    };
    return map[status] ?? '';
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'En espera',
      uploading: 'Subiendo...',
      queued: 'En cola de procesamiento',
      error: 'Error'
    };
    return map[status] ?? '';
  }
}
