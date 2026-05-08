
-- Place this file into your %FARPROFILE%\Macros\scripts

-- When tab switching in ConEmu is configured to Ctrl+Number
-- this macro will help to use Ctrl+Number combinations

Macro
{
  area="Shell";
  key="/[LR]CtrlShift[0-9]/";
  description="Panels: Switch panel modes with LCtrl+Shift+Number";
action = function()
  -- BUG? Following is expected to be working, but it doesn't... Far Panels ignores LCtrl+key posted this way
  -- Keys("LCtrl"..akey(1):sub(-1))
  Keys("Ctrl"..akey(1):sub(-1))
  -- it would be nice to have macro API
  -- far.PanelControl(far.Flags.FCTL_SETVIEWMODE, mf.atoi(akey(1):sub(-1)))
end
}

Macro
{
  area="Shell";
--  key="/RCtrlShift[0-9]/";
  description="Panels: No action";
action = function()
  return
end
}

Macro
{
  area="Editor Viewer";
  key="/RCtrlShift[0-9]/";
  description="Editor: Set std.bookmark with RCtrl+Shift+Number +++";
action = function()
  -- Extend std.bookmarks with stack bookmarks
  BM.Add()
  -- And set new std.bookmark
  Keys("CtrlShift"..akey(1):sub(-1))
end
}

Macro
{
  area="Editor Viewer";
  key="/RCtrl[0-9]/";
  description="Editor: Jump to std.bookmark with RCtrl+Number";
action = function()
  -- Store previous position in stack bookmarks
  BM.Add()
  -- And jump to std.bookmark
  Keys("Ctrl"..akey(1):sub(-1))
end
}
