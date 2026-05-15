<!-- Context: visual-development | Priority: high | Version: 1.0 | Updated: 2025-01-27 -->
# Visual Development Context

**Purpose**: Visual content creation, UI design, image generation, and diagram creation

---

## Quick Routes

| Task Type | Context File | Subagent | Tools |
|-----------|-------------|----------|-------|
| **Generate image/diagram** | This file | Image Specialist | tool:gemini |
| **Edit existing image** | This file | Image Specialist | tool:gemini |
| **UI mockup (static)** | This file | Image Specialist | tool:gemini |
| **Interactive UI design** | `workflows/design-iteration-overview.md` | - | - |
| **Design system** | `ui/web/design-systems.md` | - | - |
| **UI standards** | `ui/web/ui-styling-standards.md` | - | - |
| **Animation patterns** | `ui/web/animation-patterns.md` | - | - |

---

## Image Specialist Capabilities

### What It Does

The **Image Specialist** subagent uses Gemini Nano Banana AI to:

- ✅ **Generate images from text descriptions** - Create original images, illustrations, graphics
- ✅ **Edit existing images** - Modify, enhance, or transform images
- ✅ **Analyze images** - Describe image content, extract information
- ✅ **Create diagrams** - Architecture diagrams, flowcharts, system visualizations
- ✅ **Design mockups** - UI mockups, wireframes, design concepts
- ✅ **Generate graphics** - Social media graphics, promotional images, icons

### When to Delegate

Delegate to Image Specialist when users request:

**Keywords to Watch For**:
- "create image", "generate image", "make image"
- "diagram", "flowchart", "visualization"
- "mockup", "wireframe", "design concept"
- "graphic", "illustration", "icon"
- "edit image", "modify image", "enhance image"
- "screenshot", "visual", "picture"

**Common Use Cases**:
1. **Architecture Diagrams** - Microservices, system design, infrastructure
2. **UI Mockups** - Dashboard designs, app interfaces, web layouts
3. **Social Media Graphics** - Announcements, promotions, branded content
4. **Documentation Images** - Tutorial screenshots, feature highlights, guides
5. **Presentations** - Slide graphics, charts, visual aids
6. **Marketing Assets** - Product images, hero graphics, banners

### How to Invoke

```javascript
task(
  subagent_type="Image Specialist",
  description="[Brief 3-5 word description]",
  prompt="Context to load:
          - /Users/apple/.config/opencode/context/core/visual-development.md
          
          Task: [Detailed visual requirement]
          
          Requirements:
          - Style: [Visual aesthetic - modern, minimalist, professional, etc.]
          - Dimensions: [Width x Height or aspect ratio]
          - Key Elements: [What must be included]
          - Colors: [Color scheme, brand colors, palette]
          - Format: [PNG, JPG, SVG preference]
          
          Output: [Expected deliverable and location]"
)
```

---

## Use Case Examples

### 1. Architecture Diagram

**User Request**: "Create a diagram showing our microservices architecture"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Generate microservices architecture diagram",
  prompt="Create a technical architecture diagram showing:
          
          **Services**:
          - API Gateway (entry point)
          - Auth Service (authentication)
          - User Service (user management)
          - Order Service (order processing)
          - Payment Service (payment processing)
          - Notification Service (emails/SMS)
          
          **Infrastructure**:
          - PostgreSQL databases (one per service)
          - Redis cache (shared)
          - RabbitMQ message queue
          - AWS S3 (file storage)
          
          **External Services**:
          - Stripe (payments)
          - SendGrid (emails)
          - Twilio (SMS)
          
          **Style**: Clean, professional, modern tech diagram
          **Colors**: Blue for services, green for databases, orange for external
          **Format**: PNG, 1920x1080
          **Layout**: Left-to-right flow, clear connections
          
          Output: Save to docs/architecture-diagram.png"
)
```

---

### 2. UI Mockup

**User Request**: "Show me what the dashboard could look like"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Generate analytics dashboard mockup",
  prompt="Create a UI mockup for an analytics dashboard:
          
          **Layout**:
          - Top: Header with logo, navigation, user menu
          - Below header: 4 metric cards in a row
            * Total Users (with trend arrow)
            * Revenue (with percentage change)
            * Conversion Rate (with sparkline)
            * Active Sessions (with live indicator)
          - Middle: Large line chart showing 30-day trends
          - Bottom: Data table with recent transactions
          
          **Style**: Modern, professional SaaS aesthetic
          **Theme**: Dark mode with subtle gradients
          **Colors**: 
            - Background: Dark gray (#1e293b)
            - Cards: Slightly lighter (#334155)
            - Accent: Blue (#3b82f6)
            - Text: White/gray
          **Typography**: Clean sans-serif (Inter-style)
          **Format**: PNG, 1440x900
          
          Output: Save to design_iterations/dashboard_mockup.png"
)
```

---

### 3. Social Media Graphic

**User Request**: "Create a graphic announcing our new feature"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Generate feature announcement graphic",
  prompt="Create a social media graphic for feature launch:
          
          **Content**:
          - Main headline: 'Introducing Real-Time Collaboration'
          - Subheadline: 'Work together, ship faster'
          - Small text: 'Available now for all teams'
          
          **Visual Elements**:
          - Abstract illustration of people collaborating
          - Subtle geometric shapes in background
          - Modern, energetic feel
          
          **Brand Colors**:
          - Primary: #6366f1 (indigo)
          - Secondary: #8b5cf6 (purple)
          - Background: White with gradient
          - Text: Dark gray (#1e293b)
          
          **Format**: PNG, 1200x630 (optimized for Twitter/LinkedIn)
          **Style**: Modern, professional, eye-catching
          
          Output: Save to marketing/feature-launch-social.png"
)
```

---

### 4. Flowchart/Process Diagram

**User Request**: "Diagram the user onboarding flow"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Generate user onboarding flowchart",
  prompt="Create a flowchart showing user onboarding process:
          
          **Steps**:
          1. User signs up (email/password)
          2. Email verification sent
          3. User clicks verification link
          4. Profile setup (name, company, role)
          5. Choose plan (Free/Pro/Enterprise)
          6. Payment (if Pro/Enterprise)
          7. Onboarding tutorial (5 steps)
          8. Dashboard access
          
          **Decision Points**:
          - Email verified? (Yes → Continue, No → Resend)
          - Plan selected? (Free → Skip payment, Paid → Payment)
          - Payment successful? (Yes → Continue, No → Retry)
          
          **Style**: Clean flowchart with standard symbols
          **Colors**: 
            - Start/End: Green
            - Process: Blue
            - Decision: Yellow
            - Error: Red
          **Format**: PNG, 1600x1200
          **Layout**: Top-to-bottom flow
          
          Output: Save to docs/onboarding-flow.png"
)
```

---

### 5. Icon/Illustration

**User Request**: "Create an icon for our file upload feature"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Generate file upload icon",
  prompt="Create a modern icon for file upload feature:
          
          **Concept**: Cloud with upward arrow
          **Style**: 
            - Minimalist, clean lines
            - Rounded corners
            - Flat design (no gradients)
          **Colors**: 
            - Primary: #3b82f6 (blue)
            - Accent: #60a5fa (lighter blue)
          **Size**: 512x512px (will be scaled down)
          **Format**: PNG with transparent background
          **Usage**: App UI, documentation, marketing
          
          Output: Save to assets/icons/upload-icon.png"
)
```

---

### 6. Image Editing

**User Request**: "Make this screenshot look more professional"

**Invocation**:
```javascript
task(
  subagent_type="Image Specialist",
  description="Enhance screenshot for documentation",
  prompt="Edit the existing screenshot at docs/raw-screenshot.png:
          
          **Enhancements Needed**:
          - Add subtle drop shadow for depth
          - Round the corners (8px radius)
          - Add a thin border (#e5e7eb)
          - Increase contrast slightly
          - Ensure text is crisp and readable
          
          **Optional**:
          - Add subtle gradient background
          - Highlight key UI elements with arrows/boxes
          
          **Output Format**: PNG, maintain original dimensions
          **Quality**: High (for documentation)
          
          Output: Save to docs/enhanced-screenshot.png"
)
```

---

## Decision Tree: Image Specialist vs Design Iteration

Use this decision tree to choose the right approach:

```
User needs visual content
    ↓
Is it interactive/responsive HTML/CSS?
    ↓
  YES → Use design-iteration-overview.md workflow
    |    - Create HTML files
    |    - Iterate on designs
    |    - Production-ready code
    ↓
  NO → Is it a static visual asset?
    ↓
  YES → Use Image Specialist
    |    - Diagrams
    |    - Mockups (non-interactive)
    |    - Graphics
    |    - Illustrations
    ↓
  NO → Clarify requirements with user
```

### Quick Reference

| Need | Use |
|------|-----|
| **Interactive dashboard** | design-iteration-overview.md |
| **Dashboard mockup (static image)** | Image Specialist |
| **Responsive landing page** | design-iteration-overview.md |
| **Landing page hero graphic** | Image Specialist |
| **Working HTML prototype** | design-iteration-overview.md |
| **Architecture diagram** | Image Specialist |
| **UI component library** | design-iteration-overview.md |
| **Social media graphic** | Image Specialist |

---

## Tools & Dependencies

### Required Tool

**tool:gemini** - Gemini Nano Banana AI
- Automatically included in Developer profile
- Requires GEMINI_API_KEY environment variable
- Get API key: https://makersuite.google.com/app/apikey

### Configuration

Add to `.env` file:
```bash
GEMINI_API_KEY=your_api_key_here
```

### Capabilities

- **Text-to-Image**: Generate images from descriptions
- **Image-to-Image**: Edit and transform existing images
- **Image Analysis**: Describe and analyze image content
- **Multiple Formats**: PNG, JPG, WebP support
- **High Resolution**: Up to 2048x2048 pixels

---

## Best Practices

### Writing Effective Prompts

✅ **Do**:
- Be specific about dimensions and format
- Describe visual style clearly (modern, minimalist, professional)
- Specify colors using hex codes or names
- Include key elements that must appear
- Mention the intended use case
- Provide context about brand/aesthetic

❌ **Don't**:
- Use vague descriptions ("make it nice")
- Forget to specify dimensions
- Assume default style preferences
- Skip color specifications
- Omit output location

### Example: Good vs Bad Prompts

**❌ Bad Prompt**:
```
"Create a diagram of our system"
```

**✅ Good Prompt**:
```
"Create a technical architecture diagram showing:
- 3 microservices (API, Auth, Database)
- AWS infrastructure (EC2, RDS, S3)
- External APIs (Stripe, SendGrid)

Style: Clean, professional, modern
Colors: Blue for services, green for databases
Format: PNG, 1920x1080
Layout: Left-to-right flow with clear connections

Output: docs/system-architecture.png"
```

---

## Quality Checklist

Before delegating to Image Specialist:

- [ ] User request clearly indicates need for visual content
- [ ] Determined static image is appropriate (not interactive HTML)
- [ ] Gathered requirements: style, dimensions, colors, elements
- [ ] Specified output format and location
- [ ] Confirmed tool:gemini is available in profile
- [ ] Prepared detailed prompt with all specifications

After receiving output:

- [ ] Image meets specified requirements
- [ ] Dimensions and format are correct
- [ ] Visual style matches request
- [ ] All key elements are included
- [ ] Image is saved to specified location
- [ ] User is satisfied with result

---

## Troubleshooting

### Common Issues

**Issue**: Generated image doesn't match expectations
**Solution**: Refine prompt with more specific details, provide reference examples

**Issue**: Image quality is low
**Solution**: Request higher resolution, specify quality requirements in prompt

**Issue**: Colors don't match brand
**Solution**: Provide exact hex codes, reference brand guidelines

**Issue**: Layout is cluttered
**Solution**: Simplify requirements, specify clear hierarchy and spacing

**Issue**: Text in image is unreadable
**Solution**: Request larger text, higher contrast, clearer typography

---

## Related Context

- **UI Design Workflow**: `/Users/apple/.config/opencode/context/core/workflows/design-iteration-overview.md`
- **Design Systems**: `/Users/apple/.config/opencode/context/ui/web/design-systems.md`
- **UI Styling Standards**: `/Users/apple/.config/opencode/context/ui/web/ui-styling-standards.md`
- **Animation Patterns**: `/Users/apple/.config/opencode/context/ui/web/animation-basics.md`, `/Users/apple/.config/opencode/context/ui/web/animation-advanced.md`
- **Subagent Invocation Guide**: `/Users/apple/.config/opencode/context/openagents-repo/guides/subagent-invocation.md`
- **Agent Capabilities**: `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/agents.md`

---

## Keywords for Discovery

**ContextScout should find this file when users mention**:

- image, images, picture, photo, graphic
- diagram, flowchart, visualization, chart
- mockup, wireframe, design, concept
- illustration, icon, asset, visual
- generate, create, make, design
- screenshot, capture, render
- architecture, system, flow, process
- social media, marketing, promotional
- edit, modify, enhance, transform
- UI, interface, dashboard, layout

---

## Version History

- **v1.0** (2025-01-27): Initial creation with comprehensive use cases and examples
