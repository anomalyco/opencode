<!-- Context: ui/web/animation-components | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Component Animation Patterns

Animation patterns for buttons, cards, modals, dropdowns, and sidebars.

---

## Button Interactions

```css
.button {
  transition: transform 200ms ease-out, box-shadow 200ms ease-out;
}
.button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.button:active {
  transform: scale(0.95);
  transition: transform 100ms ease-in;
}

@keyframes ripple {
  from { transform: scale(0); opacity: 1; }
  to { transform: scale(2); opacity: 0; }
}
.button::after { animation: ripple 400ms ease-out; }
```

**Micro-syntax**:
```
buttonHover: 200ms ease-out [Y0→-2, shadow↗]
buttonPress: 100ms ease-in [S1→0.95]
ripple: 400ms ease-out [S0→2, α1→0]
```

---

## Card Interactions

```css
.card {
  transition: transform 300ms ease-out, box-shadow 300ms ease-out;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}
.card.selected {
  transform: scale(1.02);
  background-color: var(--accent);
  transition: all 200ms ease-out;
}
```

**Micro-syntax**:
```
cardHover: 300ms ease-out [Y0→-4, shadow↗]
cardSelect: 200ms ease-out [S1→1.02, bg→accent]
```

---

## Modal/Dialog Animations

```css
.modal-backdrop { animation: fadeIn 300ms ease-out; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.modal { animation: slideUp 350ms ease-out; }
@keyframes slideUp {
  from { transform: translateY(40px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.modal.closing { animation: slideDown 250ms ease-in; }
@keyframes slideDown {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(40px); opacity: 0; }
}
```

**Micro-syntax**:
```
backdrop: 300ms ease-out [α0→1]
modalEnter: 350ms ease-out [Y+40→0, α0→1]
modalExit: 250ms ease-in [Y0→+40, α1→0]
```

---

## Dropdown/Menu Animations

```css
.dropdown {
  animation: dropdownOpen 200ms ease-out;
  transform-origin: top;
}
@keyframes dropdownOpen {
  from { transform: scaleY(0.95); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}
```

**Micro-syntax**: `dropdown: 200ms ease-out [scaleY0.95→1, α0→1]`

---

## Sidebar/Drawer Animations

```css
.sidebar { animation: slideInLeft 350ms ease-out; }
@keyframes slideInLeft {
  from { transform: translateX(-280px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.overlay { animation: overlayFade 300ms ease-out; }
@keyframes overlayFade {
  from { opacity: 0; backdrop-filter: blur(0); }
  to { opacity: 1; backdrop-filter: blur(4px); }
}
```

**Micro-syntax**:
```
sidebar: 350ms ease-out [X-280→0, α0→1]
overlay: 300ms ease-out [α0→1, blur0→4px]
```

---

## Related Files

- [Animation Basics](./animation-basics.md) - Fundamentals
- [Chat Animations](./animation-chat.md) - Message patterns
- [Loading Animations](./animation-loading.md) - Loading states
