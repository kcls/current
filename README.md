# Current

`Current` is an incident tracker for community libraries, built atop the
[Odo](https://github.com/kcls/odo) platform.

## Setup

Requires a running Odo platform (see the Odo repo's setup docs); Current
deploys into the same dev cluster.

### Create The Database

The simplest approach for development is to create a new database within
the existing PostgreSQL instance used by Odo. Current does not own that
server, so no script here creates the role or the database — log in to
the database host and do something along the lines of:

```bash
sudo -u postgres psql
CREATE USER current WITH PASSWORD 'demo123';
CREATE DATABASE current OWNER current;
```

### Add the Database URL Secret

```bash
kubectl apply -f ./k8s/services/current/secrets.yaml
```

### Point Current At It

Current reads a single `DATABASE_URL` from the `current-api` secret. Both
the service pod and the host tooling (`manage-database.sh`,
`run-tests.sh`, `run-db-tests.sh`) use it, so its host has to be reachable
from inside the cluster *and* from this host — a LAN address or a DNS
name. `localhost` will not do: inside a pod it points at the pod.

```bash
./scripts/manage-secrets.sh update-db-url
```

### Create Schema, Data, and Deploy

```bash
# Deploy Current SQL schema
./scripts/manage-database.sh deploy

# Create Odo data (roles, permissions, etc.)
./scripts/odo-register.sh src/odo-registration/manifest.json

# Build and deploy services to the cluster
./scripts/build-and-deploy-service.sh --all
```

### Install Test Data

This will create accounts and sample data for testing.

```bash
./scripts/deploy-test-data.sh 
```

### Access Incident Tracker UI

Navigate to http://DEV-HOST:30080/incident-tracker and log in with 
e2e.current.staff / test123!

## Further Testing (Optional)

Install e2e dependencies and run test suites

```bash
cd src/e2e
npm install
npx playwright install-deps
cd ../..
./scripts/run-tests.sh --db --integration --e2e --unit
```

