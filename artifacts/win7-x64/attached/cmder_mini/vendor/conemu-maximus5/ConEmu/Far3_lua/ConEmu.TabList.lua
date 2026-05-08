
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Show all windows list from all consoles

local ConEmu   = "4b675d80-1d4a-4ea9-8436-fdc23f2fc14b"

Macro
{
  area="Shell QView Info Tree Search Dialog Editor Viewer";
  key="F12";
  flags="NoSendKeysToPlugins";
  description="ConEmu: Show all windows list from all consoles";
action = function()
  if Plugin.Menu(ConEmu) then
    Keys("T")
  end
end
}

Macro
{
  area="Shell QView Info Tree Search Dialog Editor Viewer";
  key="CtrlShiftF12";
  flags="NoSendKeysToPlugins";
  description="ConEmu: Standard Far windows list";
action = function()
  Keys("F12")
end
}
