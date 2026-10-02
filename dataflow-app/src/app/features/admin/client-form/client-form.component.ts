import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators
} from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { ClientService } from '../../../core/services/client.service';
import { ClientFormData, DeliveryMethod } from '../../../shared/models/client.model';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatRadioModule
  ],
  templateUrl: './client-form.component.html',
  styleUrls: ['./client-form.component.scss']
})
export class ClientFormComponent implements OnInit {
  private clientService = inject(ClientService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  clientId = signal<string | null>(null);
  clientName = signal<string>('');
  selectedDeliveryMethod = signal<DeliveryMethod>('DASHBOARD');

  isEditMode = computed(() => this.clientId() !== null);
  title = computed(() =>
    this.isEditMode()
      ? `Editar Cliente: ${this.clientName()}`
      : 'Nuevo Cliente'
  );

  form!: FormGroup;

  ngOnInit(): void {
    this.form = this.fb.group({
      name: ['', Validators.required],
      company: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      status: ['ACTIVE'],
      deliveryMethod: ['DASHBOARD'],
      notificationEmail: [''],
      s3Prefix: [''],
      urlExpiration: [86400]
    });

    // Watch deliveryMethod changes to sync signal
    this.form
      .get('deliveryMethod')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((method: DeliveryMethod) => {
        this.selectedDeliveryMethod.set(method);
      });

    // Watch company changes to auto-generate s3Prefix slug (new mode only)
    this.form
      .get('company')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((company: string) => {
        if (!this.isEditMode() && company) {
          const slug = company
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          this.form
            .get('s3Prefix')!
            .setValue(`clients/${slug}/`, { emitEvent: false });
        }
      });

    // Read route params to determine edit vs create mode
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id: string | undefined = params['id'];
        if (id) {
          this.clientId.set(id);
          this.clientService.getClient(id).subscribe((client) => {
            this.clientName.set(client.name);
            this.form.patchValue(
              {
                name: client.name,
                company: client.company,
                email: client.email,
                status: client.status,
                deliveryMethod: client.deliveryMethod,
                notificationEmail: client.notificationEmail ?? '',
                s3Prefix: client.s3Prefix,
                urlExpiration: client.urlExpiration
              },
              { emitEvent: false }
            );
            this.selectedDeliveryMethod.set(client.deliveryMethod);
          });
        }
      });
  }

  setDeliveryMethod(method: DeliveryMethod): void {
    this.form.get('deliveryMethod')!.setValue(method);
  }

  save(): void {
    if (this.form.invalid) return;
    const data: ClientFormData = this.form.value as ClientFormData;
    const id = this.clientId();
    const action$ = id
      ? this.clientService.updateClient(id, data)
      : this.clientService.createClient(data);
    action$.subscribe(() => {
      this.router.navigate(['/admin/clients']);
    });
  }

  cancel(): void {
    this.router.navigate(['/admin/clients']);
  }
}
