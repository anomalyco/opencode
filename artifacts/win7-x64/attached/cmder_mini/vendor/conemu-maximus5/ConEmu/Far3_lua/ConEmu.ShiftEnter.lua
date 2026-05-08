
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Run 'File under cursor' or 'Command line' in new console of ConEmu.
-- 'Press enter to close console' will be displayed after command completion.
-- Note! If you want to disable this confirmation,
--       set 'DisableCloseConfirm = true'

local DisableCloseConfirm = false

-- AltEnter   - run command and activate new ConEmu tab
-- Note! You must enable "Alt+Enter" option in ConEmu Settings->Keys.

-- ShiftEnter - run command in background ConEmu tab
-- Note! If you want to activate new tab on ShiftEnter,
--       set 'UseBackgroundTab = false'

local UseBackgroundTab = true


-- While starting command in background tab, there may be a flicker on panels.
-- If you want to disable flicker, set 'DisableFlicker = true'.
-- Note! ConEmu plugin reqired for 'DisableFlicker = true'.

local DisableFlicker = false



--  Descr="Run <File under cursor> or <Command line> in new console of ConEmu"
--  Key="ShiftEnter AltEnter"
--  Area="Shell Search ShellACompl"

Macro
{
  area="Shell Search ShellAutoCompletion";
  key="ShiftEnter AltEnter";
  flags="NoSendKeysToPlugins";
  description="ConEmu: Run <File under cursor> or <Command line> in new console of ConEmu";
action = function()

  -- history.enable(0xff)

  add = " -new_console"
  if akey(1,1)=="ShiftEnter" and UseBackgroundTab then
    add = add .. ":b";
    if DisableCloseConfirm then
      add = add .. ":n";
    end
  else
    -- AltEnter creates foreground console(tab)
    if DisableCloseConfirm then
      add = add .. ":n";
    end
    --add = add .. ":s40V"; -- split vertically for example
  end

  oldcmd = "";
  if Area.ShellAutoCompletion then
    Keys("Esc") -- close autocompletion
  else
    if Area.Search then
      -- Save and clear command line - about to execute panel(!) item
      oldcmd = CmdLine.Value; oldpos = CmdLine.CurPos;
      Keys("Esc Esc")  -- First - close search, second - clear command line
    end
  end

  if not CmdLine.Empty then
    -- already closed
    --if Area.Current=="Shell.AutoCompletion" then
    --  Keys("Esc") -- Close autocompletion
    --end

    if CmdLine.Value=="."  or  CmdLine.Value==".."  or  CmdLine.Value=="..." then
      Keys("ShiftEnter")
      exit()
    else
      --if Area.Current=="Shell.AutoCompletion" then
      --  Keys("Del") -- Remove autocompletion selection
      --end

      -- CtrlEnd - fails, because of AutoCompletion
      -- Just move the cursor to the end of command line
      for RCounter=CmdLine.ItemCount,1,-1 do Keys("CtrlD") end

      -- Append "-new_console" if not exists
      if mf.index(CmdLine.Value,"-new_console")<0 then
        print(add)
      end
    end
  elseif APanel.FilePanel and not APanel.Plugin and not APanel.Empty and not APanel.Folder and mf.len(APanel.Current)>4 then
    -- The command line was empty
    -- Get the list of "executable" extensions
    exec = mf.ucase(mf.env("PATHEXT"));
    if exec=="" then exec = ".COM;.EXE;.BAT;.CMD"; end
    -- And compare them to current panel item
    ext = mf.ucase(mf.fsplit(APanel.Current,8));
    if ext~="" and mf.index(";"..exec..";",";"..ext..";")>=0 then
      Keys("CtrlEnter")
      --Keys("Del") -- Remove possible autocompletion selection
      -- Append "-new_console"
      print(add)
    else
      if akey(1,1)=="ShiftEnter" then
        Keys("ShiftEnter")
      end
      exit()
    end
  else
    if akey(1,1)=="ShiftEnter" then
      Keys("ShiftEnter")
    end
    exit()
  end

  --Keys("Del") -- Remove possible autocompletion selection

  if DisableFlicker and Plugin.Call("4B675D80-1D4A-4EA9-8436-FDC23F2FC14B","IsConEmu") then
    for RCounter=CmdLine.ItemCount,1,-1 do Keys("CtrlS") end
    print("ConEmu:run:")
  end

  Keys("Enter") -- Execute

  -- Restore old command line state (running file from Panel in QSearch mode)
  if oldcmd ~= "" then
    print(oldcmd)
    if oldpos>=1 and oldpos<=CmdLine.ItemCount then
      Keys("CtrlHome")
      for RCounter=oldpos-1,1,-1 do Keys("CtrlD") end
    end
  end

end
}
