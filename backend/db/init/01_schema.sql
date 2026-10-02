CREATE TABLE IF NOT EXISTS clients (
  client_id          text PRIMARY KEY,
  cognito_username   text NOT NULL,
  name               text NOT NULL,
  company            text NOT NULL,
  email              text NOT NULL,
  status             text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  delivery_method    text NOT NULL CHECK (delivery_method IN ('EMAIL','DASHBOARD')),
  notification_email text,
  s3_prefix          text NOT NULL,
  url_expiration     integer NOT NULL DEFAULT 3600,
  total_processes    integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

CREATE TABLE IF NOT EXISTS process_history (
  process_id     text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES clients(client_id),
  file_name      text NOT NULL,
  file_type      text NOT NULL CHECK (file_type IN ('CSV','JSON','XLSX')),
  file_size      bigint NOT NULL,
  status         text NOT NULL CHECK (status IN ('PENDING','PROCESSING','COMPLETED','ERROR')),
  input_s3_key   text,
  output_s3_key  text,
  download_url   text,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_process_history_client ON process_history(client_id);
