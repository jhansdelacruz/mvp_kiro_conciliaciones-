INSERT INTO clients (client_id, cognito_username, name, company, email, status, delivery_method, notification_email, s3_prefix, url_expiration, total_processes, created_at, updated_at) VALUES
('client-001','juan.garcia@acme.com','Juan García','ACME Distribuciones S.A.','juan.garcia@acme.com','ACTIVE','DASHBOARD',NULL,'clients/acme/',3600,15,'2024-01-05T08:00:00Z','2024-03-01T10:30:00Z'),
('client-002','maria.lopez@tecnova.mx','María López','Tecnova México','maria.lopez@tecnova.mx','ACTIVE','EMAIL','maria.lopez@tecnova.mx','clients/tecnova/',7200,8,'2024-01-20T09:15:00Z','2024-02-28T14:00:00Z'),
('client-003','carlos.mendez@globalcorp.com','Carlos Méndez','GlobalCorp Latinoamérica','carlos.mendez@globalcorp.com','INACTIVE','EMAIL','carlos.mendez@globalcorp.com','clients/globalcorp/',3600,3,'2024-02-10T11:00:00Z','2024-03-05T09:45:00Z'),
('client-004','ana.torres@solucionespy.com','Ana Torres','Soluciones Paraguay','ana.torres@solucionespy.com','ACTIVE','DASHBOARD',NULL,'clients/solucionespy/',14400,22,'2024-01-12T07:30:00Z','2024-03-10T16:20:00Z'),
('client-005','roberto.vargas@inversiones.co','Roberto Vargas','Inversiones Andinas','roberto.vargas@inversiones.co','ACTIVE','DASHBOARD',NULL,'clients/inversiones/',7200,5,'2024-03-01T12:00:00Z',NULL)
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO process_history (process_id, client_id, file_name, file_type, file_size, status, input_s3_key, output_s3_key, download_url, error_message, created_at, completed_at) VALUES
('proc-001','client-001','ventas_enero_2024.csv','CSV',245760,'COMPLETED','clients/acme/proc-001/ventas_enero_2024.csv','clients/acme/proc-001/ventas_enero_2024_processed.csv','https://s3.amazonaws.com/bucket/ventas_enero_2024_processed.csv?X-Amz-Signature=mock',NULL,'2024-01-15T09:30:00Z','2024-01-15T09:35:22Z'),
('proc-002','client-001','clientes_q1_2024.json','JSON',98304,'COMPLETED','clients/acme/proc-002/clientes_q1_2024.json','clients/acme/proc-002/clientes_q1_2024_processed.json','https://s3.amazonaws.com/bucket/clientes_q1_2024_processed.json?X-Amz-Signature=mock',NULL,'2024-02-03T14:20:00Z','2024-02-03T14:23:45Z'),
('proc-003','client-001','facturas_2024.xlsx','XLSX',512000,'ERROR','clients/acme/proc-003/facturas_2024.xlsx',NULL,NULL,'El archivo contiene columnas no reconocidas en la fila 45. Por favor revise el formato.','2024-02-20T11:10:00Z','2024-02-20T11:11:30Z'),
('proc-004','client-001','inventario_marzo.csv','CSV',327680,'PROCESSING','clients/acme/proc-004/inventario_marzo.csv',NULL,NULL,NULL,'2024-03-10T08:45:00Z',NULL),
('proc-005','client-001','reporte_trimestral.xlsx','XLSX',1048576,'PENDING',NULL,NULL,NULL,NULL,'2024-03-12T16:00:00Z',NULL),
('proc-006','client-001','pedidos_febrero.json','JSON',163840,'COMPLETED','clients/acme/proc-006/pedidos_febrero.json','clients/acme/proc-006/pedidos_febrero_processed.json','https://s3.amazonaws.com/bucket/pedidos_febrero_processed.json?X-Amz-Signature=mock',NULL,'2024-02-28T10:00:00Z','2024-02-28T10:04:10Z'),
('proc-007','client-004','padron_clientes.csv','CSV',204800,'COMPLETED','clients/solucionespy/proc-007/padron_clientes.csv','clients/solucionespy/proc-007/padron_clientes_processed.csv','https://s3.amazonaws.com/bucket/padron_clientes_processed.csv?X-Amz-Signature=mock',NULL,'2024-03-08T13:00:00Z','2024-03-08T13:05:12Z'),
('proc-008','client-004','exportaciones_q1.xlsx','XLSX',655360,'PROCESSING','clients/solucionespy/proc-008/exportaciones_q1.xlsx',NULL,NULL,NULL,'2024-03-11T09:20:00Z',NULL)
ON CONFLICT (process_id) DO NOTHING;
