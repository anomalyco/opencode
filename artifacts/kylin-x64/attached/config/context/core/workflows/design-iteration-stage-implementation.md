<!-- Context: workflows/design-iteration-stage-implementation | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Stage 4: Implementation

**Purpose**: Generate complete HTML file with all components

## Process

1. Read design plan file from `.tmp/design-plans/{name}.md`
2. Review all approved decisions from Stages 1-3
3. Build individual UI components
4. Integrate theme CSS
5. Add animations and interactions
6. Combine into single HTML file
7. Test responsive behavior
8. Save to design_iterations folder
9. **Update plan file** with output file paths
10. Present to user for review
11. **Update plan file** with user feedback and final approval status

## Deliverable

- Complete HTML file with embedded or linked CSS
- Updated plan file with Stage 4 complete and all output files documented

## File Organization

```
design_iterations/
├── theme_1.css              # Theme file from Stage 2
├── dashboard_1.html         # Initial design
├── dashboard_1_1.html       # First iteration
├── dashboard_1_2.html       # Second iteration
├── chat_ui_1.html           # Different design
└── chat_ui_1_1.html         # Iteration of chat UI
```

## Naming Conventions

| Type | Format | Example |
|------|--------|---------|
| Initial design | `{name}_1.html` | `table_1.html` |
| First iteration | `{name}_1_1.html` | `table_1_1.html` |
| Second iteration | `{name}_1_2.html` | `table_1_2.html` |
| New design | `{name}_2.html` | `table_2.html` |

## Implementation Checklist

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Design Name</title>
  
  <!-- ✅ Preconnect to external resources -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  
  <!-- ✅ Load fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- ✅ Load Tailwind (script tag, not stylesheet) -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- ✅ Load Flowbite if needed -->
  <link href="https://cdn.jsdelivr.net/npm/flowbite@2.0.0/dist/flowbite.min.css" rel="stylesheet">
  
  <!-- ✅ Load icons -->
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  
  <!-- ✅ Link theme CSS -->
  <link rel="stylesheet" href="theme_1.css">
  
  <!-- ✅ Custom styles with !important for overrides -->
  <style>
    body {
      font-family: 'Inter', sans-serif !important;
      color: var(--foreground) !important;
    }
    
    h1, h2, h3, h4, h5, h6 {
      font-weight: 600 !important;
    }
    
    /* Custom animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .animate-fade-in {
      animation: fadeIn 300ms ease-out;
    }
  </style>
</head>
<body>
  <!-- ✅ Semantic HTML structure -->
  <header>
    <!-- Header content -->
  </header>
  
  <main>
    <!-- Main content -->
  </main>
  
  <footer>
    <!-- Footer content -->
  </footer>
  
  <!-- ✅ Load Flowbite JS if needed -->
  <script src="https://cdn.jsdelivr.net/npm/flowbite@2.0.0/dist/flowbite.min.js"></script>
  
  <!-- ✅ Initialize icons -->
  <script>
    lucide.createIcons();
  </script>
  
  <!-- ✅ Custom JavaScript -->
  <script>
    // Interactive functionality
  </script>
</body>
</html>
```

## Best Practices

✅ **Do**:
- Use single HTML file per design
- Load Tailwind via script tag
- Reference theme CSS file
- Use !important for framework overrides
- Test responsive behavior
- Provide alt text for images
- Use semantic HTML

❌ **Don't**:
- Split into multiple files
- Load Tailwind as stylesheet
- Inline all styles
- Skip accessibility attributes
- Use made-up image URLs
- Use div soup (non-semantic HTML)

## Approval Gate

"Please review the design. Would you like any changes or iterations?"

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Stage 3: Animation](./design-iteration-stage-animation.md)
- [Best Practices](./design-iteration-best-practices.md)
- [Iteration Process](./design-iteration-plan-iterations.md)
