
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Switch visibility of ConEmu Panel Views
-- You may customize Panel Views display in ConEmu Settings -> Views

local ConEmuTh = "bd454d48-448e-46cc-909d-b6cf789c2d65"

Macro
{
  area="Shell";
  key="CtrlShiftF1";
  flags="";
  description="ConEmu: Switch Thumbnails view on active panel";
action = function()
  Plugin.Call(ConEmuTh,1)
end
}

Macro
{
  area="Shell";
  key="CtrlShiftF2";
  flags="";
  description="ConEmu: Switch Tiles view on active panel";
action = function()
  Plugin.Call(ConEmuTh,2)
end
}

Macro
{
  area="Shell";
  --key="CtrlAltF2";
  flags="";
  description="ConEmu: Turn off Tiles or Thumbnails on active panel";
action = function()
  Plugin.Call(ConEmuTh,256)
end
}
