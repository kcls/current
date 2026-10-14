# Database PGTap Unit Tests

## Basics

* Tests are developed using <https://pgtap.org/> and exectuted via pg\_prove.
* Every test creates the data it needs and completes with a ROLLBACK, leaving
  the database is it was found.

## Testing

Run with odo's shared script, from anywhere in this checkout. Connection
details resolve from the secret named in `service-map.yaml` (`database:`,
the cluster's `current-api` secret); PG\* environment variables act as
overrides.

```
$ODO_HOME/scripts/run-db-tests.sh

# OR

VERBOSE=1 $ODO_HOME/scripts/run-db-tests.sh
```

