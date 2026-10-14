#!/bin/bash
# Locate the odo checkout whose shared scripts these wrap. Sourced, not run.
#
# ODO_HOME from the environment wins. Otherwise use an odo checkout next to
# this one (<dir>/odo beside <dir>/current), the layout of the README's dev
# setup and of odo-deploy's site scripts, which derive ODO_HOME without
# exporting it. Exported so the scripts we hand off to see it too.
if [ -z "${ODO_HOME:-}" ]; then
    ODO_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/odo"
fi
if [ ! -f "$ODO_HOME/scripts/common.sh" ]; then
    echo "No odo checkout at $ODO_HOME; set ODO_HOME (see the README)." >&2
    exit 1
fi
export ODO_HOME
