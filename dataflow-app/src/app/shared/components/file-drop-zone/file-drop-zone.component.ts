import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-file-drop-zone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-drop-zone.component.html',
  styleUrls: ['./file-drop-zone.component.scss']
})
export class FileDropZoneComponent {
  @Input() acceptedTypes: string[] = ['.csv', '.json', '.xlsx'];
  @Input() maxSizeMB: number = 50;
  @Output() filesSelected = new EventEmitter<File[]>();

  isDragOver = signal(false);
  rejectedFiles = signal<string[]>([]);

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  @HostListener('dragleave')
  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files) {
      this.processFiles(Array.from(files));
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.processFiles(Array.from(input.files));
      // Reset so the same file can be selected again
      input.value = '';
    }
  }

  private processFiles(files: File[]): void {
    const validFiles: File[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const result = this.validateFile(file);
      if (result.valid) {
        validFiles.push(file);
      } else {
        rejected.push(`${file.name}: ${result.reason}`);
      }
    }

    this.rejectedFiles.set(rejected);
    if (validFiles.length > 0) {
      this.filesSelected.emit(validFiles);
    }
  }

  validateFile(file: File): { valid: boolean; reason?: string } {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!this.acceptedTypes.includes(ext)) {
      return {
        valid: false,
        reason: `Tipo de archivo no permitido (${ext})`
      };
    }
    const maxBytes = this.maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      return {
        valid: false,
        reason: `El archivo supera el tamaño máximo de ${this.maxSizeMB}MB`
      };
    }
    return { valid: true };
  }

  getAcceptString(): string {
    return this.acceptedTypes.join(',');
  }

  getTypeClass(ext: string): string {
    return `ft-${ext.replace('.', '')}`;
  }
}
