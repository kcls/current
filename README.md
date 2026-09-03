# Current

`Current` is an incident tracker for community libraries, built atop the
[Odo](https://github.com/kcls/odo) platform.

## Quick Install Guide for Developers

Requires a running [Odo platform](https://github.com/kcls/odo). Current
deploys into the same dev cluster.

### Create The Database

The simplest approach for development is to create a new database within
the existing PostgreSQL instance used by Odo. Log in to the database 
host and do something along the lines of:

```bash
sudo -u postgres psql
CREATE USER current WITH PASSWORD 'demo123';
CREATE DATABASE current OWNER current;
```

### Setup Current

```bash
git clone https://github.com/kcls/current
cd current

# Add the K8s secrets
kubectl apply -f ./k8s/services/current/secrets.yaml

# Point Current at its database URL.
# The database must reachable from the cluster and the host (for tooling).
# A LAN IP or DNS name.  Not `localhost`.
./scripts/manage-secrets.sh update-db-url

# Deploy Current SQL schema
./scripts/manage-database.sh deploy

# Build and deploy services to the cluster
./scripts/build-and-deploy-service.sh --all
```

### Bulk-Load Odo Data

Developer setup assumes a Git checkout of [https://github.com/kcls/odo](Odo)
is available on the same machine for bulk data loads (users, roles, permission,
etc).  Set the `$ODO_HOME` variable to point to the root of the Odo checkout.

```bash
# For example, if Odo is checked out in the parent directory:
ODO_HOME="$(cd .. && pwd)/odo" 

# Load the data 
$ODO_HOME/scripts/load-data-manifest.sh ./src/odo-registration/manifest.json
```
### Setup Tests

These steps create test accounts with well-known passwords and are meant
for dev/demo servers only.


```bash
# Bulk load test data housed in Odo
$ODO_HOME/scripts/load-data-manifest.sh src/test-data/fixtures.json

# Load Current's local test data
./scripts/deploy-test-data.sh

# Optional: Install e2e dependencies
cd src/e2e
npm install
npx playwright install-deps
cd ../..

# Optional: Run tests
./scripts/run-tests.sh --all
```

### Access Incident Tracker UI

Navigate to http://DEV-HOST:30080/incident-tracker and log in with 
e2e.current.staff / test123!

