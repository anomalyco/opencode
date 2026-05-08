
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Show output of last console command
-- Checkbox 'Long console output' must be checked in
-- ConEmu Settings -> Features

-- OpenType=1 - Open in editor, OpenType=2 - Open in viewer
local OpenType = 1

local ConEmu   = "4b675d80-1d4a-4ea9-8436-fdc23f2fc14b"

Macro
{
  area="Shell";
  key="CtrlO";
  flags="NoSendKeysToPlugins";
  description="ConEmu: Show console output in editor";
action = function()
  Plugin.Call(ConEmu,OpenType) Keys("CtrlEnd")
end;
}

--  Area="Editor.'CEM*.tmp'"
--  Area="Viewer.'CEM*.tmp'"

Macro
{
  area="Editor Viewer";
  key="CtrlO";
  flags="NoSendKeysToPlugins";
  description="ConEmu: Return to panels from console output";
condition = function(Key)
  -- Only our temp files: "CEM*.tmp"
  if Area.Editor then f=Editor.FileName; else f=Viewer.FileName; end
  return (mf.lcase(mf.fsplit(f,8))==".tmp"  and  mf.ucase(mf.substr(mf.fsplit(f,4),0,3))=="CEM")
end;
action = function()
  -- Close
  Keys("F10")
  -- Skip save confirmation
  if Area.Dialog and Dlg.Id=="F776FEC0-50F7-4E7E-BDA6-2A63F84A957B" then
    Keys("Right Enter")
  end
end;
}

Macro
{
  area="Shell";
  key="CtrlAltO";
  flags="NoSendKeysToPlugins";
  description="Hide/Show panels (standard FAR CtrlO)";
action = function()
  Keys("CtrlO")
end;
}
