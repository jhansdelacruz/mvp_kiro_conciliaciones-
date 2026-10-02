import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { FileUploadComponent } from './file-upload/file-upload.component';

export const CLIENT_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    component: DashboardComponent
  },
  {
    path: 'upload',
    component: FileUploadComponent
  }
];
