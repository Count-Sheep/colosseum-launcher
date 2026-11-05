#!/bin/sh
# Builds the game in the game folder ($1): the decomp's build file once (the port reads its link lists),
# then the port's build.sh with its dependencies named (a newer port doesn't read SMS_PORT). The compilers and
# tools come from the launcher's build tools, through the environment it starts this with.
set -e
root=$1
export COLO_PORT="$root" DECOMP="$root/deps/pkmn-colosseum" SMS_PORT="$root/deps/sms-pc-port"
if [ ! -f "$DECOMP/build.ninja" ]; then
    echo "Preparing the decomp's build"
    (cd "$DECOMP" && python3 configure.py > /dev/null)
fi
exec /bin/sh "$root/build.sh"
