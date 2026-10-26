# Run from the repo root. Lint and tests run inside the Airflow image,
# so the host only needs Docker and make.
COMPOSE := docker compose --env-file .env -f infra/docker/docker-compose.yml
DEV     := $(COMPOSE) run --rm --no-deps airflow-dev

.PHONY: help env build up down logs ps lint format test fernet import-errors \
	dbt-deps dbt-build dbt-rebuild dbt-test dbt-docs dbt-parse-v2 test-lake dbt-ci reconcile

help:
	@echo "Targets: env build up down logs ps lint format test fernet import-errors"
	@echo "dbt:     dbt-deps dbt-build dbt-rebuild dbt-test dbt-docs dbt-parse-v2 test-lake dbt-ci reconcile"

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

# --- dbt (runs in /opt/dbt-venv inside airflow-dev; settings from config/*.yaml) ---------
DBT := $(DEV) python -I scripts/dbt_run.py
# Throwaway folder inside the one-off container: test lake + ci database, never committed.
CI_DIR := /tmp/faers_ci

dbt-deps: .env
	$(DBT) deps

dbt-build: .env
	$(DBT) build

# Deletes the warehouse .duckdb (dbt outputs only; the lake is the source) and builds everything.
# Never run while an ingestion is writing the lake.
dbt-rebuild: .env
	$(DBT) --rebuild build

dbt-test: .env
	$(DBT) test

# Raw lake -> warehouse counts recomputed independently; exit 1 on any divergence.
reconcile: .env
	$(DEV) python -I scripts/reconcile.py

dbt-docs: .env
	$(DBT) docs generate

dbt-parse-v2: .env
	$(DBT) parse --use-v2-parser

# Real parse of tests/fixtures/faers_sample into a temporary lake (smoke check, then discarded).
test-lake: .env
	$(DEV) python -I scripts/build_test_lake.py --out $(CI_DIR)/lake

# dbt build (target ci) on the test lake: no dependency on data/.
dbt-ci: .env
	$(DEV) bash -c "python -I scripts/build_test_lake.py --out $(CI_DIR)/lake \
		&& export LAKE_PATH=$(CI_DIR)/lake DBT_CI_DIR=$(CI_DIR) \
		&& python -I scripts/dbt_run.py --ci deps \
		&& python -I scripts/dbt_run.py --ci build"
