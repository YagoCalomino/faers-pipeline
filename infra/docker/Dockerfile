# Extends the official Airflow image.
# Build context: repository root (see docker-compose.yml).
ARG AIRFLOW_VERSION=3.3.2
ARG PYTHON_VERSION=3.12
FROM apache/airflow:${AIRFLOW_VERSION}-python${PYTHON_VERSION}

ARG AIRFLOW_VERSION
ARG PYTHON_VERSION

# Airflow environment: pipeline dependencies, pinned against the official constraints.
COPY infra/docker/requirements.txt infra/docker/requirements-dev.txt /tmp/req/
RUN pip install --no-cache-dir \
      "apache-airflow==${AIRFLOW_VERSION}" \
      -r /tmp/req/requirements.txt \
      -r /tmp/req/requirements-dev.txt \
      --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"

# dbt in its own virtualenv to avoid dependency conflicts with Airflow.
USER root
RUN mkdir -p /opt/dbt-venv && chown airflow:0 /opt/dbt-venv
USER airflow
COPY infra/docker/requirements-dbt.txt /tmp/req/
RUN python -m venv /opt/dbt-venv \
    && /opt/dbt-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/dbt-venv/bin/pip install --no-cache-dir -r /tmp/req/requirements-dbt.txt
