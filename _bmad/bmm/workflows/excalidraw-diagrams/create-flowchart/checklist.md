# Create Flowchart - Validation Checklist

## Element Structure

- [ ] All shapes with labels have matching `groupIds`
- [ ] All text elements have `containerId` pointing to parent shape
- [ ] Text width calculated properly (no cutoff)
- [ ] Text alignment set (`textAlign` + `verticalAlign`)

## Layout and Alignment

- [ ] All elements snapped to 20px grid
- [ ] Consistent spacing between elements (60px minimum)
- [ ] Vertical alignment maintained for flow direction
- [ ] No overlapping elements

## Connections

- [ ] All arrows have `startBinding` and `endBinding`
- [ ] `boundElements` array updated on connected shapes
- [ ] Arrow types appropriate (straight for forward, elbow for backward/upward)
- [ ] Gap set to 10 for all bindings

## Theme and Styling

- [ ] Theme colors applied consistently
- [ ] All shapes use theme primary fill color
- [ ] All borders use theme accent color
- [ ] Text color is readable (#1e1e1e)

## Composition

- [ ] Element count under 50
- [ ] Library components referenced where possible
- [ ] No duplicate element definitions

## Output Quality

- [ ] No elements with `isDeleted: true`
- [ ] JSON is valid
- [ ] File saved to correct location

## Functional Requirements

- [ ] Start point clearly marked
- [ ] End point clearly marked
- [ ] All process steps labeled
- [ ] Decision points use diamond shapes
- [ ] Flow direction is clear and logical
