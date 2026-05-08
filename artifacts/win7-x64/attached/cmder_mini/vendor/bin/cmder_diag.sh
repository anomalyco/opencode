#!/usr/bin/env bash

[[ -f "$TEMP/cmder_diag_sh.log" ]] && rm -f  "$TEMP/cmder_diag_sh.log"

(echo ''
echo ------------------------------------
echo env
echo ------------------------------------
env 2>&1

echo ''
echo ------------------------------------
echo which git
echo ------------------------------------
which git 2>&1

echo ''
echo ------------------------------------
echo which clink
echo ------------------------------------
which clink 2>&1

echo ''
echo ------------------------------------
echo systeminfo
echo ------------------------------------
systeminfo 2>&1

echo ------------------------------------
echo ls -la "$CMDER_ROOT"
echo ------------------------------------
ls -la "$CMDER_ROOT" 2>&1

echo ''
echo ------------------------------------
echo ls -la "$CMDER_ROOT/vendor"
echo ------------------------------------
ls -la "$CMDER_ROOT/vendor" 2>&1

echo ''
echo ------------------------------------
echo ls -la /s "$CMDER_ROOT/bin"
echo ------------------------------------
ls -laR /s "$CMDER_ROOT/bin" 2>&1

echo ''
echo ------------------------------------
echo ls -la /s "$CMDER_ROOT/config"
echo ------------------------------------
ls -laR /s "$CMDER_ROOT/config" 2>&1

echo ''
echo ------------------------------------
echo Make sure you sanitize this output of private data prior to posting it online for review by the CMDER Team!
echo ------------------------------------
) > "$TEMP/cmder_diag_sh.log"

cat "$TEMP/cmder_diag_sh.log"

echo ''
echo Above output was saved in "$TEMP/cmder_diag_sh.log"
