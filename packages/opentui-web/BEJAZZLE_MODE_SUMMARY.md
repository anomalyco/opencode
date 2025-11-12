# 🎨 Bejazzle Mode - Progressive HD Enhancement

## Overview
**Bejazzle Mode** is a progressive visual enhancement system that "levels up" as you use the app, unlocking new visual features with each milestone. Think of it like a video game graphics upgrade that gets better the more you interact!

## Activation
- **Toggle**: Press `Ctrl+P` → "Enable Bejazzle Mode" (or `Ctrl+X J`)
- **Status**: Persists across sessions (saved to localStorage)
- **Progressive**: Unlocks features as you send messages

## Progressive Levels

### Level 0: Classic Terminal (Default)
- Pure terminal aesthetic
- No enhancements
- Sharp edges, flat colors

### Level 1: Rounded Corners 🔄
**Unlocks at:** 3 messages
**Notification:** "🔄 Level 1: Rounded Corners!"
**Features:**
- 8px border radius on panels
- 4px border radius on chips
- Smooth rounded transitions

### Level 2: Gradients 🌈
**Unlocks at:** 6 messages  
**Notification:** "🌈 Level 2: Gradients Unlocked!"
**Features:**
- Context bar gradient (left to right)
- Header subtle gradients
- Enhanced visual depth

### Level 3: Shadows & Depth 🎭
**Unlocks at:** 10 messages
**Notification:** "🎭 Level 3: Shadows & Depth!"
**Features:**
- Panel shadows (4px-12px)
- Dialog shadows (8px-32px)
- Depth perception
- **Serif fonts for headers** (Georgia, Times New Roman)

### Level 4: Animations ⚡
**Unlocks at:** 15 messages
**Notification:** "⚡ Level 4: Animations!"
**Features:**
- Hover glow effects on chips
- Smooth panel fade-ins
- Transform animations
- Button hover effects
- **Larger font sizes** (18px-20px for headers)

### Level 5: Maximum Bejazzle 🎉
**Unlocks at:** 25 messages
**Notification:** "🎉 Level 5: MAXIMUM BEJAZZLE!"
**Features:**
- Custom scrollbars with gradients
- Animated dividers (blue glow on hover)
- Monaco editor enhancements
- Image preview styling
- Browser preview styling
- Pulse animations
- Shimmer loading states
- Enhanced focus states
- **Mixed font families:**
  - Assistant messages: SF Pro Display / System Sans
  - Code: Berkeley Mono / JetBrains Mono / Fira Code
  - Quotes: Georgia Serif (italic, 17px)

## Fun Messages

Every message in Bejazzle Mode has a chance to trigger a fun notification:
- 💎 Bejazzle incoming!
- ✨ Things are getting fancy!
- 🎨 Graphics upgrade detected!
- 🚀 Visual enhancement activated!
- 🌟 Bejazzle powers awakening!
- 💫 Style level up!
- 🎭 Aesthetic mode: ENGAGED
- 🔮 Magic happening...
- ⚡ Bejazzle energy rising!
- 🎪 The show must go on!

**Frequency:** Random message every 5 messages (when not leveling up)

## Technical Implementation

### Files Created/Modified

1. **src/context/bejazzle.tsx** (NEW)
   - Context provider for Bejazzle state
   - Level tracking (0-5)
   - Message count tracking
   - Notification system
   - LocalStorage persistence

2. **src/theme/bejazzle.css** (NEW)
   - Base Bejazzle styling
   - Applies when `data-bejazzle="true"`

3. **src/theme/bejazzle-progressive.css** (NEW)
   - Progressive level styling
   - Applies based on `data-bejazzle-level` attribute
   - Font variations by level

4. **src/components/TerminalViewNew.tsx** (MODIFIED)
   - Message tracking
   - Level progression logic
   - Body attribute management

5. **src/app.tsx** (MODIFIED)
   - Wrapped with `BejazzleProvider`

6. **src/grid-components/TerminalLayout.tsx** (MODIFIED)
   - Toggle handler
   - Pass state to CommandMenu

7. **src/grid-components/CommandMenu.tsx** (MODIFIED)
   - Added "Enable/Disable Bejazzle Mode" command
   - Keybind: `Ctrl+X J`

## Font System

### Level 0-2: Pure Monospace
- All text: Berkeley Mono / JetBrains Mono

### Level 3: Serif Headers
- Headers: Georgia, Times New Roman
- Body: Berkeley Mono (unchanged)

### Level 4: Size Variations
- H1: 20px
- H2: 18px
- Body: 16px (unchanged)

### Level 5: Mixed Fonts (Full Typography)
- **Assistant messages**: SF Pro Display, System Sans-Serif
- **User messages**: Berkeley Mono (terminal feel)
- **Code blocks**: Berkeley Mono, JetBrains Mono, Fira Code
- **Quotes**: Georgia Serif, italic, 17px
- **Headers**: Georgia Serif (from Level 3)

## Visual Enhancements by Level

| Feature | L0 | L1 | L2 | L3 | L4 | L5 |
|---------|----|----|----|----|----|----|
| Rounded corners | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gradients | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Shadows | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Animations | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Custom scrollbars | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Serif headers | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Font size variations | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Mixed fonts | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## Data Attributes

The system uses two data attributes on `<body>`:

```html
<!-- Bejazzle disabled -->
<body>

<!-- Bejazzle enabled, Level 1 -->
<body data-bejazzle="true" data-bejazzle-level="1">

<!-- Bejazzle enabled, Level 5 (Max) -->
<body data-bejazzle="true" data-bejazzle-level="5">
```

## LocalStorage Keys

- `bejazzle-mode`: "true" | "false"
- `bejazzle-level`: "0" | "1" | "2" | "3" | "4" | "5"
- `bejazzle-message-count`: number (total messages sent)

## Future Enhancements

### Potential Level 6+ Features
- Particle effects
- Sound effects on level up
- Custom themes per level
- Animation customization
- Seasonal themes
- Achievement badges
- Bejazzle leaderboard

### Image & Browser Previews
- **Images**: Rounded corners, shadows, hover zoom
- **Iframes**: Rounded corners, shadows, border
- **Browser views**: Container gradients, enhanced styling

## Design Philosophy

1. **Progressive Enhancement**: Don't overwhelm users - let them discover features gradually
2. **Gamification**: Make using the terminal fun and rewarding
3. **Visual Polish**: Each level adds meaningful visual improvements
4. **Typography Variety**: Mix fonts for hierarchy and interest
5. **Smooth Transitions**: All changes animate smoothly
6. **Persistence**: Progress saves automatically

## Developer Notes

- All Bejazzle CSS uses `!important` to override inline styles
- CSS selectors use attribute selectors for specificity
- Notification system uses DOM manipulation (no framework overhead)
- Level transitions are instant but visual changes animate
- Font loading handled by browser (system fonts preferred)

## User Experience Flow

```
1. User enables Bejazzle Mode (Ctrl+P → Enable Bejazzle)
2. Sends 3 messages → "🔄 Level 1: Rounded Corners!"
3. UI subtly rounds out, feels more polished
4. Sends 3 more (total 6) → "🌈 Level 2: Gradients Unlocked!"
5. Context bar gets gradient, headers look fancier
6. Sends 4 more (total 10) → "🎭 Level 3: Shadows & Depth!"
7. Panels float with shadows, headers in serif
8. Sends 5 more (total 15) → "⚡ Level 4: Animations!"
9. Chips glow on hover, panels fade in smoothly
10. Sends 10 more (total 25) → "🎉 Level 5: MAXIMUM BEJAZZLE!"
11. Full visual enhancement: custom scrollbars, mixed fonts, all features
12. Every 5 messages → Random fun notification
```

## Success Criteria

✅ Bejazzle Mode toggleable via Ctrl+P
✅ Progressive levels unlock based on message count
✅ Fun notifications display on level up
✅ Visual changes smooth and polished
✅ Persistence across sessions
✅ Different fonts at higher levels
✅ Performance impact minimal
✅ Works with all existing features
✅ Build succeeds without errors

---

**Bejazzle Mode**: Making terminals beautiful, one message at a time! 🎨✨
