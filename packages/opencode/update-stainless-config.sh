#!/bin/bash

# Script to update stainless.yml with UI resource definition

STAINLESS_FILE="../sdk/stainless/stainless.yml"

# Backup original file
cp "$STAINLESS_FILE" "$STAINLESS_FILE.backup"

# Insert UI section after the tui section (after line 168)
awk 'NR==168{
    print
    print ""
    print "  ui:"
    print "    models:"
    print "      sidebarDefinition: SidebarDefinition"
    print "      tabDefinition: TabDefinition"
    print "      panelDefinition: PanelDefinition"
    print "      widgetDefinition: WidgetDefinition"
    print "      keybindDefinition: KeybindDefinition"
    print "      statusItemDefinition: StatusItemDefinition"
    print "      commandDefinition: CommandDefinition"
    print "      uiExtensions: UIExtensions"
    print "      componentRender: ComponentRender"
    print "    methods:"
    print "      extensions: get /ui/extensions"
    print "      render: post /ui/render/{componentId}"
    next
}1' "$STAINLESS_FILE.backup" > "$STAINLESS_FILE"

echo "✓ Updated $STAINLESS_FILE with UI resource definition"
echo "✓ Backup saved to $STAINLESS_FILE.backup"

# Show the added section
echo ""
echo "Added UI section:"
grep -A 15 "^  ui:" "$STAINLESS_FILE"
