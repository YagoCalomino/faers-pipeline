# FAERS Pipeline

Pipeline de farmacovigilância que ingere os arquivos trimestrais de eventos adversos do FDA
(FAERS/AEMS), modela os dados em DuckDB com dbt e calcula sinais de desproporcionalidade
(PRR/ROR), orquestrado com Apache Airflow.

> **Em construção.** Plano completo em [`docs/PLANO_FAERS_PIPELINE.md`](docs/PLANO_FAERS_PIPELINE.md).

## Rodando localmente

Requisitos: Docker (Docker Desktop no Windows/macOS, com pelo menos 4 GB de memória; 8 GB
recomendados) e GNU Make 4.2 ou mais recente (no Windows: `winget install ezwinports.make`).
Lint e testes rodam dentro da imagem do Airflow, então não é preciso Python no host.

```bash
make env   # cria .env a partir de .env.example (só na primeira vez)
make up    # constrói a imagem e sobe o Airflow
```

### Acessando a UI

- Endereço: <http://localhost:8080>
- Usuário e senha: os valores de `_AIRFLOW_WWW_USER_USERNAME` e `_AIRFLOW_WWW_USER_PASSWORD`
  no seu `.env` (padrão do template: `airflow` / `airflow`). O usuário admin é criado pelo
  serviço `airflow-init` na primeira subida.
- Se mudar a senha no `.env` depois que o usuário já existe, ela não é atualizada
  automaticamente. Use
  `docker compose exec airflow-apiserver airflow users reset-password -u airflow -p <nova>`.

As DAGs ficam pausadas ao serem criadas, então nada é baixado até você despausar
`faers_ingest` na UI.

Outros comandos: `make ps`, `make logs`, `make lint`, `make test`, `make down`.
