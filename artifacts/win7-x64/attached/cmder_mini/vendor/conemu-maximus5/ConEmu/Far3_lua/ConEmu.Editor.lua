
-- Place this file into your %FARPROFILE%\Macros\scripts


-- Several Far instances may be opened in ConEmu tabs.
-- This macro activates existing Editor/Viewer, wich
-- may be opened in then inactive instance of Far.

local ConEmu   = "4b675d80-1d4a-4ea9-8436-fdc23f2fc14b"

Macro
{
  area="Shell Search";
  key="F3 F4";
  flags="NoPluginPanels";
  description="ConEmu: Auto switch to Editor Tab";
condition = function(Key)
  return (not APanel.Empty  and  (APanel.Current~=".."));
end;
action = function()

  k = akey(1,1);

  s=APanel.Path;
  s=s..mf.iif(mf.substr(s,mf.len(s)-1)=="\\","","\\")..APanel.Current;
  --msgbox("Current item", s)
  c = mf.substr(k,mf.len(k)-1,1);
  cmd = mf.iif(c=="4","FindEditor:","FindViewer:")..s;
  r = Plugin.SyncCall(ConEmu,cmd);
  --msgbox("EditOpen result", "Plugin.SyncCall="..r)
  if r then
    if mf.substr(r,0,5)=="Found" then
      exit() -- OK
    elseif mf.substr(r,0,6)=="Active" then
      iWnd = mf.atoi(mf.substr(r,7),10)+101
      Plugin.SyncCall(ConEmu,iWnd);
      Plugin.SyncCall(ConEmu,100);
      exit() -- Ok
    elseif r=="Blocked" then
      -- msgbox("ConEmu macro","Tab can't be activated now\n"..spname);
    end
  end

  -- history.enable(0xF) ?

  -- Do the F3/F4 key press
  Keys(k)

  -- As we get here, Far will try to open viewer or editor window.
  -- But, it may be already opened in the current Far instance.
  -- When it's exists, Far show messagebox with confirmation and buttons:
  -- { Current } [ New instance ] [ Reload ]
  -- Next macro line depress { Current } button
  if Area.Dialog and Dlg.Id=="AFDAD388-494C-41E8-BAC6-BBE9115E1CC0" then
    if Dlg.ItemCount==7  and  Dlg.CurPos==5  and  Dlg.ItemType==7 then
      Keys("Enter")
    end
  end

end;
}
