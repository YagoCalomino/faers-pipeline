# Run from the repo root. Lint and tests run inside the Airflow image,
# so the host only needs Docker and make.
COMPOSE := docker compose --env-file .env -f infra/docker/docker-compose.yml
DEV     := $(COMPOSE) run --rm --no-deps airflow-dev

.PHONY: help env build up down logs ps lint format test fernet import-errors

help:
	@echo "Targets: env build up down logs ps lint format test fernet import-errors"

# Create .env from the template the first time.
env: .env
# Uses make's own file functions (GNU Make >= 4.2) so it also works without a POSIX shell.
.env:
	$(file >$@,$(file <.env.example))
	@echo .env created from .env.example - review it before running make up

build: .env
	$(COMPOSE) build

up: .env
	$(COMPOSE) up -d --build --wait

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200

ps:
	$(COMPOSE) ps

lint: .env
	$(DEV) bash -c "ruff check . && ruff format --check ."

format: .env
	$(DEV) bash -c "ruff check --fix . && ruff format ."

test: .env
	$(DEV) pytest

# Prints a new Fernet key to paste into .env (FERNET_KEY=...).
fernet: .env
	$(DEV) python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

import-errors:
	$(COMPOSE) exec airflow-scheduler airflow dags list-import-errors
