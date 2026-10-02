.PHONY: up provision start down logs seed test

# Levanta los contenedores (floci + postgres) en segundo plano.
up:
	docker compose up -d

# Aprovisiona Cognito, S3, Lambdas y API Gateway sobre el stack ya levantado.
provision:
	node provision.mjs

# Flujo de un comando: levantar + aprovisionar (provision.mjs espera la salud internamente).
start:
	docker compose up -d
	node provision.mjs

# Derriba el stack y borra volúmenes y red (los seeds vuelven a cargarse en el próximo start).
down:
	docker compose down -v

# Sigue los logs de los contenedores.
logs:
	docker compose logs -f

# Re-ejecuta el seed sobre el Postgres en marcha (seguro por ON CONFLICT DO NOTHING).
seed:
	docker compose exec -T postgres psql -U dataflow -d dataflow -f /docker-entrypoint-initdb.d/02_seed.sql

# Tests unitarios de la librería común (sin Docker).
test:
	node --test "lambdas/common/**/*.test.mjs"
