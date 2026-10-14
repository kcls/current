# Current demo data

A separate sqitch project (`%project=current-demo`): sample sub-locations
and alert routing onto odo's demo email groups. It depends on
`current:002_current_seed`, so it deploys after the core project and
reverts before it. An installation with its own org structure skips it.

    ./scripts/manage-database.sh deploy-demo | revert-demo | status-demo

TODO (root_code): odo's schema project parameterizes the root org unit,
and this data is pinned to the *demo* org units' uuids (and odo's demo
email groups'). An installation that deployed a different root does not
want it at all -- which is why it lives in its own project -- but nothing
checks that the pinned units actually exist. Decide whether deploying it
should verify the target root, or whether the dependency on
`current:002_current_seed` is guarantee enough.
