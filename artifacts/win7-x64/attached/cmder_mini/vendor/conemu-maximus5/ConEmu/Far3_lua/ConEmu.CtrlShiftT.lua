
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Switch visibility of tab/toolbar panel.
-- Look at 'Enable Tabs' checkbox in ConEmu Settings -> Tabs

local ConEmu   = "4b675d80-1d4a-4ea9-8436-fdc23f2fc14b"

Macro
{
  area="";
  key="CtrlShiftT";
  flags="";
  description="ConEmu: Switch tabs visibility";
action = function()
  Plugin.Call(ConEmu,3)
end;
}
