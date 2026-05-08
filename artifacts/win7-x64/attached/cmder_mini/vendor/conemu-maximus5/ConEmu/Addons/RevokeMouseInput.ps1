# Issue 1886: Change text cursor position with LeftClick was not working
# when PSReadLine was loaded in your $profile.
# Following will remove ENABLE_MOUSE_INPUT from console input mode flags
# Just call this script at the end of your $profile.

# (C) 2015 ConEmu.Maximus5@gmail.com

Add-Type -PassThru '
using System;
using System.Runtime.InteropServices;
public class ConsoleWinApi {

  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int nStdHandle);

  [DllImport("kernel32.dll")]
  static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint dwMode);

  [DllImport("kernel32.dll")]
  static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

  public static void RevokeMouseInput() 
  {
    uint dwMode = 0;
    IntPtr h = GetStdHandle(-10);
    if (GetConsoleMode(h, out dwMode) && ((dwMode & 0x10) != 0))
    {
      SetConsoleMode(h, dwMode ^ 0x10);
    }
  }

}
' | Out-Null

[ConsoleWinApi]::RevokeMouseInput()
