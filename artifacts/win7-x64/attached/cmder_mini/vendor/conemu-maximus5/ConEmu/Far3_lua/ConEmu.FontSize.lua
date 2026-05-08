
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Note! This is just an example of calling GuiMacro from Far Manager
-- Note! Ctrl+Wheel may be already binded in ConEmu Keys&Macro settings

-- Increase/decrease font size in ConEmu window with Ctrl+Wheel

local ConEmu   = "4b675d80-1d4a-4ea9-8436-fdc23f2fc14b"

Macro
{
  area="Common";
  key="AltMsWheelUp";
  flags="";
  description="ConEmu: Increase ConEmu font size";
action = function()
  Plugin.Call(ConEmu,"FontSetSize(1,2)")
end;
}

Macro
{
  area="Common";
  key="AltMsWheelDown";
  flags="";
  description="ConEmu: Decrease ConEmu font size";
action = function()
  Plugin.Call(ConEmu,"FontSetSize(1,-2)")
end;
}
