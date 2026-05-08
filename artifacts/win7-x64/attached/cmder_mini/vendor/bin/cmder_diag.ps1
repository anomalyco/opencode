if (test-path  $env:temp\cmder_diag_ps.log) {
  remove-item $env:temp\cmder_diag_ps.log
}

$cmder_diag = {
""
"------------------------------------"
"get-childitem env:"
"------------------------------------"
get-childitem env: | ft -autosize -wrap 2>&1

""
"------------------------------------"
"get-command git -all -ErrorAction SilentlyContinue"
"------------------------------------"
get-command git -all -ErrorAction SilentlyContinue

""
"------------------------------------"
"get-command clink -all -ErrorAction SilentlyContinue"
"------------------------------------"
get-command clink -all -ErrorAction SilentlyContinue

""
"------------------------------------"
"systeminfo"
"------------------------------------"
systeminfo 2>&1

"------------------------------------"
"get-childitem '$env:CMDER_ROOT'"
"------------------------------------"
get-childitem "$env:CMDER_ROOT" |ft LastWriteTime,mode,length,FullName

""
"------------------------------------"
"get-childitem '$env:CMDER_ROOT/vendor'"
"------------------------------------"
get-childitem "$env:CMDER_ROOT/vendor" |ft LastWriteTime,mode,length,FullName

""
"------------------------------------"
"get-childitem -s '$env:CMDER_ROOT/bin'"
"------------------------------------"
get-childitem -s "$env:CMDER_ROOT/bin" |ft LastWriteTime,mode,length,FullName

""
"------------------------------------"
"get-childitem -s '$env:CMDER_ROOT/config'"
"------------------------------------"
get-childitem -s "$env:CMDER_ROOT/config" |ft LastWriteTime,mode,length,FullName

""
"------------------------------------"
"Make sure you sanitize this output of private data prior to posting it online for review by the CMDER Team!"
"------------------------------------"
}

& $cmder_diag | out-file -filePath $env:temp\cmder_diag_ps.log

get-content "$env:temp\cmder_diag_ps.log"

write-host ""
write-host Above output was saved in "$env:temp\cmder_diag_ps.log"
