# Current

`Current` is an incident tracker for community libraries, built atop the
[Odo](https://github.com/kcls/odo) platform.

## Development

Requires a running Odo platform (see the Odo repo's setup docs); Current
deploys into the same dev cluster.

```bash
# Setup containerized developer database (pass the odo DB account —
# the container's bootstrap superuser)
ADMIN_PGUSER=odo ADMIN_PGPASSWORD=demo123 ./scripts/manage-database.sh setup-dev-database

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

