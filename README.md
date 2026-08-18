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

# OPTIONAL: deploy test data and run tests
./scripts/deploy-test-data.sh 
./scripts/run-tests.sh --db --integration --e2e --unit
```

### Access Incident Tracker UI

Navigate to http://DEV-HOST:30080/incident-tracker and log in with 
e2e.current.staff / test123!
