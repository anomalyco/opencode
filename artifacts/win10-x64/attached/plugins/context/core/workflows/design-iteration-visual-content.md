<!-- Context: workflows/design-iteration-visual-content | Priority: medium | Version: 1.0 | Updated: 2025-12-09 -->
# Visual Content Generation

## When to Use Image Specialist

Delegate to **Image Specialist** subagent when users request:

- **Diagrams & Visualizations**: Architecture diagrams, flowcharts, system visualizations
- **UI Mockups & Wireframes**: Visual mockups, design concepts, interface previews
- **Graphics & Assets**: Social media graphics, promotional images, icons, illustrations
- **Image Editing**: Photo enhancement, image modifications, visual adjustments

## Invocation Pattern

```javascript
task(
  subagent_type="Image Specialist",
  description="Generate/edit visual content",
  prompt="Context to load:
          - /Users/apple/.config/opencode/context/core/visual-development.md
          
          Task: [Specific visual requirement]
          
          Requirements:
          - [Visual style/aesthetic]
          - [Dimensions/format]
          - [Key elements to include]
          - [Color scheme/branding]
          
          Output: [Expected deliverable]"
)
```

## Example Use Cases

### Architecture Diagram

```javascript
task(
  subagent_type="Image Specialist",
  description="Generate microservices architecture diagram",
  prompt="Create a diagram showing:
          - 5 microservices (API Gateway, Auth, Orders, Payments, Notifications)
          - Database connections
          - Message queue (RabbitMQ)
          - External services (Stripe, SendGrid)
          
          Style: Clean, professional, modern
          Format: PNG, 1920x1080"
)
```

### UI Mockup

```javascript
task(
  subagent_type="Image Specialist",
  description="Generate dashboard mockup",
  prompt="Create a mockup for an analytics dashboard:
          - Header with navigation
          - 4 metric cards (Users, Revenue, Conversion, Retention)
          - Line chart showing trends
          - Data table below
          
          Style: Modern, dark theme, professional
          Format: PNG, 1440x900"
)
```

### Social Media Graphic

```javascript
task(
  subagent_type="Image Specialist",
  description="Generate product launch graphic",
  prompt="Create a social media graphic announcing new feature:
          - Bold headline: 'Introducing Real-Time Collaboration'
          - Subtext: 'Work together, ship faster'
          - Brand colors: #6366f1 (primary), #1e293b (dark)
          - Include abstract collaboration visual
          
          Format: PNG, 1200x630 (Twitter/LinkedIn)"
)
```

## Tools Required

- **tool:gemini** - Gemini Nano Banana AI for image generation/editing
- Automatically available in Developer profile

## When NOT to Delegate

**Use design-iteration workflow instead** when:
- Creating interactive HTML/CSS designs
- Building complete UI implementations
- Iterating on existing HTML files
- Need responsive, production-ready code

**Use image-specialist** when:
- Need static visual assets
- Creating diagrams or illustrations
- Generating mockups for presentation
- Quick visual concepts without code

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Visual Development](../visual-development.md)
