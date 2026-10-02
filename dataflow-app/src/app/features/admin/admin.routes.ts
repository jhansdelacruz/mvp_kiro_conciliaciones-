import { Routes } from '@angular/router';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientFormComponent } from './client-form/client-form.component';
import { ProviderListComponent } from './provider-onboarding/provider-list.component';
import { ProviderWizardComponent } from './provider-onboarding/provider-wizard.component';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'clients',
    pathMatch: 'full'
  },
  {
    path: 'clients',
    component: ClientListComponent
  },
  {
    path: 'clients/new',
    component: ClientFormComponent
  },
  {
    path: 'clients/:id',
    component: ClientFormComponent
  },
  {
    path: 'providers',
    component: ProviderListComponent
  },
  {
    path: 'providers/new',
    component: ProviderWizardComponent
  },
  {
    path: 'providers/:id',
    component: ProviderWizardComponent
  }
];
