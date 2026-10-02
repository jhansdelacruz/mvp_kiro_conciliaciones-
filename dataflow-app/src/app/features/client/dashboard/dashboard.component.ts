import {
  AfterViewInit,
  Component,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProcessHistoryService } from '../../../core/services/process-history.service';
import { ProcessRecord, ProcessStatus } from '../../../shared/models/process.model';
import { AUTH_SERVICE } from '../../../core/auth/auth-service.interface';

type FilterValue = 'ALL' | 'COMPLETED' | 'PROCESSING';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatTableModule,
    MatPaginatorModule,
    MatChipsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, AfterViewInit {
  private processHistoryService = inject(ProcessHistoryService);
  private authService = inject(AUTH_SERVICE);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  isLoading = signal(true);
  filter = signal<FilterValue>('ALL');
  allProcesses = signal<ProcessRecord[]>([]);

  filteredProcesses = computed<ProcessRecord[]>(() => {
    const f = this.filter();
    const all = this.allProcesses();
    if (f === 'ALL') return all;
    return all.filter(p => p.status === f);
  });

  totalCount = computed(() => this.allProcesses().length);
  completedCount = computed(() => this.allProcesses().filter(p => p.status === 'COMPLETED').length);
  processingCount = computed(() =>
    this.allProcesses().filter(p => p.status === 'PROCESSING' || p.status === 'PENDING').length
  );
  errorCount = computed(() => this.allProcesses().filter(p => p.status === 'ERROR').length);

  dataSource = new MatTableDataSource<ProcessRecord>();
  displayedColumns = ['fileName', 'fileType', 'createdAt', 'status', 'result'];

  constructor() {
    effect(() => {
      this.dataSource.data = this.filteredProcesses();
    });
  }

  ngOnInit(): void {
    this.processHistoryService.getHistory('current-user-id').subscribe({
      next: (data) => {
        this.allProcesses.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }

  setFilter(value: FilterValue): void {
    this.filter.set(value);
  }

  openDownload(url: string): void {
    window.open(url, '_blank');
  }

  retryProcess(processId: string): void {
    this.processHistoryService.retryProcess(processId).subscribe();
  }

  getStatusClass(status: ProcessStatus): string {
    const map: Record<ProcessStatus, string> = {
      COMPLETED: 'badge badge-success',
      PROCESSING: 'badge badge-warning',
      PENDING: 'badge badge-info',
      ERROR: 'badge badge-error'
    };
    return map[status] ?? 'badge';
  }

  getStatusLabel(status: ProcessStatus): string {
    const map: Record<ProcessStatus, string> = {
      COMPLETED: 'Completado',
      PROCESSING: 'En proceso',
      PENDING: 'Pendiente',
      ERROR: 'Error'
    };
    return map[status] ?? status;
  }

  getFileTypeClass(type: string): string {
    return `badge ft-${type.toLowerCase()}`;
  }
}
