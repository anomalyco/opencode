
-- Place this file into your %FARPROFILE%\Macros\scripts


-- This macros was created to simplify Far Editor usage on tablets
-- Mapped to MsRClick (or long tap on tablets) it will show menu
-- ┌───────────────────────┐
-- │  Copy whole line      │
-- │  Copy single word     │
-- │  Paste from clipboard │
-- └───────────────────────┘

Macro
{
  area="Dialog Editor";
  key="MsRClick";
  flags="";
  description="ConEmu: Clipboard actions menu";
action = function()

  CopyLine="Copy whole line";
  CopyWord="Copy single word";
  Paste="Paste from clipboard";

  if  Area.Editor then
    Keys("MsLClick CtrlU") Keys("SelWord")
  else
    dx=Dlg.GetValue(0,2); dy=Dlg.GetValue(0,3); c=Dlg.GetValue(0,0);
    if  c<1 then  exit() end
    i=1;
    while  i<=c do
      t=Dlg.GetValue(i,1);
      if  t==4  or  t==6 then
        f=Dlg.GetValue(i,8);
        if   not (band(f,0xD0000000)) then
          if  (dy+Dlg.GetValue(i,3))==Mouse.Y then
            if  ((dx+Dlg.GetValue(i,2))<=Mouse.X)  and  ((dx+Dlg.GetValue(i,4))>=Mouse.X) then
              Dlg.SetFocus(i)
              c=0;
            end
          end
        end
      end
      i=i+1;
    end
    if  c~=0 then
      Keys("MsRClick") exit()
    end
  end

  Menu__RENAMED=CopyLine.."\n";
  if  Editor.SelValue~="" then
    Menu__RENAMED=Menu__RENAMED..CopyWord.."\n";
  end
  Menu__RENAMED=Menu__RENAMED..Paste;

  s = Menu.Show(Menu__RENAMED,"",0x3,"",Mouse.X,Mouse.Y+1);
  if  s=="" then  exit() end

  if  s==CopyLine then
    if  Area.Dialog then  Keys("Home") else Editor.Pos(1,2,1) end Keys("ShiftEnd")
    Keys("CtrlIns") exit()
  end
  if  s==CopyWord then
    Keys("CtrlIns") exit()
  end
  if  s==Paste then
    Keys("ShiftIns") exit()
  end

end
}
