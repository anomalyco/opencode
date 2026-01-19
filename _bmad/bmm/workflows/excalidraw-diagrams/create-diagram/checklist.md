# Create Diagram - Validation Checklist

## Element Structure

- [ ] All components with labels have matching `groupIds`
- [ ] All text elements have `containerId` pointing to parent component
- [ ] Text width calculated properly (no cutoff)
- [ ] Text alignment appropriate for diagram type

## Layout and Alignment

- [ ] All elements snapped to 20px grid
- [ ] Component spacing consistent (40px/60px)
- [ ] Hierarchical alignment maintained
- [ ] No overlapping elements

## Connections

- [ ] All arrows have `startBinding` and `endBinding`
- [ ] `boundElements` array updated on connected components
- [ ] Arrow routing avoids overlaps
- [ ] Relationship types clearly indicated

## Notation and Standards

- [ ] Follows specified notation standard (UML/ERD/etc)
- [ ] Symbols used correctly
- [ ] Cardinality/multiplicity shown where needed
- [ ] Labels and annotations clear

## Theme and Styling

- [ ] Theme colors applied consistently
- [ ] Component types visually distinguishable
- [ ] Text is readable
- [ ] Professional appearance

## Output Quality

- [ ] Element count under 80
- [ ] No elements with `isDeleted: true`
- [ ] JSON is valid
- [ ] File saved to correct location
