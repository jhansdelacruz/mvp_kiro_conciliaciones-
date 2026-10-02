export type DeliveryMethod = 'EMAIL' | 'DASHBOARD';

export interface Client {
  clientId: string;
  cognitoUsername: string;
  name: string;
  company: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  deliveryMethod: DeliveryMethod;
  notificationEmail?: string;
  s3Prefix: string;
  urlExpiration: number;
  totalProcesses?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ClientFormData {
  name: string;
  company: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  deliveryMethod: DeliveryMethod;
  notificationEmail: string;
  s3Prefix: string;
  urlExpiration: number;
}
