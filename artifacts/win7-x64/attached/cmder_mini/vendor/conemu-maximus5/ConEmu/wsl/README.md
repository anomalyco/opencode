# wslbridge

wslbridge is a Cygwin program that allows connecting to the WSL command-line
environment over TCP sockets, as with ssh, but without the overhead of
configuring an SSH server.

## Usage

Usage is similar to that of `ssh`.  Run `wslbridge` with no arguments to start
a bash session in a WSL pty.  Append a command-line to run that command in WSL
without a pty (i.e. using 3 pipes for stdio).

`wslbridge` runs its WSL command with either a pty or using pipes.  Pass `-t`
to enable pty mode or `-T` to enable pipe mode.  Pass `-t -t` to force pty mode
even if stdin is not a terminal.

Pass `-eVAR=VAL` to set an environment variable within WSL.  Pass just `-eVAR`
to copy the value from the Cygwin environment.

## Copyright

wslbridge is distributed under the MIT license:
<https://github.com/rprichard/wslbridge/blob/master/LICENSE.txt>

cygwin library is distributed under the LGPL license:
<https://github.com/Maximus5/Cygwin-origin/blob/master/winsup/COPYING.LIB>
<https://github.com/Maximus5/Cygwin-origin/blob/master/winsup/CYGWIN_LICENSE>
